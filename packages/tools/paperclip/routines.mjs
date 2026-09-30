#!/usr/bin/env node
// Applies company.json "routines" to Paperclip: native recurring work that materializes auditable execution tasks.
//   node packages/tools/paperclip/routines.mjs                  dry run (default): prints what it would create, writes nothing
//   node packages/tools/paperclip/routines.mjs --apply          create the missing routines (PAUSED) and their schedule triggers
//   node packages/tools/paperclip/routines.mjs --status         every routine: status, cron, last runs
// Options: --api <url> (loopback only unless --allow-remote), --config <company.json>.
//
// Why routines rather than a standing task that re-arms its own check-in: a routine carries its own schedule, so it still
// fires when a run dies before writing anything. On 2026-09-29 a DNS fault killed the Flow Controller mid-run, its LIN-121
// check-in was never written, and nothing on the board could wake it again - 25 tasks piled up behind a component that had
// become permanently inert. A plain heartbeat timer does not fix that for the Flow Controller either: a timer run carries no
// $PAPERCLIP_TASK_ID and agents/flow/HEARTBEAT.md ends a task-less run immediately. A routine gives both a durable schedule
// and a task context.
//
// SAFETY, same model as apply.mjs: routines are created PAUSED and this script never activates one, never deletes anything,
// and never edits an existing routine's schedule. The owner activates in the Paperclip UI (Routines) or with --activate <key>.
import path from 'node:path';
import { DEFAULT_API, asList, assertApiBase, createClient, loadConfig, makeOut } from './lib.mjs';

export function parseArgs(argv) {
  const o = { api: DEFAULT_API, apply: false, allowRemote: false, config: undefined, status: false, activate: undefined };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--apply') o.apply = true;
    else if (a === '--status') o.status = true;
    else if (a === '--activate') o.activate = argv[++i];
    else if (a === '--allow-remote') o.allowRemote = true;
    else if (a === '--api') o.api = argv[++i];
    else if (a === '--config') o.config = argv[++i];
    else if (a === '--help' || a === '-h') o.help = true;
    else throw new Error(`Unknown argument: ${a}`);
  }
  return o;
}

const PLAN_KEYS = ['priority', 'concurrencyPolicy', 'catchUpPolicy', 'activityGatePolicy'];

/** company.json routine entry + defaults -> the POST body Paperclip wants. */
export function routineBody(item, defaults, agentId) {
  const merged = { ...defaults, ...item };
  const body = {
    title: item.title,
    description: item.description ?? '',
    status: 'paused', // never created active; the owner activates
  };
  if (agentId) body.assigneeAgentId = agentId;
  for (const k of PLAN_KEYS) if (merged[k] !== undefined) body[k] = merged[k];
  return body;
}

