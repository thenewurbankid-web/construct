#!/usr/bin/env node
// Finds work that has silently stopped moving on a Paperclip board, and restarts it.
//   node packages/tools/paperclip/unstall.mjs            report only (default)
//   node packages/tools/paperclip/unstall.mjs --apply    re-arm and dispatch
// Options: --api <url> (default loopback), --company <name> (default Line), --in <minutes> (default 2),
//          --max <n> restarts per run (default 8, sized for an agent's 20-write budget),
//          --skip <identifiers> comma-separated issue identifiers to leave stalled on purpose
//          (e.g. a lane the owner has not confirmed is live -- see LIN-156 comment 2026-10-01),
//          --allow-remote (refused by default -- Paperclip runs on this machine).
//
// WHY THIS EXISTS (LIN-156, owner decision 2026-10-01). A task's monitor fires, the monitor-to-dispatch
// step loses the run (LIN-123), `nextCheckAt` clears, and nothing ever re-arms it: the task is assigned,
// `in_progress`, and permanently invisible to `tickDueIssueMonitors`. Worse, Paperclip's terminal-run
// recovery then marks such a task `blocked` ("no live execution path"), so the board grows blockers that
// no dependency explains. 14 tasks were in this state on 2026-10-01; six carried fabricated blocks.
//
// Asking each dev agent to re-arm its own monitor was tried and failed twice with an explicit, actionable
// instruction on the issue (LIN-156's own evidence). Relying on every agent to remember is not a mechanism.
// So this is deterministic and runs from outside the agents, in the spirit of "a rule before reasoning".
//
// `POST /api/agents/:id/wakeup` is the load-bearing call, not the monitor PATCH: LIN-123 records that
// dispatch-on-demand is intact while the monitor path is not, and every wakeup issued on 2026-10-01
// returned a queued run while every monitor arm produced nothing. The monitor is re-armed too, as the
// fallback for whenever the platform defect is fixed.
import { DEFAULT_API, assertApiBase, createClient, asList, makeOut, deepMerge } from './lib.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const has = (k) => process.argv.includes(k);
const out = makeOut();

const API = assertApiBase(arg('--api', DEFAULT_API), { allowRemote: has('--allow-remote') });
const COMPANY = arg('--company', 'Line');
const MINUTES = Math.max(1, Number(arg('--in', 2)) || 2);
const APPLY = has('--apply');
// An agent's run may make at most 20 cross-task writes (agents/_shared/RULES.md). Each restart costs a
// PATCH plus at most one wakeup per agent, so the default stops well inside that budget and says what it
// skipped; the owner session, which has no such cap, can raise it.
const MAX = Math.max(1, Number(arg('--max', 8)) || 8);
const SKIP = new Set((arg('--skip', '') || '').split(',').map((s) => s.trim()).filter(Boolean));

/** Statuses whose work is supposed to be moving. `todo` is excluded on purpose: Paperclip never wakes a
 *  `todo` task again after a successful run, so a `todo` task is a board-hygiene question, not a stall. */
const ACTIVE = ['in_progress', 'in_review'];

/** A task nothing can ever wake: it has an assignee, no live run, and no future check. */
const isStalled = (i) => Boolean(i.assigneeAgentId) && !i.executionRunId && !i.monitorNextCheckAt;

/** `blocked` with no dependency and no recovery action to explain it -- LIN-123's recovery artefact. */
const isPhantomBlock = (i) => i.status === 'blocked' && !(i.blockedBy ?? []).length && !i.activeRecoveryAction;

/** Cycles in the blockedBy graph: each issue waits on the next, so none can ever start (LIN-124 was one). */
function findCycles(issues) {
  const edges = new Map(issues.map((i) => [i.id, (i.blockedBy ?? []).map((b) => b.id).filter(Boolean)]));
  const seen = new Map(); // id -> 1 on stack, 2 finished
  const cycles = [];
  const walk = (id, path) => {
    if (seen.get(id) === 1) { cycles.push(path.slice(path.indexOf(id))); return; }
    if (seen.get(id) === 2) return;
    seen.set(id, 1);
    for (const next of edges.get(id) ?? []) walk(next, [...path, next]);
    seen.set(id, 2);
  };
  for (const i of issues) walk(i.id, [i.id]);
  return cycles;
}

