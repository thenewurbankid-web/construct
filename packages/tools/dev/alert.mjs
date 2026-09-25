#!/usr/bin/env node
// #655 -- alerts for the owner and the agent when a build, deploy, test run or agent run fails. GitHub-native and deterministic:
// no model, no third-party service, no secret in any file. An alert is a GitHub issue of this repository labelled `alert` and
// `off-board`, titled `[alert] <key>: <title>`, assigned to the owner (GitHub then notifies by email and mobile), deduplicated
// by the key (a repeat failure comments on the open alert), closed by `resolve` on the next success.
//
//   node packages/tools/dev/alert.mjs raise   --key <k> --title <t> [--body <s> | --body-file <f>] [--severity info|warn|critical]
//                                             [--lane <l>] [--check <c>] [--range <a..b>] [--run-url <u>] [--tail-file <f>]
//   node packages/tools/dev/alert.mjs resolve --key <k> [--note <s>]
//   node packages/tools/dev/alert.mjs status  [--json]                         open alerts, failed runs (24 h), Paperclip agents in trouble
//   node packages/tools/dev/alert.mjs watch   [--json] [--state-file <p>]      the same, only what is new; silent when nothing is
//   node packages/tools/dev/alert.mjs ci-build --branch <b> --outcome <job.status> [--result-file <f>] [--run-url <u>]
//                                             what build-on-ready.yml runs after the build step
//
// Reads and writes go through the `gh` CLI (`GH_TOKEN` is provided in Actions; locally `gh auth login`). Nothing here reads or
// writes a token. Every body passes the redactor and the output tail is cut to 3000 characters. Exit status: 0 done, 1 an
// error (gh missing, not signed in, bad file), 2 usage.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseTagName } from './build-on-ready.mjs';
import { DEFAULT_API, assertApiBase, asList } from '../paperclip/lib.mjs';

export const REPO = 'thenewurbankid-web/construct';
export const OWNER = 'thenewurbankid-web';
export const SEVERITIES = ['info', 'warn', 'critical'];
export const LABELS = [
  { name: 'alert', color: 'b60205', description: 'An automatic failure alert (#655); deduplicated by key, closed on the next success' },
  { name: 'off-board', color: 'ededed', description: 'Not on the project board' },
];
export const TAIL_CHARS = 3000;
/** The workflow name of pages.yml, and the branch whose scheduled run cannot be edited while main is frozen. */
export const DOCS_WORKFLOW = 'Pages documentation';
export const WATCHED_BRANCHES = ['work/2026-09-23', 'studio', 'main'];
export const MAIN_SCHEDULE_KEY = 'docs-main-schedule';
export const MAIN_SCHEDULE_NOTE = 'The scheduled docs build runs from the frozen `main`, whose workflow cannot be edited. This failure is expected until main is unfrozen or its schedule is removed. It alerts at most once a day.';
const MAX_SEEN = 500;

// ------------------------------------------------------------------------------------------------------------ redaction

