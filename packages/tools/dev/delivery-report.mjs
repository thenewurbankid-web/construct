#!/usr/bin/env node
// #635 -- what each team delivered, per day, read from git: commits per lane (by the paths a lane owns), lane tags
// (`construct/build-DATE`, `cockpit/build-DATE`, `site/build-DATE`, `design/pack-DATE`) and release tags (`v*`).
// Read-only and deterministic: no model, no network, nothing written.
//
//   node packages/tools/dev/delivery-report.mjs --since 2026-09-17 --until 2026-09-24 [--json]
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/** Lane -> the path prefixes it owns. First match wins; anything else is `shared` (docs, board, root files). */
export const LANE_PATHS = Object.freeze({
  design: ['docs/design/'],
  site: ['site/', 'packages/docs-site/'],
  cockpit: ['ui/'],
  construct: ['packages/', 'src/', 'bin/', 'tools/', 'test/', 'fixtures/'], // the pre-split layout counts for history
});
export const LANES = Object.freeze(['construct', 'cockpit', 'site', 'design']);
const LANE_TAG = /^(construct|cockpit|site)\/build-(\d{4}-\d{2}-\d{2})$|^(design)\/pack-(\d{4}-\d{2}-\d{2})$/;

/**
 * The lane that owns a file.
 *
 * @param {string} file Repo-relative path.
 * @returns {'construct'|'cockpit'|'site'|'design'|'shared'} The owning lane, or `shared`.
 *
 * @example
 * laneOf('ui/client/app/page.tsx'); // => 'cockpit'
 */
export function laneOf(file) {
  for (const lane of ['design', 'site', 'cockpit', 'construct']) {
    if (LANE_PATHS[lane].some((p) => file.startsWith(p))) return lane;
  }
  return 'shared';
}

/**
 * Turn `git log --format=@@%H|%ad|%s --date=short --name-only` output into a per-day, per-lane report.
 *
 * @param {string} logText Raw log text.
 * @param {{ tags?: { name: string, date: string }[] }} [extra] Tags with their dates.
 * @returns {{ days: object[], releases: { name: string, date: string }[] }} Days ascending; each has a `lanes` map with `commits`, `files`, `subjects` (first 3), `tags`.
 *
 * @example
 * buildReport('@@abc|2026-09-24|fix\nui/a.ts\n').days[0].lanes.cockpit.commits; // => 1
 */
export function buildReport(logText, extra = {}) {
  const byDay = new Map();
  const day = (d) => {
    if (!byDay.has(d)) byDay.set(d, { date: d, commits: 0, lanes: Object.fromEntries([...LANES, 'shared'].map((l) => [l, { commits: 0, files: 0, subjects: [], tags: [] }])) });
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
  for (const t of extra.tags || []) {
    const m = LANE_TAG.exec(t.name);
    if (m) day(t.date).lanes[m[1] || m[3]].tags.push(t.name);
    else if (/^v\d+\.\d+\.\d+$/.test(t.name)) releases.push(t);
  }
  return { days: [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date)), releases };
}

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 1 << 28 });
}

/** Run the report against the current repository. */
export function reportFromGit({ since, until }) {
  const log = git(['log', `--since=${since} 00:00`, `--until=${until} 23:59:59`, '--format=@@%H|%ad|%s', '--date=short', '--name-only']);
  const tagLines = git(['for-each-ref', '--format=%(refname:short)|%(creatordate:short)', 'refs/tags']).split('\n').filter(Boolean);
  const tags = tagLines.map((l) => { const [name, date] = l.split('|'); return { name, date }; }).filter((t) => t.date >= since && t.date <= until);
  const report = buildReport(log, { tags });
  return { ...report, days: report.days.filter((d) => d.date >= since && d.date <= until) }; // author dates, not the --until clock
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const arg = (n, d) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : d; };
  const until = arg('--until', new Date().toISOString().slice(0, 10));
  const since = arg('--since', until);
  const report = reportFromGit({ since, until });
  if (process.argv.includes('--json')) console.log(JSON.stringify(report));
  else for (const d of report.days) console.log(`${d.date}  ${d.commits} commits  ` + LANES.map((l) => `${l} ${d.lanes[l].commits}`).join(' · ') + (LANES.some((l) => d.lanes[l].tags.length) ? '  tags: ' + LANES.flatMap((l) => d.lanes[l].tags).join(', ') : ''));
}
