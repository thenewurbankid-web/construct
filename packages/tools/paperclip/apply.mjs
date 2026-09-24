#!/usr/bin/env node
// Paperclip setup as code: reads company.json and makes the local Paperclip match it.
//   node packages/tools/paperclip/apply.mjs            dry run (default): prints what it would create or change, writes nothing
//   node packages/tools/paperclip/apply.mjs --apply    write it
//   node packages/tools/paperclip/apply.mjs --status    list agents with paused state, budget and last run
// Options: --api <url> (default http://127.0.0.1:3100; a non-loopback host is refused unless --allow-remote),
//          --config <company.json>, --repo-root <dir>, --pause-all (re-pause every configured agent and switch its timer off).
// Idempotent: the company, agents and goals are found by name and drift is patched, never duplicated, never deleted.
// Safety: agents are created PAUSED with the timer heartbeat off. This script never resumes or wakes an agent and never
// enables a heartbeat. An agent the owner has resumed is reported as LIVE and left alone (--pause-all reverses that).
// Node built-ins only (fetch), Node 22 and 24. No secret is read, and any secret-looking text is redacted from the output.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_API, asList, assertApiBase, configVars, createClient, diffSubset, loadConfig, makeOut, norm,
  orderAgents, resolveAgent, validateConfig,
} from './lib.mjs';

export function parseArgs(argv) {
  const o = { api: DEFAULT_API, apply: false, status: false, allowRemote: false, pauseAll: false, config: undefined, repoRoot: undefined };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--apply') o.apply = true;
    else if (a === '--status') o.status = true;
    else if (a === '--allow-remote') o.allowRemote = true;
    else if (a === '--pause-all') o.pauseAll = true;
    else if (a === '--api') o.api = argv[++i];
    else if (a === '--config') o.config = argv[++i];
    else if (a === '--repo-root') o.repoRoot = argv[++i];
    else if (a === '--dry-run') o.apply = false;
    else if (a === '--help' || a === '-h') o.help = true;
    else throw new Error(`Unknown argument: ${a}`);
  }
  return o;
}

const USAGE = 'usage: apply.mjs [--apply | --status] [--api URL] [--allow-remote] [--config FILE] [--repo-root DIR] [--pause-all]';
const fileContent = (r) => (r && typeof r === 'object' ? (r.content ?? r.file?.content ?? r.data?.content ?? null) : null);
const cents = (n) => `$${(n / 100).toFixed(2)}`;

