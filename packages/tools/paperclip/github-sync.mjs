#!/usr/bin/env node
// One-way, deterministic bridge: GitHub issues -> Paperclip issues. GitHub stays the source of truth.
//   node packages/tools/paperclip/github-sync.mjs           dry run (default): prints what it would create, patch or close
//   node packages/tools/paperclip/github-sync.mjs --apply    write to Paperclip
// Options: --api <url> (default http://127.0.0.1:3100, loopback only unless --allow-remote), --config <company.json>,
//          --gh <command> (default "gh"; only used for READS: issue list/view and project item-list).
// Mirrors the OPEN issues of the configured milestone (v0.10.0): title "[#N] <title>", body = the GitHub URL plus the first
// 1500 characters, label from the board Module, assigned to the lane agent by company.json laneMapping, created in `backlog`
// (moving one to todo is the owner's go). Idempotent by the "[#N]" title prefix. A Paperclip mirror whose GitHub issue is
// closed is set to done. Never writes to GitHub. Issues labelled off-board are skipped unless laneMapping.byIssue names them.
import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { DEFAULT_API, asList, assertApiBase, createClient, loadConfig, makeOut, redact, validateConfig } from './lib.mjs';

const execFileP = promisify(execFile);

export function parseArgs(argv) {
  const o = { api: DEFAULT_API, apply: false, allowRemote: false, gh: process.env.PAPERCLIP_SYNC_GH || 'gh', config: undefined };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--apply') o.apply = true;
    else if (a === '--dry-run') o.apply = false;
    else if (a === '--allow-remote') o.allowRemote = true;
    else if (a === '--api') o.api = argv[++i];
    else if (a === '--config') o.config = argv[++i];
    else if (a === '--gh') o.gh = argv[++i];
    else throw new Error(`Unknown argument: ${a}`);
  }
  return o;
}

/** Lane for one GitHub issue: byIssue, then Module/Sub-module, then the fallback. Returns { lane, why }. */
export function laneFor(mapping, number, module, subModule) {
  const byIssue = mapping.byIssue?.[String(number)];
  if (byIssue) return { lane: byIssue, why: `issue #${number}` };
  const m = module && mapping.byModule?.[module];
  if (m) {
    const sub = subModule && m.subModules?.[subModule];
    if (sub) return { lane: sub, why: `${module} / ${subModule}` };
    return { lane: m.default, why: module };
  }
  return { lane: mapping.fallback, why: module ? `unmapped module ${module}` : 'not on the board' };
}