const SHAPES = [
  /\bgh[pousr]_[A-Za-z0-9]{8,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{8,}/g,
  /\bsk-[A-Za-z0-9_-]{8,}/g,
  /\b(?:AKIA|ASIA)[A-Z0-9]{8,}/g,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi,
];

/**
 * Strip anything token-shaped: GitHub tokens (`ghp_`, `gho_`, `ghu_`, `ghs_`, `ghr_`, `github_pat_`), `sk-` keys, AWS key ids
 * (`AKIA`, `ASIA`), bearer tokens, whole `Authorization:` header values and `NAME_TOKEN=value` assignments.
 *
 * @param {unknown} text Any text.
 * @returns {string} The text with every match replaced by `[redacted]`.
 *
 * @example
 * redact('Authorization: Bearer abc.def.ghi'); // => 'Authorization: [redacted]'
 */
export function redact(text) {
  let s = String(text ?? '');
  s = s.replace(/^([ \t]*(?:-H[ \t]+)?["']?Authorization["']?[ \t]*[:=][ \t]*).*$/gim, '$1[redacted]');
  s = s.replace(/\b([A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|PASSWD|API_?KEY|PRIVATE_?KEY)[A-Z0-9_]*)[ \t]*([=:])[ \t]*(?!\[redacted\])["']?[^\s"']{4,}/g, '$1$2[redacted]');
  for (const re of SHAPES) s = s.replace(re, '[redacted]');
  return s;
}

/**
 * The last `max` characters of a text, redacted before and after the cut (a cut can leave a fragment of a token).
 *
 * @param {unknown} text Command output.
 * @param {number} [max] Character limit (default 3000).
 * @returns {string} The bounded, redacted tail; a leading `...` marks a cut.
 */
export function truncateTail(text, max = TAIL_CHARS) {
  const clean = redact(String(text ?? '').replace(/\r\n/g, '\n').trimEnd());
  if (clean.length <= max) return clean;
  return redact('...' + clean.slice(clean.length - (max - 3)));
}

// ----------------------------------------------------------------------------------------------------------- key, title

/**
 * A key is lowercase letters, digits, dot, underscore and dash (a branch like `work/2026-09-23` becomes `work-2026-09-23`).
 *
 * @param {string} key Any text.
 * @returns {string} The normalised key (at most 80 characters).
 */
export function sanitizeKey(key) {
  return String(key ?? '').toLowerCase().replace(/[^a-z0-9._]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
}

/**
 * @param {string} key The alert key.
 * @param {string} title A short human title.
 * @returns {string} `[alert] <key>: <title>`.
 */
export function alertTitle(key, title) {
  return `[alert] ${sanitizeKey(key)}: ${redact(String(title ?? '').replace(/\s+/g, ' ').trim()).slice(0, 120)}`;
}

/**
 * @param {string} title An issue title.
 * @returns {{ key: string, title: string }|null} The parts of an alert title, or null when it is not one.
 */
export function parseAlertTitle(title) {
  const m = /^\[alert\] ([a-z0-9._-]+): ?(.*)$/.exec(String(title ?? ''));
  return m ? { key: m[1], title: m[2] } : null;
}

/**
 * The alert body from a small set of fields. Everything passes the redactor; the tail is cut to 3000 characters.
 *
 * @param {{ severity?: string, lane?: string, check?: string, range?: string, runUrl?: string, at?: Date, summary?: string, tail?: string, note?: string }} f Fields.
 * @returns {string} Markdown.
 */
export function buildBody(f = {}) {
  const sev = SEVERITIES.includes(f.severity) ? f.severity : 'warn';
  const line = (label, v) => (v ? `**${label}:** ${redact(String(v)).replace(/\s+/g, ' ').slice(0, 300)}` : null);
  const parts = [
    line('Severity', sev),
    line('Lane', f.lane),
    line('Check', f.check),
    line('Commits', String(f.range || '').replace(/^0{7,}\.\./, '').replace(/^\.\./, '')),
    line('Run', f.runUrl),
    line('When', (f.at || new Date()).toISOString()),
  ].filter(Boolean);
  const out = [parts.join('  \n')];
  if (f.summary) out.push(redact(String(f.summary)).slice(0, 2000));
  if (f.note) out.push(`> ${redact(String(f.note)).replace(/\n+/g, ' ')}`);
  if (f.tail) out.push('Last output:\n\n````text\n' + truncateTail(f.tail) + '\n````');
  return out.join('\n\n') + '\n';
}

// ---------------------------------------------------------------------------------------------------------------- gh

/**
 * The real `gh` runner. Tests pass their own with the same shape.
 *
 * @param {{ bin?: string, env?: NodeJS.ProcessEnv, timeoutMs?: number }} [o] Options.
 * @returns {(args: string[], opts?: { input?: string }) => Promise<string>} Runs `gh <args>` (no shell) and resolves its stdout.
 */
export function ghRunner({ bin = 'gh', env = process.env, timeoutMs = 60000 } = {}) {
  return (args, { input } = {}) => new Promise((resolve, reject) => {
    const p = spawn(bin, args, { env, stdio: ['pipe', 'pipe', 'pipe'], timeout: timeoutMs });
    let out = '';
    let err = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', (e) => reject(new Error(redact(`gh could not run: ${e.message}`))));
    p.on('close', (code) => {
      if (code === 0) resolve(out);
      else reject(Object.assign(new Error(redact(`gh ${args.slice(0, 2).join(' ')} exited ${code}: ${err.trim().slice(0, 300)}`)), { code }));
    });
    p.stdin.on('error', () => {});
    p.stdin.end(input ?? '');
  });
}

const json = (text, fallback) => { try { return JSON.parse(text || 'null') ?? fallback; } catch { return fallback; } };

/**
 * Open alert issues of the repository.
 *
 * @param {Function} gh The runner.
 * @param {string} [repo] `owner/name`.
 * @returns {Promise<{ number: number, title: string, url: string, key: string, createdAt: string, updatedAt: string }[]>} Only issues whose title is an alert title.
 */
export async function listOpenAlerts(gh, repo = REPO) {
  const rows = json(await gh(['issue', 'list', '--repo', repo, '--label', 'alert', '--state', 'open', '--limit', '200', '--json', 'number,title,url,createdAt,updatedAt']), []);
  return rows.map((r) => ({ ...r, key: parseAlertTitle(r.title)?.key })).filter((r) => r.key);
}

async function ensureLabels(gh, repo) {
  const have = new Set(json(await gh(['label', 'list', '--repo', repo, '--limit', '200', '--json', 'name']), []).map((l) => l.name));
  const created = [];
  for (const l of LABELS) {
    if (have.has(l.name)) continue;
    await gh(['label', 'create', l.name, '--repo', repo, '--color', l.color, '--description', l.description]);
    created.push(l.name);
  }
  return created;
}

// ------------------------------------------------------------------------------------------------------- raise, resolve

/**
 * Raise an alert: comment on the open alert with this key, else create the issue (creating the two labels first if missing).
 * `info` alerts are not assigned, so they do not notify; `warn` and `critical` are assigned to the owner.
 *
 * @param {{ gh: Function, key: string, title: string, body?: string, severity?: string, repo?: string, owner?: string, at?: Date, fields?: object }} o Options; `fields` go to {@link buildBody}.
 * @returns {Promise<{ action: 'created'|'commented', key: string, number: number, url: string, labelsCreated: string[] }>} What happened.
 *
 * @example
 * await raiseAlert({ gh, key: 'build-work-2026-09-23-cockpit', title: 'lane cockpit held', severity: 'warn' });
 */
export async function raiseAlert({ gh, key, title, body = '', severity = 'warn', repo = REPO, owner = OWNER, at = new Date(), fields = {} }) {
  const k = sanitizeKey(key);
  if (!k) throw new Error('raise needs a --key');
  if (!title) throw new Error('raise needs a --title');
  if (!SEVERITIES.includes(severity)) throw new Error(`--severity must be one of ${SEVERITIES.join(', ')}`);
  const text = buildBody({ ...fields, summary: [body, fields.summary].filter(Boolean).join('\n\n'), severity, at });
  const open = (await listOpenAlerts(gh, repo)).find((a) => a.key === k);
  if (open) {
    await gh(['issue', 'comment', String(open.number), '--repo', repo, '--body-file', '-'], { input: `Repeat failure at ${at.toISOString()}\n\n${text}` });
    return { action: 'commented', key: k, number: open.number, url: open.url, labelsCreated: [] };
  }
  const labelsCreated = await ensureLabels(gh, repo);
  const args = ['issue', 'create', '--repo', repo, '--title', alertTitle(k, title), '--body-file', '-', '--label', 'alert', '--label', 'off-board'];
  if (severity !== 'info') args.push('--assignee', owner);
  const url = (await gh(args, { input: text })).trim().split('\n').pop();
  const number = Number(/\/issues\/(\d+)/.exec(url)?.[1] || 0);
  return { action: 'created', key: k, number, url, labelsCreated };
}

/**
 * Resolve the open alert with this key: comment and close in one command. Nothing open is a no-op.
 *
 * @param {{ gh: Function, key: string, note?: string, repo?: string, at?: Date, open?: object[] }} o Options.
 * @returns {Promise<{ action: 'closed'|'none', key: string, number?: number, url?: string }>} What happened.
 */
export async function resolveAlert({ gh, key, note = '', repo = REPO, at = new Date(), open }) {
  const k = sanitizeKey(key);
  if (!k) throw new Error('resolve needs a --key');
  const hit = (open || await listOpenAlerts(gh, repo)).find((a) => a.key === k);
  if (!hit) return { action: 'none', key: k };
  const comment = `Resolved at ${at.toISOString()}${note ? `: ${redact(note).replace(/\s+/g, ' ').slice(0, 300)}` : '.'}`;
  await gh(['issue', 'close', String(hit.number), '--repo', repo, '--reason', 'completed', '--comment', comment]);
  return { action: 'closed', key: k, number: hit.number, url: hit.url };
}

// ------------------------------------------------------------------------------------------------------------- status

/**
 * Workflow runs that failed in the window; a run is `recovered` when a later run of the same workflow on the same branch succeeded.
 *
 * @param {Function} gh The runner.
 * @param {{ branches?: string[], now?: Date, hours?: number, repo?: string }} [o] Options.
 * @returns {Promise<{ runs: object[], errors: string[] }>} Failed runs newest first, and the branches that could not be read.
 */
export async function failedRuns(gh, { branches = WATCHED_BRANCHES, now = new Date(), hours = 24, repo = REPO } = {}) {
  const since = now.getTime() - hours * 3600 * 1000;
  const runs = [];
  const errors = [];
  for (const branch of branches) {
    let rows;
    try {
      rows = json(await gh(['run', 'list', '--repo', repo, '--branch', branch, '--limit', '40', '--json', 'databaseId,workflowName,displayTitle,headBranch,headSha,event,conclusion,createdAt,url']), []);
    } catch (e) { errors.push(`runs of ${branch}: ${e.message}`); continue; }
    for (const r of rows) {
      if (!['failure', 'timed_out', 'startup_failure'].includes(r.conclusion) || Date.parse(r.createdAt) < since) continue;
      const later = rows.some((x) => x.workflowName === r.workflowName && x.conclusion === 'success' && Date.parse(x.createdAt) > Date.parse(r.createdAt));
      runs.push({ id: r.databaseId, workflow: r.workflowName, title: r.displayTitle, branch: r.headBranch || branch, sha: String(r.headSha || '').slice(0, 9), event: r.event, conclusion: r.conclusion, at: r.createdAt, url: r.url, recovered: later });
    }
  }
  return { runs: runs.sort((a, b) => Date.parse(b.at) - Date.parse(a.at)), errors };
}

/**
 * Paperclip agents that need attention: status `error`, or paused by a budget hard stop. Agents the owner paused are ignored.
 * Read-only; an unreachable Paperclip is not an error (it is simply not running).
 *
 * @param {{ fetchImpl?: typeof fetch, api?: string, company?: string, timeoutMs?: number }} [o] Options.
 * @returns {Promise<{ reachable: boolean, agents: object[], error?: string }>} The agents in trouble.
 */
export async function paperclipTrouble({ fetchImpl = fetch, api = DEFAULT_API, company = 'Line', timeoutMs = 2500 } = {}) {
  const base = assertApiBase(api);
  const get = async (p) => {
    const res = await fetchImpl(base + p, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) throw Object.assign(new Error(`GET ${p} -> ${res.status}`), { http: true });
    return res.json();
  };
  let companies;
  try { companies = asList(await get('/api/companies')); } catch (e) {
    return e.http ? { reachable: true, agents: [], error: e.message } : { reachable: false, agents: [] };
  }
  const c = companies.find((x) => x.name === company);
  if (!c) return { reachable: true, agents: [], error: `no company "${company}"` };
  let list;
  try { list = asList(await get(`/api/companies/${c.id}/agents`)); } catch (e) { return { reachable: true, agents: [], error: e.message }; }
  const agents = [];
  for (const a of list) {
    const budgetStop = /budget/i.test(String(a.pauseReason || ''));
    if (a.status === 'error' || (a.status !== 'paused' && a.errorReason)) {
      agents.push({ id: a.id, name: a.name, status: 'error', reason: String(a.errorReason || 'error').slice(0, 200) });
    } else if (budgetStop) {
      agents.push({ id: a.id, name: a.name, status: 'budget-hard-stop', reason: `spent ${a.spentMonthlyCents ?? '?'} of ${a.budgetMonthlyCents ?? '?'} cents` });
    }
  }
  return { reachable: true, agents };
}

/**
 * The three sources in one document: open alert issues, failed runs of the last 24 hours, Paperclip agents in trouble.
 * A source that cannot be read is named in `errors`; the others are still reported.
 *
 * @param {{ gh: Function, fetchImpl?: typeof fetch, now?: Date, repo?: string, paperclip?: string|false, branches?: string[] }} o Options (`paperclip: false` skips that source).
 * @returns {Promise<{ alerts: object[], runs: object[], agents: object[], paperclip: 'ok'|'unreachable'|'skipped', errors: string[] }>} The merged status.
 */
export async function collectStatus({ gh, fetchImpl = fetch, now = new Date(), repo = REPO, paperclip = DEFAULT_API, branches = WATCHED_BRANCHES }) {
  const errors = [];
  let alerts = [];
  try { alerts = await listOpenAlerts(gh, repo); } catch (e) { errors.push(`alerts: ${e.message}`); }
  const fr = await failedRuns(gh, { branches, now, repo });
  errors.push(...fr.errors);
  let agents = [];
  let pc = 'skipped';
  if (paperclip !== false) {
    const t = await paperclipTrouble({ fetchImpl, api: paperclip });
    pc = t.reachable ? 'ok' : 'unreachable';
    agents = t.agents;
    if (t.error) errors.push(`paperclip: ${t.error}`);
  }
  return { alerts: alerts.map((a) => ({ number: a.number, key: a.key, title: a.title, url: a.url, updatedAt: a.updatedAt })), runs: fr.runs, agents, paperclip: pc, errors };
}

/**
 * The items of a status, each with a stable id (what `watch` remembers) and one line of text.
 *
 * @param {{ alerts: object[], runs: object[], agents: object[], errors: string[] }} st From {@link collectStatus}.
 * @param {Date} [now] For the daily id of a source error.
 * @returns {{ id: string, kind: 'alert'|'run'|'agent'|'error', text: string, url?: string }[]} Items; recovered runs are left out.
 */
export function statusItems(st, now = new Date()) {
  const day = now.toISOString().slice(0, 10);
  return [
    ...st.alerts.map((a) => ({ id: `alert:${a.number}`, kind: 'alert', text: `alert #${a.number} ${a.title}`, url: a.url })),
    ...st.runs.filter((r) => !r.recovered).map((r) => ({ id: `run:${r.id}`, kind: 'run', text: `run failed: ${r.workflow} on ${r.branch} (${r.event}) ${r.at} ${r.sha}`, url: r.url })),
    ...st.agents.map((a) => ({ id: `agent:${a.id}:${a.status}`, kind: 'agent', text: `paperclip agent ${a.name}: ${a.status} (${a.reason})` })),
    ...st.errors.map((e) => ({ id: `error:${day}:${e.slice(0, 60)}`, kind: 'error', text: `alerts could not read a source: ${e}` })),
  ];
}

/**
 * @param {Awaited<ReturnType<typeof collectStatus>>} st The status.
 * @returns {string} A few lines of text.
 */
export function formatStatus(st) {
  const out = [`open alerts (${st.alerts.length})`];
  for (const a of st.alerts) out.push(`  #${a.number} ${a.title}  ${a.url}`);
  out.push(`failed runs in the last 24 hours (${st.runs.length})`);
  for (const r of st.runs) out.push(`  ${r.workflow} on ${r.branch} (${r.event}) ${r.at} ${r.sha}${r.recovered ? '  [recovered by a later green run]' : ''}  ${r.url}`);
  out.push(st.paperclip === 'ok' ? `paperclip agents in trouble (${st.agents.length})` : `paperclip: ${st.paperclip === 'unreachable' ? 'not answering on this machine (skipped)' : 'skipped'}`);
  for (const a of st.agents) out.push(`  ${a.name}: ${a.status} (${a.reason})`);
  for (const e of st.errors) out.push(`could not read: ${e}`);
  return out.join('\n');
}

// -------------------------------------------------------------------------------------------------------------- watch

/**
 * @returns {string} The default state file, `<user cache dir>/construct/alerts.json` (`XDG_CACHE_HOME` or `~/.cache`).
 */
export function defaultStateFile() {
  return path.join(process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache'), 'construct', 'alerts.json');
}

/**
 * @param {string} file State file.
 * @returns {{ version: 1, seen: Record<string, string>, daily: Record<string, string> }} The state; a missing or damaged file is a fresh one.
 */
export function loadState(file) {
  try {
    const s = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (s && typeof s.seen === 'object') return { version: 1, seen: s.seen || {}, daily: s.daily && typeof s.daily === 'object' ? s.daily : {} };
  } catch { /* fresh */ }
  return { version: 1, seen: {}, daily: {} };
}

/**
 * Write the state atomically (temp file in the same directory, then rename), keeping at most 500 seen ids (the oldest go first).
 *
 * @param {string} file State file.
 * @param {{ seen: Record<string, string>, daily: Record<string, string> }} state The state.
 */
export function saveState(file, state) {
  const ids = Object.entries(state.seen).sort((a, b) => String(a[1]).localeCompare(String(b[1]))).slice(-MAX_SEEN);
  const body = JSON.stringify({ version: 1, seen: Object.fromEntries(ids), daily: state.daily }, null, 1) + '\n';
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, body, { mode: 0o600 });
  fs.renameSync(tmp, file);
}

/**
 * Print only what is new since the last call. Also raises (at most once a day) the alert for a failed SCHEDULED docs build of
 * `main`, which no workflow edit can cover while main is frozen. Nothing new: an empty result, so a caller prints nothing.
 *
 * @param {{ gh: Function, fetchImpl?: typeof fetch, now?: Date, repo?: string, paperclip?: string|false, stateFile?: string, branches?: string[] }} o Options.
 * @returns {Promise<{ items: object[], raised: object|null }>} The new items (with the raised alert, when there is one).
 */
export async function watch({ gh, fetchImpl = fetch, now = new Date(), repo = REPO, paperclip = DEFAULT_API, stateFile = defaultStateFile(), branches = WATCHED_BRANCHES }) {
  const state = loadState(stateFile);
  const st = await collectStatus({ gh, fetchImpl, now, repo, paperclip, branches });
  const today = now.toISOString().slice(0, 10);
  let raised = null;
  const scheduled = st.runs.find((r) => r.workflow === DOCS_WORKFLOW && r.branch === 'main' && r.event === 'schedule');
  if (scheduled && state.daily[MAIN_SCHEDULE_KEY] !== today) {
    try {
      raised = await raiseAlert({
        gh, repo, at: now, key: MAIN_SCHEDULE_KEY, title: 'the scheduled docs build of main failed', severity: 'warn',
        fields: { runUrl: scheduled.url, lane: 'docs', check: `${DOCS_WORKFLOW} (schedule) on main`, note: MAIN_SCHEDULE_NOTE },
      });
      state.daily[MAIN_SCHEDULE_KEY] = today;
    } catch (e) { st.errors.push(`raising ${MAIN_SCHEDULE_KEY}: ${e.message}`); }
  }
  const items = statusItems(st, now).filter((i) => !state.seen[i.id]);
  if (raised) items.push({ id: `raised:${raised.key}:${today}`, kind: 'alert', text: `raised alert #${raised.number} ${raised.key} (${raised.action})`, url: raised.url });
  for (const i of items) state.seen[i.id] = now.toISOString();
  // recovered runs and everything currently listed are remembered too, so a later flip does not re-announce them
  for (const r of st.runs) state.seen[`run:${r.id}`] ||= now.toISOString();
  if (items.length || raised) saveState(stateFile, state);
  else if (!fs.existsSync(stateFile)) saveState(stateFile, state);
  return { items, raised };
}

// ------------------------------------------------------------------------------------------------------------- CI build

/**
 * Read the text build-on-ready.mjs prints (`BUILD <tag>  <from>..<to> ... [status]`, `  HELD: <check> failed after <n>s` and its
 * indented tail, `  ERROR: ...`), so the CI step needs no change to the tagging step.
 *
 * @param {string} text The saved result of the build step.
 * @returns {{ builds: { tag: string, lane: string, range: string, status: string, held: { check: string, tail: string }[], error: string }[] }} One entry per BUILD line.
 */
export function parseBuildOutput(text) {
  const builds = [];
  let cur = null;
  let held = null;
  for (const line of String(text || '').split('\n')) {
    const b = /^BUILD (\S+)\s+(\S+\.\.\S+)\s.*\[(\w+)\]\s*$/.exec(line);
    if (b) {
      cur = { tag: b[1], lane: parseTagName(b[1])?.lane || b[1].split('/')[0], range: b[2], status: b[3], held: [], error: '' };
      builds.push(cur);
      held = null;
      continue;
    }
    const h = /^ {2}HELD: (.+?) failed after (\d+)s$/.exec(line);
    if (h && cur) { held = { check: `${h[1]} (failed after ${h[2]}s)`, tail: '' }; cur.held.push(held); continue; }
    if (held && line.startsWith('    ')) { held.tail += `${line.slice(4)}\n`; continue; }
    const e = /^ {2}ERROR: (.*)$/.exec(line);
    if (e && cur) { cur.error = e[1]; held = null; continue; }
    if (!line.startsWith(' ')) held = null;
  }
  return { builds };
}

/**
 * The alert work for one build-on-ready run: raise `build-<branch>-<lane>` for every held lane, `build-<branch>` for a failed run
 * with no held lane (or a tag that could not be pushed), and resolve the matching keys when the run went green.
 *
 * @param {{ gh: Function, branch: string, outcome: string, resultText?: string, runUrl?: string, range?: string, repo?: string, at?: Date }} o `outcome` is the job status (`success`, `failure`, `cancelled`).
 * @returns {Promise<{ raised: object[], resolved: object[], skipped?: string }>} What was done.
 */
export async function alertForBuild({ gh, branch, outcome, resultText = '', runUrl = '', range = '', repo = REPO, at = new Date() }) {
  const out = { raised: [], resolved: [] };
  if (outcome === 'cancelled') return { ...out, skipped: 'the run was cancelled' };
  const base = `build-${sanitizeKey(branch)}`;
  const { builds } = parseBuildOutput(resultText);
  const heldBuilds = builds.filter((b) => b.held.length);
  const broken = builds.filter((b) => b.status === 'failed');
  const failed = outcome !== 'success' || heldBuilds.length > 0 || broken.length > 0;
  if (failed) {
    for (const b of heldBuilds) {
      out.raised.push(await raiseAlert({
        gh, repo, at, key: `${base}-${b.lane}`, title: `lane ${b.lane} held by a failing check`, severity: 'warn',
        fields: { lane: b.lane, check: b.held.map((x) => x.check).join('; '), range: b.range, runUrl, tail: b.held.map((x) => x.tail).join('\n'),
          summary: `The ${b.lane} lane was not tagged on ${branch}: its light check failed. The other lanes were still built.` },
      }));
    }
    if (!heldBuilds.length) {
      out.raised.push(await raiseAlert({
        gh, repo, at, key: base, title: `build run failed on ${branch}`, severity: 'warn',
        fields: { check: broken.length ? `tagging ${broken.map((b) => b.lane).join(', ')} failed` : 'a step outside the lane checks (checkout, plan, install)', range, runUrl,
          tail: broken.map((b) => b.error).join('\n') || resultText, summary: `The build-on-ready run for ${branch} failed before any lane was held.` },
      }));
    }
  }
  const open = await listOpenAlerts(gh, repo);
  const stale = (key) => !out.raised.some((r) => r.key === key);
  for (const a of open.filter((x) => (x.key === base || x.key.startsWith(`${base}-`)) && stale(x.key))) {
    const lane = a.key === base ? null : a.key.slice(base.length + 1);
    const laneBuilt = lane && builds.some((b) => b.lane === lane && b.status === 'built');
    // green: resolve every key of this branch; red: only what this run explains away (built lane, or the run-level key when a lane is held)
    const explained = !failed || laneBuilt || (a.key === base && heldBuilds.length > 0);
    if (!explained) continue;
    out.resolved.push(await resolveAlert({ gh, repo, at, key: a.key, open, note: failed ? 'a later run built this lane' : 'the build run is green again' }));
  }
  return out;
}

// ----------------------------------------------------------------------------------------------------------------- CLI

const USAGE = `usage: alert.mjs raise --key K --title T [--body S | --body-file F] [--severity info|warn|critical] [--lane L] [--check C] [--range A..B] [--run-url U] [--tail-file F]
       alert.mjs resolve --key K [--note S]
       alert.mjs status [--json]
       alert.mjs watch [--json] [--state-file P]
       alert.mjs ci-build --branch B --outcome success|failure|cancelled [--result-file F] [--run-url U] [--range A..B]
options for every command: --repo owner/name, --paperclip URL|off`;

/**
 * @param {string[]} argv Arguments after the script name.
 * @returns {{ cmd: string, flags: Record<string, string|boolean> }} Parsed; `--x v` is a value, a bare `--json` is true.
 */
export function parseArgs(argv) {
  const [cmd, ...rest] = argv;
  const flags = {};
  const boolean = new Set(['json', 'help']);
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (!a.startsWith('--')) throw new Error(`unexpected argument "${a}"`);
    const name = a.slice(2);
    if (boolean.has(name)) flags[name] = true;
    else if (rest[i + 1] === undefined) throw new Error(`--${name} needs a value`);
    else flags[name] = rest[++i];
  }
  return { cmd, flags };
}

const readIf = (file) => (file ? fs.readFileSync(file, 'utf8') : '');

/**
 * Run one command; returns what to print and the exit code (the CLI below only prints and exits).
 *
 * @param {string[]} argv Arguments.
 * @param {{ gh?: Function, fetchImpl?: typeof fetch, now?: Date, env?: NodeJS.ProcessEnv }} [deps] Injectable runner, fetch, clock and environment.
 * @returns {Promise<{ code: number, out: string }>} Result.
 */
export async function main(argv, { gh = ghRunner(), fetchImpl = fetch, now = new Date(), env = process.env } = {}) {
  let parsed;
  try { parsed = parseArgs(argv); } catch (e) { return { code: 2, out: `${e.message}\n${USAGE}` }; }
  const { cmd, flags } = parsed;
  const repo = flags.repo || env.GITHUB_REPOSITORY || REPO;
  const paperclip = flags.paperclip === 'off' ? false : flags.paperclip || DEFAULT_API;
  try {
    if (cmd === 'raise') {
      if (!flags.key || !flags.title) return { code: 2, out: USAGE };
      const body = flags.body ?? readIf(flags['body-file']);
      const r = await raiseAlert({ gh, repo, at: now, key: flags.key, title: flags.title, body, severity: flags.severity || 'warn',
        fields: { lane: flags.lane, check: flags.check, range: flags.range, runUrl: flags['run-url'], tail: readIf(flags['tail-file']) } });
      return { code: 0, out: flags.json ? JSON.stringify(r) : `${r.action} alert ${r.key} #${r.number} ${r.url}` };
    }
    if (cmd === 'resolve') {
      if (!flags.key) return { code: 2, out: USAGE };
      const r = await resolveAlert({ gh, repo, at: now, key: flags.key, note: flags.note });
      return { code: 0, out: flags.json ? JSON.stringify(r) : r.action === 'closed' ? `closed alert ${r.key} #${r.number}` : `no open alert ${r.key}` };
    }
    if (cmd === 'status') {
      const st = await collectStatus({ gh, fetchImpl, now, repo, paperclip });
      return { code: 0, out: flags.json ? JSON.stringify(st) : formatStatus(st) };
    }
    if (cmd === 'watch') {
      const w = await watch({ gh, fetchImpl, now, repo, paperclip, stateFile: flags['state-file'] || defaultStateFile() });
      if (!w.items.length) return { code: 0, out: '' };
      return { code: 0, out: flags.json ? JSON.stringify({ new: w.items }) : w.items.map((i) => `${i.text}${i.url ? `  ${i.url}` : ''}`).join('\n') };
    }
    if (cmd === 'ci-build') {
      if (!flags.branch || !flags.outcome) return { code: 2, out: USAGE };
      const r = await alertForBuild({ gh, repo, at: now, branch: flags.branch, outcome: flags.outcome, resultText: readIf(flags['result-file'] && fs.existsSync(flags['result-file']) ? flags['result-file'] : ''), runUrl: flags['run-url'], range: flags.range });
      return { code: 0, out: r.skipped ? `skipped: ${r.skipped}` : `raised ${r.raised.map((x) => `${x.key}#${x.number} (${x.action})`).join(', ') || 'none'}; resolved ${r.resolved.filter((x) => x.action === 'closed').map((x) => `${x.key}#${x.number}`).join(', ') || 'none'}` };
    }
    return { code: 2, out: USAGE };
  } catch (e) {
    return { code: 1, out: `alert: ${e.message}` };
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { code, out } = await main(process.argv.slice(2));
  if (out) (code === 0 ? process.stdout : process.stderr).write(`${redact(out)}\n`);
  process.exitCode = code;
}