export async function run(argv, { out = makeOut() } = {}) {
  const opts = parseArgs(argv);
  if (opts.help) {
    out('usage: routines.mjs [--apply] [--status] [--activate KEY] [--api URL] [--allow-remote] [--config FILE]');
    return 0;
  }
  const base = assertApiBase(opts.api, { allowRemote: opts.allowRemote });
  const api = createClient(base);
  const cfg = opts.config ? loadConfig(path.resolve(opts.config)) : loadConfig();

  const company = asList(await api.get('/api/companies')).find((c) => c.name === cfg.company.name);
  if (!company) throw new Error(`company "${cfg.company.name}" not found - run apply.mjs --apply first`);
  const agents = asList(await api.get(`/api/companies/${company.id}/agents`));
  // company.json identifies an agent by its own "key"; Paperclip knows it by name (urlKey is Paperclip's own slug,
  // e.g. key "flow" -> name "Flow Controller" -> urlKey "flow-controller"). Resolve through the config's name.
  const nameForKey = new Map((cfg.agents ?? []).map((a) => [a.key, a.name]));
  const byName = new Map(agents.map((a) => [a.name, a]));
  const byKey = new Map([...nameForKey].filter(([, n]) => byName.has(n)).map(([k, n]) => [k, byName.get(n)]));
  const existing = asList(await api.get(`/api/companies/${company.id}/routines`));

  const spec = cfg.routines ?? {};
  const defaults = spec.defaults ?? {};
  const items = spec.items ?? [];

  if (opts.status) {
    out(`Paperclip ${base} | company "${company.name}" | ROUTINES`);
    if (!existing.length) return out('no routines defined'), 0;
    for (const r of existing) {
      const triggers = asList(r.triggers).map((t) => (t.kind === 'schedule' ? `${t.cronExpression}${t.enabled === false ? ' (trigger off)' : ''}` : t.kind)).join(', ');
      let last = '';
      try {
        const runs = asList(await api.get(`/api/routines/${r.id}/runs?limit=3`));
        last = runs.map((x) => `${(x.status ?? '?')}@${String(x.createdAt ?? x.startedAt ?? '').slice(11, 19)}`).join(' ');
      } catch { last = '(runs unavailable)'; }
      out(`${(r.title ?? '').padEnd(26)} ${String(r.status).padEnd(8)} ${triggers || '(no trigger)'}  ${last}`);
    }
    return 0;
  }

  if (opts.activate) {
    const item = items.find((i) => i.key === opts.activate);
    if (!item) throw new Error(`no routine with key "${opts.activate}" in company.json`);
    const have = existing.find((r) => r.title === item.title);
    if (!have) throw new Error(`routine "${item.title}" does not exist yet - run --apply first`);
    if (!opts.apply) {
      out(`DRY RUN: would activate "${item.title}" (${have.status} -> active). Re-run with --apply to do it.`);
      return 0;
    }
    await api.patch(`/api/routines/${have.id}`, { status: 'active' });
    out(`ACTIVATED ${item.title}`);
    return 0;
  }

  const write = opts.apply;
  out(`Paperclip ${base} | company "${company.name}" | ${items.length} routine(s) | ${write ? 'APPLY (writes)' : 'DRY RUN (no writes; add --apply)'}`);
  if (!items.length) return out('company.json has no routines.items - nothing to do'), 0;

  let changes = 0;
  for (const item of items) {
    const agent = item.agent ? byKey.get(item.agent) : null;
    if (item.agent && !agent) {
      out(`SKIP ${item.key}: agent "${item.agent}" not found - run apply.mjs --apply first`);
      continue;
    }
    const have = existing.find((r) => r.title === item.title);
    if (have) {
      const drift = PLAN_KEYS.filter((k) => item[k] !== undefined && have[k] !== undefined && have[k] !== item[k]);
      out(`OK   ${item.key} -> "${item.title}" (${have.status})${drift.length ? ` DRIFT: ${drift.join(', ')} - change in the UI on purpose, this script never edits a live routine` : ''}`);
      continue;
    }
    changes++;
    const body = routineBody(item, defaults, agent?.id);
    const cron = item.cron ?? defaults.cron;
    const tz = item.timezone ?? defaults.timezone;
    out(`CREATE ${item.key} -> "${item.title}" paused, ${item.agent ?? 'unassigned'}, cron ${cron} ${tz ?? ''} [${PLAN_KEYS.map((k) => `${k}=${body[k]}`).join(' ')}]`);
    if (!write) continue;
    const made = await api.post(`/api/companies/${company.id}/routines`, body);
    const id = made?.id ?? made?.routine?.id;
    if (!id) throw new Error(`create returned no id for ${item.key}`);
    if (cron) {
      await api.post(`/api/routines/${id}/triggers`, { kind: 'schedule', cronExpression: cron, ...(tz ? { timezone: tz } : {}), label: item.key, enabled: true });
      out(`  trigger schedule ${cron} ${tz ?? ''} added`);
    }
  }
  out(changes === 0 ? 'nothing to create' : write ? `created ${changes} routine(s), all PAUSED - activate with --activate <key> --apply, or in the Paperclip UI` : `${changes} to create - re-run with --apply`);
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  run(process.argv.slice(2)).then((c) => process.exit(c ?? 0), (e) => { makeOut(process.stderr)(`error: ${e.message}`); process.exit(1); });
}
