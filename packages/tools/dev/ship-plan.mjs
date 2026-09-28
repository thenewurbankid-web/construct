#!/usr/bin/env node
// #635 -- the Daily Ship Plan: the delivery plan (every lane ships daily Mon-Fri; docs/DELIVERY-PLAN.md has the cadence,
// owner, gate and rollback per lane) shown side by side with what packages/tools/dev/delivery-report.mjs reads from git.
// Per day and lane: `delivered` (a tag or a commit landed), `held` (a working day passed with neither -- with a reason)
// or `pending` (a working day still to come). Nothing is `delivered` without a tag or a commit. Read-only and
// deterministic: no model, nothing written.
//
//   node packages/tools/dev/ship-plan.mjs --since 2026-09-22 --until 2026-09-26 [--json]
import { fileURLToPath } from 'node:url';
import { LANES, reportFromGit } from './delivery-report.mjs';

/** Lanes paused by standing policy: a day with nothing from them is a hold by design, not a gap. Keyed by lane, value is the held reason. */
export const ON_HOLD = Object.freeze({ design: 'lane on hold (design is never assigned work per OG policy)' });

const DAY_MS = 24 * 60 * 60 * 1000;

/** Mon-Fri from a `YYYY-MM-DD` (UTC); every lane's daily cadence is a working day. */
export function isWorkingDay(date) {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return day >= 1 && day <= 5;
}

function daysBetween(since, until) {
  const out = [];
  for (let d = new Date(`${since}T00:00:00Z`), end = new Date(`${until}T00:00:00Z`); d <= end; d = new Date(d.getTime() + DAY_MS)) out.push(d.toISOString().slice(0, 10));
  return out;
}

/**
 * Turn a `delivery-report.mjs` report into a day-by-day, lane-by-lane ship plan status. Every day in `[since, until]` is
 * covered, including days the report has no entry for (nothing landed anywhere that day).
 *
 * @param {{ days: object[], releases: object[], baselines: object[] }} report From `buildReport`/`reportFromGit`.
 * @param {{ since: string, until: string, today?: string }} o `today` (default: real UTC date) is the cutoff after which
 *   a working day with nothing yet is `pending` rather than `held`.
 * @returns {{ days: { date: string, isWorkingDay: boolean, lanes: object }[], releases: object[], baselines: object[] }}
 *
 * @example
 * planFromReport({ days: [], releases: [], baselines: [] }, { since: '2026-09-21', until: '2026-09-21', today: '2026-09-28' })
 *   .days[0].lanes.construct.status; // => 'held' (2026-09-21 is a Monday, and nothing landed)
 */
export function planFromReport(report, o) {
  const byDate = new Map(report.days.map((d) => [d.date, d]));
  const today = o.today || new Date().toISOString().slice(0, 10);
  const days = daysBetween(o.since, o.until).map((date) => {
    const found = byDate.get(date);
    const working = isWorkingDay(date);
    const lanes = {};
    for (const lane of LANES) {
      const l = found?.lanes[lane] || { commits: 0, tags: [], subjects: [] };
      const delivered = l.commits > 0 || l.tags.length > 0;
      let status, reason;
      if (delivered) status = 'delivered';
      else if (!working) status = 'not-a-working-day';
      else if (ON_HOLD[lane]) { status = 'held'; reason = ON_HOLD[lane]; }
      else if (date > today) status = 'pending';
      else { status = 'held'; reason = `no commits or build tag landed for ${lane} on ${date}`; }
      lanes[lane] = { status, reason, commits: l.commits, tags: l.tags, subjects: l.subjects };
    }
    return { date, isWorkingDay: working, lanes };
  });
  return { days, releases: report.releases, baselines: report.baselines };
}

/** Run the ship plan against the current repository (or the one at `cwd`). */
export function shipPlan(o) {
  return planFromReport(reportFromGit(o), o);
}

const MARK = { delivered: 'DELIVERED', held: 'HELD', pending: 'pending', 'not-a-working-day': '-' };

/** One-screen text for the terminal. */
export function formatShipPlan(p) {
  const out = [];
  for (const d of p.days) {
    out.push(`${d.date}${d.isWorkingDay ? '' : '  (not a working day)'}`);
    for (const lane of LANES) {
      const l = d.lanes[lane];
      out.push(`  ${lane.padEnd(11)} ${MARK[l.status]}${l.reason ? `  (${l.reason})` : ''}${l.tags.length ? `  tags: ${l.tags.join(', ')}` : ''}`);
    }
  }
  if (p.releases.length) out.push('releases: ' + p.releases.map((r) => `${r.name} (${r.date})`).join(', '));
  if (p.baselines.length) out.push('baselines: ' + p.baselines.map((b) => `${b.name} (${b.date})`).join(', '));
  return out.join('\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const arg = (n, d) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : d; };
  const until = arg('--until', new Date().toISOString().slice(0, 10));
  const since = arg('--since', until);
  const plan = shipPlan({ since, until });
  console.log(process.argv.includes('--json') ? JSON.stringify(plan) : formatShipPlan(plan));
}