export async function run(argv, { out = makeOut() } = {}) {
  const opts = parseArgs(argv);
  if (opts.help) {
    out(USAGE);
    return 0;
  }
  const base = assertApiBase(opts.api, { allowRemote: opts.allowRemote });
  const api = createClient(base);
  const cfg = opts.config ? loadConfig(path.resolve(opts.config)) : loadConfig();
  validateConfig(cfg);
  const vars = configVars(cfg, { repoRoot: opts.repoRoot });
  const write = opts.apply;
  let changes = 0;
  const warnings = [];

  out(`Paperclip ${base} | company "${cfg.company.name}" | ${opts.status ? 'STATUS' : write ? 'APPLY (writes)' : 'DRY RUN (no writes; add --apply to write)'}`);

  const companies = asList(await api.get('/api/companies'));
  let company = companies.find((c) => c.name === cfg.company.name) ?? null;

  if (opts.status) return status(api, company, cfg, out);

  // ---- company
  const companyBody = { name: cfg.company.name, description: cfg.company.description, budgetMonthlyCents: cfg.budgets.company };
  if (!company) {
    changes++;
    out(`CREATE company "${companyBody.name}" (budget ${cents(companyBody.budgetMonthlyCents)}/month)`);
    if (write) {
      company = await api.post('/api/companies', companyBody);
      out(`  id ${company.id}`);
    } else company = { id: '<new-company>', $new: true };
  } else {
    const drift = ['name', 'description'].filter((k) => norm(company[k]) !== norm(companyBody[k]));
    if (drift.length) {
      changes++;
      out(`PATCH company: ${drift.join(', ')}`);
      if (write) await api.patch(`/api/companies/${company.id}`, Object.fromEntries(drift.map((k) => [k, companyBody[k]])));
    }
    if (company.budgetMonthlyCents !== companyBody.budgetMonthlyCents) {
      changes++;
      out(`PATCH company budget: ${company.budgetMonthlyCents ?? 0} -> ${companyBody.budgetMonthlyCents} cents`);
      if (write) await api.patch(`/api/companies/${company.id}/budgets`, { budgetMonthlyCents: companyBody.budgetMonthlyCents });
    }
    out(`OK company ${company.id}`);
  }
  const cid = company.id;
  const isNew = !!company.$new;

  // ---- budget policies (soft caps: warn at warnPercent, hard stop pauses)
  const policies = isNew ? [] : asList((await api.get(`/api/companies/${cid}/budgets/overview`))?.policies ?? []);
  const policyFor = (scopeType, scopeId) => policies.find((p) => p.scopeType === scopeType && p.scopeId === scopeId && p.isActive !== false);
  async function ensurePolicy(label, scopeType, scopeId, amount) {
    const want = { amount, warnPercent: cfg.budgets.warnPercent, hardStopEnabled: cfg.budgets.hardStop !== false };
    const have = scopeId ? policyFor(scopeType, scopeId) : null;
    const drift = !have ? ['policy missing'] : diffSubset(want, have);
    if (!drift.length) return;
    changes++;
    out(`  ${have ? 'PATCH' : 'CREATE'} budget policy ${label}: ${cents(amount)}/month, warn ${want.warnPercent}%, hard stop ${want.hardStopEnabled}${have ? ` (drift: ${drift.join(', ')})` : ''}`);
    if (write && scopeId) {
      await api.post(`/api/companies/${cid}/budgets/policies`, {
        scopeType, scopeId, metric: 'billed_cents', windowKind: 'calendar_month_utc', ...want, notifyEnabled: true, isActive: true,
      });
    }
  }
  if (!isNew) await ensurePolicy('company', 'company', cid, cfg.budgets.company);

  // ---- agents
  const existing = isNew ? [] : asList(await api.get(`/api/companies/${cid}/agents`));
  const ids = {}; // key -> agent id
  const summary = [];
  for (const agent of orderAgents(cfg)) {
    const want = resolveAgent(cfg, agent, vars);
    const label = `${agent.name} (${agent.key})${agent.hold ? ' [HELD]' : ''}`;
    const listed = existing.find((a) => a.name === want.body.name);
    const reportsTo = want.reportsToKey ? ids[want.reportsToKey] ?? '<new-manager>' : null;
    let id;
    let live = false;

    if (!listed) {
      changes++;
      out(`CREATE agent ${label}: role ${want.body.role}, ${want.body.adapterType}, model ${want.body.adapterConfig.model}, budget ${cents(want.body.budgetMonthlyCents)}/month, heartbeat off, reports to ${want.reportsToKey ?? '-'}`);
      if (write) {
        const created = await api.post(`/api/companies/${cid}/agents`, {
          ...want.body, reportsTo, instructionsBundle: want.bundle,
        });
        id = created.id;
        await api.post(`/api/agents/${id}/pause`);
        out(`  id ${id} (paused)`);
      } else id = '<new-agent>';
      // the bundle and policy are verified below exactly as for an existing agent
    } else {
      id = listed.id;
      const have = await api.get(`/api/agents/${id}`);
      live = have.status !== undefined && have.status !== 'paused';
      const hbLive = have.runtimeConfig?.heartbeat?.enabled === true;
      const patch = {};
      const drift = [];
      for (const k of ['name', 'role', 'title', 'icon', 'capabilities', 'adapterType']) {
        if (want.body[k] != null && norm(have[k]) !== norm(want.body[k])) {
          patch[k] = want.body[k];
          drift.push(k);
        }
      }
      if ((have.reportsTo ?? null) !== reportsTo && !String(reportsTo).startsWith('<')) {
        patch.reportsTo = reportsTo;
        drift.push('reportsTo');
      }
      const acDrift = diffSubset(want.body.adapterConfig, have.adapterConfig ?? {});
      if (acDrift.length) {
        patch.adapterConfig = want.body.adapterConfig;
        drift.push(...acDrift.map((p) => `adapterConfig.${p}`));
      }
      if (!hbLive || opts.pauseAll) {
        const hbDrift = diffSubset(want.body.runtimeConfig.heartbeat, have.runtimeConfig?.heartbeat ?? {});
        if (hbDrift.length) {
          patch.runtimeConfig = want.body.runtimeConfig;
          drift.push(...hbDrift.map((p) => `heartbeat.${p}`));
        }
      } else warnings.push(`${label}: timer heartbeat is ON (owner enabled it); left alone, --pause-all switches it off`);
      if (drift.length) {
        changes++;
        out(`PATCH agent ${label}: ${drift.join(', ')}`);
        if (write) await api.patch(`/api/agents/${id}`, patch);
      } else out(`OK agent ${label} ${id}`);
      if (have.budgetMonthlyCents !== want.body.budgetMonthlyCents) {
        changes++;
        out(`  PATCH budget ${label}: ${have.budgetMonthlyCents ?? 0} -> ${want.body.budgetMonthlyCents} cents`);
        if (write) await api.patch(`/api/agents/${id}/budgets`, { budgetMonthlyCents: want.body.budgetMonthlyCents });
      }
      if (live) {
        if (opts.pauseAll) {
          changes++;
          out(`  PAUSE ${label} (status ${have.status})`);
          if (write) await api.post(`/api/agents/${id}/pause`);
        } else warnings.push(`${label}: LIVE (status ${have.status}, resumed by the owner); left alone, --pause-all pauses it`);
      }
    }
    ids[agent.key] = id;

    // instructions bundle: every file compared and uploaded through the bundle-file endpoint
    if (!String(id).startsWith('<')) {
      for (const [file, content] of Object.entries(want.bundle.files)) {
        let current = null;
        try {
          current = fileContent(await api.get(`/api/agents/${id}/instructions-bundle/file?path=${encodeURIComponent(file)}`));
        } catch (e) {
          if (e.status !== 404) throw e;
        }
        if (current === null || norm(current) !== norm(content)) {
          changes++;
          out(`  ${current === null ? 'UPLOAD' : 'PATCH'} instructions ${agent.key}/${file} (${content.length} chars)`);
          if (write) await api.put(`/api/agents/${id}/instructions-bundle/file`, { path: file, content });
        }
      }
    } else out(`  UPLOAD instructions ${agent.key}: ${Object.keys(want.bundle.files).join(', ')}`);

    // budget policy
    if (!String(id).startsWith('<')) {
      const fresh = write && !listed ? asList((await api.get(`/api/companies/${cid}/budgets/overview`))?.policies ?? []) : null;
      if (fresh) policies.splice(0, policies.length, ...fresh);
      await ensurePolicy(agent.key, 'agent', id, want.body.budgetMonthlyCents);
    } else out(`  CREATE budget policy ${agent.key}: ${cents(want.body.budgetMonthlyCents)}/month, warn ${cfg.budgets.warnPercent}%, hard stop`);
    summary.push({ key: agent.key, name: agent.name, id });
  }

  // ---- goals
  const goalIds = {};
  const goals = isNew ? [] : asList(await api.get(`/api/companies/${cid}/goals`));
  for (const g of cfg.goals ?? []) {
    const body = {
      title: g.title, description: g.description ?? null, level: g.level ?? 'company', status: g.status ?? 'active',
      parentId: g.parent ? goalIds[g.parent] ?? null : null, ownerAgentId: g.owner ? ids[g.owner] ?? null : null,
    };
    const have = goals.find((x) => x.title === g.title);
    const unresolved = (v) => typeof v === 'string' && v.startsWith('<');
    if (!have) {
      changes++;
      out(`CREATE goal "${g.title}" (${body.level}${g.parent ? `, under ${g.parent}` : ''})`);
      if (write) {
        const created = await api.post(`/api/companies/${cid}/goals`, body);
        goalIds[g.key] = created.id;
      } else goalIds[g.key] = '<new-goal>';
    } else {
      goalIds[g.key] = have.id;
      const drift = ['description', 'level', 'status'].filter((k) => norm(have[k]) !== norm(body[k]));
      if ((have.parentId ?? null) !== body.parentId && !unresolved(body.parentId)) drift.push('parentId');
      if ((have.ownerAgentId ?? null) !== body.ownerAgentId && !unresolved(body.ownerAgentId)) drift.push('ownerAgentId');
      if (drift.length) {
        changes++;
        out(`PATCH goal "${g.title}": ${drift.join(', ')}`);
        if (write) await api.patch(`/api/goals/${have.id}`, Object.fromEntries(drift.map((k) => [k, body[k]])));
      } else out(`OK goal "${g.title}" ${have.id}`);
    }
  }

  // ---- verify: every configured agent is paused
  let notPaused = 0;
  if (write) {
    const after = asList(await api.get(`/api/companies/${cid}/agents`));
    for (const a of orderAgents(cfg)) {
      const got = after.find((x) => x.name === a.name);
      if (!got) continue;
      if (got.status !== 'paused') notPaused++;
    }
  }

  out('');
  out(`${write ? 'Applied' : 'Would apply'} ${changes} change${changes === 1 ? '' : 's'}.${changes === 0 ? ' Nothing to do: the instance matches company.json.' : ''}`);
  if (write) {
    out(`company ${cid}`);
    for (const s of summary) out(`  ${s.key.padEnd(15)} ${s.id}  ${s.name}`);
    out(notPaused ? `WARNING: ${notPaused} configured agent(s) are not paused.` : 'All configured agents are paused.');
  }
  for (const w of warnings) out(`WARNING ${w}`);
  return notPaused ? 3 : warnings.length ? 3 : 0;
}