export const mirrorTitle = (n, title) => `[#${n}] ${title}`;
export const mirrorBody = (url, body, chars) => `${url}\n\n${String(body ?? '').slice(0, chars)}`.trimEnd();
const PREFIX = /^\[#(\d+)\]/;

async function ghJson(opts, args) {
  const { stdout } = await execFileP(opts.gh, args, { maxBuffer: 64 * 1024 * 1024 });
  return JSON.parse(stdout);
}

export async function run(argv, { out = makeOut() } = {}) {
  const opts = parseArgs(argv);
  const base = assertApiBase(opts.api, { allowRemote: opts.allowRemote });
  const api = createClient(base);
  const cfg = opts.config ? loadConfig(path.resolve(opts.config)) : loadConfig();
  validateConfig(cfg);
  const gh = cfg.github;
  const write = opts.apply;
  out(`GitHub ${gh.repo} milestone ${gh.milestone} -> Paperclip ${base} | ${write ? 'APPLY (writes to Paperclip only)' : 'DRY RUN (no writes; add --apply)'}`);

  // ---- Paperclip side
  const company = asList(await api.get('/api/companies')).find((c) => c.name === cfg.company.name);
  if (!company) throw new Error(`Paperclip company "${cfg.company.name}" does not exist; run apply.mjs --apply first`);
  const agents = asList(await api.get(`/api/companies/${company.id}/agents`));
  const agentIdForLane = (lane) => {
    const key = cfg.lanes[lane]?.dev;
    const name = cfg.agents.find((a) => a.key === key)?.name;
    return agents.find((a) => a.name === name)?.id ?? null;
  };
  const labels = asList(await api.get(`/api/companies/${company.id}/labels`));
  const issues = [];
  for (let offset = 0; ; offset += 200) {
    const page = asList(await api.get(`/api/companies/${company.id}/issues?limit=200&offset=${offset}`));
    const fresh = page.filter((p) => !issues.some((i) => i.id === p.id));
    if (!fresh.length) break;
    issues.push(...fresh);
    if (page.length < 200) break;
  }
  const mirrors = new Map();
  for (const i of issues) {
    const m = PREFIX.exec(i.title ?? '');
    if (m) mirrors.set(Number(m[1]), i);
  }

  // ---- GitHub side (reads only)
  const ghIssues = await ghJson(opts, ['issue', 'list', '--repo', gh.repo, '--milestone', gh.milestone, '--state', 'open', '--limit', '500', '--json', 'number,title,body,url,labels']);
  const items = (await ghJson(opts, ['project', 'item-list', String(gh.project.number), '--owner', gh.project.owner, '--format', 'json', '--limit', '1000'])).items ?? [];
  const board = new Map(items.filter((i) => i.content?.number != null).map((i) => [i.content.number, i]));

  let changes = 0;
  const counts = { create: 0, patch: 0, close: 0, skip: 0, ok: 0 };
  const labelId = async (name) => {
    let l = labels.find((x) => x.name === name);
    if (l) return l.id;
    changes++;
    out(`  CREATE label "${name}"`);
    l = write
      ? await api.post(`/api/companies/${company.id}/labels`, { name, color: cfg.labelColors?.[name] ?? '#cccccc' })
      : { id: `<new-label:${name}>`, name };
    labels.push(l);
    return l.id;
  };

  const openNumbers = new Set();
  for (const gi of [...ghIssues].sort((a, b) => a.number - b.number)) {
    openNumbers.add(gi.number);
    const names = (gi.labels ?? []).map((l) => l.name);
    const forced = cfg.laneMapping.byIssue?.[String(gi.number)];
    if (!forced && names.some((n) => (gh.skipLabels ?? []).includes(n))) {
      counts.skip++;
      out(`SKIP #${gi.number} (label ${names.find((n) => gh.skipLabels.includes(n))})`);
      continue;
    }
    const item = board.get(gi.number);
    const { lane, why } = laneFor(cfg.laneMapping, gi.number, item?.module, item?.['sub-module']);
    const assignee = agentIdForLane(lane);
    const title = mirrorTitle(gi.number, gi.title);
    const have = mirrors.get(gi.number);
    if (have) {
      if (have.title !== title) {
        changes++;
        counts.patch++;
        out(`PATCH #${gi.number}: title`);
        if (write) await api.patch(`/api/issues/${have.id}`, { title });
      } else {
        counts.ok++;
        out(`OK #${gi.number} ${have.id} (${have.status})`);
      }
      continue;
    }
    const labelName = item?.module ?? (lane === 'adhoc' ? 'Studio' : 'Unclassified');
    const lid = await labelId(labelName);
    const priority = cfg.priorityMap?.[item?.priority];
    const body = {
      title,
      description: mirrorBody(gi.url, gi.body, gh.bodyChars ?? 1500),
      status: gh.createStatus ?? 'backlog',
      labelIds: [lid],
      ...(assignee ? { assigneeAgentId: assignee } : {}),
      ...(priority ? { priority } : {}),
    };
    changes++;
    counts.create++;
    out(`CREATE #${gi.number} -> ${lane} (${why})${assignee ? '' : ' UNASSIGNED: agent not found, run apply.mjs'} [${labelName}${priority ? `, ${priority}` : ''}] ${gi.title.slice(0, 70)}`);
    if (write) await api.post(`/api/companies/${company.id}/issues`, body);
  }

  // ---- close mirrors whose GitHub issue is closed
  for (const [n, have] of [...mirrors].sort((a, b) => a[0] - b[0])) {
    if (openNumbers.has(n) || ['done', 'cancelled'].includes(have.status)) continue;
    const view = await ghJson(opts, ['issue', 'view', String(n), '--repo', gh.repo, '--json', 'state,number']);
    if (String(view.state).toUpperCase() === 'CLOSED') {
      changes++;
      counts.close++;
      out(`CLOSE #${n}: GitHub issue is closed -> Paperclip done`);
      if (write) await api.patch(`/api/issues/${have.id}`, { status: 'done' });
    } else out(`KEEP #${n}: still open on GitHub but no longer in milestone ${gh.milestone}`);
  }

  out('');
  out(`${write ? 'Applied' : 'Would apply'} ${changes} change${changes === 1 ? '' : 's'}: ${counts.create} create, ${counts.patch} patch, ${counts.close} close; ${counts.ok} already mirrored, ${counts.skip} skipped.`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e) => {
      process.stderr.write(`github-sync.mjs: ${redact(String(e.message))}\n`);
      process.exit(/Refusing|Unknown argument/.test(e.message) ? 2 : 1);
    },
  );
}
