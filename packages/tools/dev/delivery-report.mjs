#!/usr/bin/env node
// #635 -- what each team delivered, per day, read from git: commits per lane (by the paths a lane owns), lane tags
// (`<lane>/build-YYYY-MM-DD-HHMM[-N]`, `design/pack-...`, older `<lane>/build-DATE`) and release tags (`v*`).
// #639 -- per day and lane: the number of builds and the capabilities each contains (read from the JSON tag message that
// build-on-ready.mjs writes; older tags have none and count as a build with no listed capabilities). A `<lane>/build-baseline`
// tag is a starting line, reported under `baselines`, not a build.
// Read-only and deterministic: no model, no network, nothing written.
//
//   node packages/tools/dev/delivery-report.mjs --since 2026-09-17 --until 2026-09-24 [--json]
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseTagMessage, parseTagName } from './build-on-ready.mjs';

/** Lane -> the path prefixes it owns. First match wins; anything else is `shared` (docs, board, root files). */
export const LANE_PATHS = Object.freeze({
  adhoc: ['packages/studio/'], // the ad hoc team's current product (Studio); checked before construct's packages/
  design: ['docs/design/'],
  site: ['site/', 'packages/docs-site/'],
  cockpit: ['ui/'],
  construct: ['packages/', 'src/', 'bin/', 'tools/', 'test/', 'fixtures/'], // the pre-split layout counts for history
});
export const LANES = Object.freeze(['construct', 'cockpit', 'site', 'design', 'adhoc']);

/**
 * The lane that owns a file.
 *
 * @param {string} file Repo-relative path.
 * @returns {'construct'|'cockpit'|'site'|'design'|'adhoc'|'shared'} The owning lane, or `shared`.
 *
 * @example
 * laneOf('ui/client/app/page.tsx'); // => 'cockpit'
 */
export function laneOf(file) {
  for (const lane of ['adhoc', 'design', 'site', 'cockpit', 'construct']) {
    if (LANE_PATHS[lane].some((p) => file.startsWith(p))) return lane;
  }
  return 'shared';
}

/**
 * Turn `git log --format=@@%H|%ad|%s --date=short --name-only` output into a per-day, per-lane report.
 *
 * @param {string} logText Raw log text.
 * @param {{ tags?: { name: string, date: string, message?: string }[] }} [extra] Tags with their dates and (optional) annotated messages.
 * @returns {{ days: object[], releases: { name: string, date: string }[], baselines: { name: string, lane: string, date: string }[] }} Days ascending; each has a `lanes` map with `commits`, `files`, `subjects` (first 3), `tags`, `builds` (count of build tags that day) and `capabilities` (`{ tag, sha, subject, issues }` from the tag messages).
 *
 * @example
 * buildReport('@@abc|2026-09-24|fix\nui/a.ts\n').days[0].lanes.cockpit.commits; // => 1
 */
export function buildReport(logText, extra = {}) {
  const byDay = new Map();
  const day = (d) => {
    if (!byDay.has(d)) byDay.set(d, { date: d, commits: 0, lanes: Object.fromEntries([...LANES, 'shared'].map((l) => [l, { commits: 0, files: 0, subjects: [], tags: [], builds: 0, capabilities: [] }])) });
    return byDay.get(d);
  };
  for (const block of logText.split('@@').slice(1)) {
    const [head, ...rest] = block.split('\n');
    const [, date, ...subj] = head.split('|');
    const subject = subj.join('|');
    const d = day(date);
    d.commits += 1;
    const files = rest.map((f) => f.trim()).filter(Boolean);
    const touched = new Set(files.map(laneOf));
    for (const lane of touched) {
      const l = d.lanes[lane];
      l.commits += 1;
      if (l.subjects.length < 3) l.subjects.push(subject);
    }
    for (const f of files) d.lanes[laneOf(f)].files += 1;
  }
  const releases = [];
  const baselines = [];
  for (const t of extra.tags || []) {
    const p = parseTagName(t.name);
    if (p?.kind === 'baseline') baselines.push({ name: t.name, lane: p.lane, date: t.date });
    else if (p) {
      const l = day(p.date).lanes[p.lane]; // the day in the tag's name (UTC), not the tagger's clock
      l.tags.push(t.name);
      l.builds += 1;
      for (const c of parseTagMessage(t.message)?.capabilities || []) l.capabilities.push({ tag: t.name, sha: c.sha, subject: c.subject, issues: c.issues || [] });
    } else if (/^v\d+\.\d+\.\d+$/.test(t.name)) releases.push(t);
  }
  return { days: [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date)), releases, baselines };
}

/** Run the report against the current repository (or the one at `cwd`). */
export function reportFromGit({ since, until, cwd }) {
  const git = (args) => execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 1 << 28 });
  const log = git(['log', `--since=${since} 00:00`, `--until=${until} 23:59:59`, '--format=@@%H|%ad|%s', '--date=short', '--name-only']);
  const tagRecords = git(['for-each-ref', '--format=%(refname:short)%1f%(creatordate:short)%1f%(contents)%1e', 'refs/tags']).split('\x1e').map((r) => r.replace(/^\n/, '')).filter(Boolean);
  const tags = tagRecords.map((r) => {
    const [name, created, ...message] = r.split('\x1f');
    return { name, date: parseTagName(name)?.date || created, message: message.join('\x1f') };
  }).filter((t) => t.date >= since && t.date <= until);
  const report = buildReport(log, { tags });
  return { ...report, days: report.days.filter((d) => d.date >= since && d.date <= until) }; // author dates, not the --until clock
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const arg = (n, d) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : d; };
  const until = arg('--until', new Date().toISOString().slice(0, 10));
  const since = arg('--since', until);
  const report = reportFromGit({ since, until });
  if (process.argv.includes('--json')) console.log(JSON.stringify(report));
  else {
    for (const d of report.days) {
      console.log(`${d.date}  ${d.commits} commits  ` + LANES.map((l) => `${l} ${d.lanes[l].commits}`).join(' · ') + (LANES.some((l) => d.lanes[l].tags.length) ? '  tags: ' + LANES.flatMap((l) => d.lanes[l].tags).join(', ') : ''));
      for (const l of LANES.filter((x) => d.lanes[x].builds)) console.log(`  ${l}: ${d.lanes[l].builds} build${d.lanes[l].builds === 1 ? '' : 's'}, ${d.lanes[l].capabilities.length} capabilit${d.lanes[l].capabilities.length === 1 ? 'y' : 'ies'}`);
    }
    for (const b of report.baselines) console.log(`baseline ${b.name} (${b.date})`);
  }
}