async function status(api, company, cfg, out) {
  if (!company) {
    out(`company "${cfg.company.name}" does not exist yet (apply.mjs --apply creates it)`);
    return 0;
  }
  const agents = asList(await api.get(`/api/companies/${company.id}/agents`));
  out(`company ${company.id} "${company.name}", ${agents.length} agent${agents.length === 1 ? '' : 's'}`);
  out(['key/name'.padEnd(26), 'role'.padEnd(9), 'status'.padEnd(8), 'timer'.padEnd(6), 'budget/mo'.padEnd(10), 'spent'.padEnd(8), 'last run'].join(' '));
  let notPaused = 0;
  for (const a of orderAgents(cfg)) {
    const got = agents.find((x) => x.name === a.name);
    if (!got) {
      out(`${a.name.padEnd(26)} MISSING (apply.mjs --apply creates it)`);
      continue;
    }
    const full = await api.get(`/api/agents/${got.id}`);
    const st = full.status ?? '?';
    if (st !== 'paused') notPaused++;
    const hb = full.runtimeConfig?.heartbeat;
    out([
      `${a.name}${a.hold ? ' [HELD]' : ''}`.padEnd(26), String(full.role ?? '').padEnd(9), String(st).padEnd(8),
      (hb?.enabled ? `${Math.round((hb.intervalSec ?? 0) / 60)}m` : 'off').padEnd(6),
      cents(full.budgetMonthlyCents ?? 0).padEnd(10), cents(full.spentMonthlyCents ?? 0).padEnd(8),
      full.lastHeartbeatAt ?? 'never',
    ].join(' '));
  }
  out(notPaused ? `${notPaused} agent(s) not paused.` : 'All agents are paused.');
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e) => {
      process.stderr.write(`apply.mjs: ${String(e.message).replace(/\n/g, '\n  ')}\n`);
      process.exit(e.message?.startsWith('Refusing') || /Unknown argument|not a URL|must be http/.test(e.message) ? 2 : 1);
    },
  );
}