async function main() {
  const api = createClient(API);
  const company = asList(await api.get('/api/companies')).find((c) => c.name === COMPANY);
  if (!company) throw new Error(`company ${COMPANY} not found at ${API}`);

  const agents = asList(await api.get(`/api/companies/${company.id}/agents`));
  const name = Object.fromEntries(agents.map((a) => [a.id, a.name]));
  const summary = asList(await api.get(`/api/companies/${company.id}/issues?limit=500`));

  // The list endpoint omits monitor and run fields (and has served stale status), so every candidate is
  // re-read from its own endpoint before we act on it.
  const candidates = summary.filter((i) => ACTIVE.includes(i.status) || i.status === 'blocked');
  const detailed = [];
  for (const i of candidates) {
    const d = await api.get(`/api/issues/${i.id}`);
    detailed.push(d?.issue ?? d);
  }

  const stalled = detailed.filter((i) => ACTIVE.includes(i.status) && isStalled(i));
  const phantom = detailed.filter(isPhantomBlock);
  const cycles = findCycles(detailed);
  const label = Object.fromEntries(detailed.map((i) => [i.id, i.identifier]));

  out(`${API} ${COMPANY}: ${detailed.length} open, ${stalled.length} stalled, ${phantom.length} phantom-blocked, ${cycles.length} dependency cycle(s)`);
  out(APPLY ? `re-arming in ${MINUTES}m and dispatching` : 'report only -- pass --apply to act');
  out();

  const woken = new Set();
  let armed = 0;
  for (const i of stalled) {
    const who = name[i.assigneeAgentId] ?? i.assigneeAgentId;
    if (!APPLY) { out(`  STALLED  ${i.identifier}  ${i.status}  ${who}  ${i.title.slice(0, 54)}`); continue; }
    if (SKIP.has(i.identifier)) { out(`  SKIPPED  ${i.identifier}  ${who}  --skip`); continue; }
    if (armed >= MAX) { out(`  SKIPPED  ${i.identifier}  ${who}  write budget reached (--max ${MAX})`); continue; }
    const at = new Date(Date.now() + MINUTES * 60_000).toISOString().replace(/\.\d+Z$/, 'Z');
    const policy = deepMerge(i.executionPolicy ?? {}, { monitor: { nextCheckAt: at, notes: `Re-armed by unstall.mjs: monitor was consumed with no run (LIN-123). Report a real disposition, never a bare in_progress.` } });
    try {
      await api.patch(`/api/issues/${i.id}`, { executionPolicy: policy });
      armed++;
      // One wakeup per agent: it picks up every task assigned to it, and agents cap concurrent runs.
      if (!woken.has(i.assigneeAgentId)) {
        await api.post(`/api/agents/${i.assigneeAgentId}/wakeup`, { source: 'assignment' });
        woken.add(i.assigneeAgentId);
      }
      out(`  restarted ${i.identifier}  ${who}`);
    } catch (e) {
      out(`  FAILED    ${i.identifier}  ${who}  ${e.message}`);
    }
  }

  // Reported, never auto-changed: clearing a block is a judgement about whether the work can proceed, and
  // a wrong automatic unblock hides a real problem. Every one of these on 2026-10-01 proved fabricated,
  // but that is a reason to look, not to let a script decide.
  for (const i of phantom) out(`  PHANTOM  ${i.identifier}  blocked with no dependency and no recovery action  ${i.title.slice(0, 44)}`);
  for (const c of cycles) out(`  CYCLE    ${c.map((id) => label[id] ?? id).join(' -> ')}`);

  if (APPLY) out(`\nre-armed ${armed}, dispatched ${woken.size} agent(s)`);
  if (!APPLY && (stalled.length || phantom.length || cycles.length)) out('\nnothing changed. re-run with --apply to restart the stalled tasks.');
}

// Piping into head/grep closes stdout early; that is normal use of a reporting command, not a failure.
process.stdout.on('error', (e) => { if (e.code === 'EPIPE') process.exit(0); throw e; });

main().catch((e) => { out(`unstall: ${e.message}`); process.exit(1); });
