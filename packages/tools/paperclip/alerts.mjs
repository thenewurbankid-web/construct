#!/usr/bin/env node
// Alerts only, one line per event on stdout: an agent enters error, a team with open work has had no run for 10+ minutes,
// a single task is STRANDED (no run, no future check-in - nothing will ever wake it), a task sits BLOCKED with no stated
// remedy, recovery jumps by 3+, a new failure cause appears, or Paperclip stops answering. Polls every 30 s. Read-only.
//   node packages/tools/paperclip/alerts.mjs [--api URL] [--metrics FILE]
//
// STRANDED is the one that matters most and the one this file used to miss. The team check below only fires when a whole
// team has been quiet for 10+ minutes, so a single inert task went unseen while its teammates worked. That is how the
// 2026-09-29 outage became a 3-hour stall: the Flow Controller's standing task was left blocked with no blockers and no
// next check-in, every other lane kept running, and nothing reported it. A task that is not blocked, has no live run and
// no future check-in cannot be woken by anything - Paperclip dispatches on a check-in, and a comment does not wake a
// blocked task. Same shape, four times that night, in three different statuses.
//
// --metrics FILE appends one dense JSON line per poll (counts, per-team activity, stranded/blocked detail). It goes to a
// file rather than stdout on purpose: alerts are few and worth a human's attention, metrics are for querying after the
// fact, and mixing them buries the former. Costs no agent tokens either way - this process only reads the API.
import fs from 'node:fs';
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const A = arg('--api', 'http://127.0.0.1:3100');
const METRICS = arg('--metrics', null);
const list = (d) => (Array.isArray(d) ? d : d.items ?? d.runs ?? d.agents ?? d.issues ?? d.companies ?? []);
const get = async (p) => list(await (await fetch(A + p)).json());
const team = (n) => (/Trace|Lead$/.test(n) ? 'Trace' : n.replace(/ (Dev|QA)$/, ''));
const t = () => new Date().toISOString().slice(11, 16) + 'Z';
// a check-in in the future means Paperclip will wake this task; anything else means it will not
const scheduledAt = (i) => Date.parse(i.monitorNextCheckAt ?? i.executionPolicy?.monitor?.nextCheckAt ?? 0) || 0;
const OPEN = ['todo', 'in_progress'];
let first = true, lastRec = null, down = false, C = null, emergency = false;
const agentState = {}, idleCount = {}, causes = new Set();
const strandedCount = {}, strandedOn = new Set(), noRemedyOn = new Set();
for (;;) {
  try {
    C ??= (await get('/api/companies')).find((c) => c.name === 'Line').id;
    const [agents, runs, issues] = await Promise.all([get(`/api/companies/${C}/agents`), get(`/api/companies/${C}/heartbeat-runs?limit=100`), get(`/api/companies/${C}/issues?limit=500`)]);
    if (down) { console.log(`${t()} OK Paperclip reachable again`); down = false; }
    for (const a of agents) {
      if (!first && a.status === 'error' && agentState[a.id] !== 'error') console.log(`${t()} ALERT ${a.name} is in ERROR`);
      agentState[a.id] = a.status;
    }
    const teams = {};
    for (const a of agents.filter((a) => a.status !== 'paused')) {
      const x = (teams[team(a.name)] ??= { run: 0, open: 0, last: 0 });
      if (a.status === 'running') x.run++;
      for (const r of runs) if (r.agentId === a.id) x.last = Math.max(x.last, Date.parse(r.finishedAt ?? r.startedAt ?? r.createdAt) || 0);
      x.open += issues.filter((i) => i.assigneeAgentId === a.id && ['todo', 'in_progress'].includes(i.status) && !i.activeRecoveryAction).length;
    }
    for (const [k, x] of Object.entries(teams)) {
      idleCount[k] = !x.run && x.open && Date.now() - x.last > 10 * 60 * 1000 ? (idleCount[k] ?? 0) + 1 : 0;
      if (idleCount[k] !== 1) continue;
      // a task waiting on the owner's answer is not a stall: count only open tasks without a pending question
      const mine = new Set(agents.filter((a) => team(a.name) === k).map((a) => a.id));
      // a task with a scheduled check-in in the future is planned, not stalled
      const scheduled = (i) => Date.parse(i.monitorNextCheckAt ?? i.executionPolicy?.monitor?.nextCheckAt ?? 0) > Date.now();
      const open = issues.filter((i) => mine.has(i.assigneeAgentId) && ['todo', 'in_progress'].includes(i.status) && !i.activeRecoveryAction && !scheduled(i));
      let waiting = 0;
      for (const i of open) if ((await get(`/api/issues/${i.id}/interactions`)).some((q) => q.status === 'pending')) waiting++;
      // x.last stays 0 when the team has no run inside the 100-run window at all; do not subtract from the epoch
      const since = x.last ? `no run for ${Math.round((Date.now() - x.last) / 60000)} min` : 'no run in the last 100 runs';
      if (open.length > waiting) console.log(`${t()} ALERT ${k} stalled: ${open.length - waiting} open tasks, ${since}${waiting ? ` (${waiting} more waiting on you)` : ''}`);
    }
    const blocked = issues.filter((i) => i.status === 'blocked');
    if (blocked.length > 3 && !emergency) { console.log(`${t()} EMERGENCY ${blocked.length} tasks blocked (limit 3): ${blocked.map((i) => i.identifier).join(', ')}`); emergency = true; }
    else if (blocked.length <= 3 && emergency) { console.log(`${t()} OK blocked back to ${blocked.length} (limit 3)`); emergency = false; }
    const rec = issues.filter((i) => i.activeRecoveryAction).length;
    if (lastRec === null || rec < lastRec) lastRec = rec;
    else if (rec - lastRec >= 3) { console.log(`${t()} ALERT recovery up to ${rec} (+${rec - lastRec})`); lastRec = rec; }
    for (const r of runs.filter((r) => ['failed', 'timed_out'].includes(r.status))) {
      const cause = r.errorCode ?? r.status;
      if (!causes.has(cause)) { causes.add(cause); if (!first) console.log(`${t()} ALERT new failure cause: ${cause} (${String(r.error ?? '').slice(0, 90)})`); }
    }

    // ---- per-task wake-path checks (the gap the team check above cannot see)
    const live = await get(`/api/companies/${C}/live-runs`);
    const busy = new Set(live.map((r) => r.agentId));
    const named = new Map(agents.map((a) => [a.id, a.name]));
    const now = Date.now();
    const stranded = [];
    for (const i of issues.filter((i) => OPEN.includes(i.status) && !i.activeRecoveryAction)) {
      if (scheduledAt(i) > now) continue;              // Paperclip will wake it
      if (i.executionRunId || busy.has(i.assigneeAgentId)) continue; // running now, or its agent is
      stranded.push(i);
    }
    // require two consecutive sightings: a run that just ended has a brief window before it writes its next check-in
    const seen = new Set(stranded.map((i) => i.id));
    for (const id of Object.keys(strandedCount)) if (!seen.has(id)) { delete strandedCount[id]; strandedOn.delete(id); }
    for (const i of stranded) {
      strandedCount[i.id] = (strandedCount[i.id] ?? 0) + 1;
      if (strandedCount[i.id] < 2 || strandedOn.has(i.id) || first) continue;
      const pending = (await get(`/api/issues/${i.id}/interactions`)).some((q) => q.status === 'pending');
      if (pending) continue;                            // waiting on the owner is not stranded
      strandedOn.add(i.id);
      console.log(`${t()} ALERT STRANDED ${i.identifier} (${i.status}, ${named.get(i.assigneeAgentId) ?? 'unassigned'}): no run, no future check-in - nothing will wake it. Fix: set a status AND executionPolicy.monitor.nextCheckAt, with a comment (commentRequired reverts a bare status write).`);
    }
    // blocked with nothing to resolve and no stated remedy: the 2026-09-29 deadlock shape
    for (const i of blocked) {
      const ba = i.blockerAttention ?? {};
      const hasRemedy = (ba.unresolvedBlockerCount ?? 0) > 0 || i.unblockDescriptor || i.activeRecoveryAction;
      if (hasRemedy) { noRemedyOn.delete(i.id); continue; }
      if (noRemedyOn.has(i.id) || first) continue;
      if ((await get(`/api/issues/${i.id}/interactions`)).some((q) => q.status === 'pending')) continue;
      noRemedyOn.add(i.id);
      console.log(`${t()} ALERT BLOCKED-NO-REMEDY ${i.identifier} (${named.get(i.assigneeAgentId) ?? 'unassigned'}): blocked with 0 unresolved blockers, no pending question and no unblockDescriptor - nothing states what would unblock it.`);
    }

    if (METRICS) {
      const by = (f) => issues.reduce((m, i) => (m[f(i)] = (m[f(i)] ?? 0) + 1, m), {});
      const cut = now - 30 * 60 * 1000;
      const recent = runs.filter((r) => Date.parse(r.finishedAt ?? r.createdAt ?? 0) > cut && !['queued', 'running'].includes(r.status));
      const sample = {
        ts: new Date().toISOString(),
        status: by((i) => i.status),
        blocked: blocked.length, blockedNoRemedy: noRemedyOn.size, stranded: strandedOn.size,
        recovery: rec, live: live.length,
        agents: agents.reduce((m, a) => (m[a.status] = (m[a.status] ?? 0) + 1, m), {}),
        runs30m: { ok: recent.filter((r) => r.status === 'succeeded').length, bad: recent.filter((r) => r.status !== 'succeeded').length },
        teams: Object.fromEntries(Object.entries(teams).map(([k, x]) => [k, { open: x.open, running: x.run, idleSec: x.last ? Math.round((now - x.last) / 1000) : null }])),
        strandedIds: [...strandedOn], noRemedyIds: [...noRemedyOn],
      };
      try { fs.appendFileSync(METRICS, JSON.stringify(sample) + '\n'); } catch (e) { if (!first) console.log(`${t()} ALERT metrics write failed: ${e.message}`); }
    }
    first = false;
  } catch (e) {
    if (!down) { console.log(`${t()} ALERT Paperclip not reachable: ${e.message}`); down = true; }
  }
  await new Promise((r) => setTimeout(r, 30000));
}
