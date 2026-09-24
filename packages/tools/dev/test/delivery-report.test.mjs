// #635 -- delivery-report.mjs: lane ownership by path, and the per-day, per-lane report from a git log text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { makeTempDir } from '../../../../test-utils/tmpdir.mjs';
import { tagMessage } from '../build-on-ready.mjs';
import { laneOf, buildReport, reportFromGit } from '../delivery-report.mjs';

test('laneOf assigns a file to the lane that owns its path, else shared', () => {
  assert.equal(laneOf('ui/client/app/page.tsx'), 'cockpit');
  assert.equal(laneOf('packages/core/plan.mjs'), 'construct');
  assert.equal(laneOf('site/content/user/import.md'), 'site');
  assert.equal(laneOf('packages/docs-site/lib/pages.mjs'), 'site');
  assert.equal(laneOf('docs/design/README.md'), 'design');
  assert.equal(laneOf('packages/studio/src/server.mjs'), 'adhoc');
  assert.equal(laneOf('packages/core/architecture-enforcer.mjs'), 'guardrails');
  assert.equal(laneOf('packages/ast/parse.mjs'), 'guardrails');
  assert.equal(laneOf('packages/core/plan.mjs'), 'construct');
  assert.equal(laneOf('docs/DELEGATION.md'), 'shared');
});

const LOG = ['@@a1|2026-09-23|core: fix', 'packages/core/plan.mjs', 'ui/server/src/index.mjs', '', '@@b2|2026-09-24|site: page', 'site/a.md', ''].join('\n');

test('buildReport counts commits and files per day and lane, and is deterministic', () => {
  const r = buildReport(LOG, { tags: [{ name: 'site/build-2026-09-24', date: '2026-09-24' }, { name: 'v0.9.0', date: '2026-09-24' }] });
  assert.deepEqual(r.days.map((d) => d.date), ['2026-09-23', '2026-09-24']);
  assert.equal(r.days[0].lanes.construct.commits, 1);
  assert.equal(r.days[0].lanes.cockpit.commits, 1);
  assert.equal(r.days[0].commits, 1);
  assert.deepEqual(r.days[1].lanes.site.tags, ['site/build-2026-09-24']);
  assert.deepEqual(r.releases, [{ name: 'v0.9.0', date: '2026-09-24' }]);
  assert.equal(JSON.stringify(buildReport(LOG)), JSON.stringify(buildReport(LOG)));
});

test('a lane with no commits or tags on a day reports zero, not a delivery', () => {
  const r = buildReport(LOG);
  assert.equal(r.days[1].lanes.design.commits, 0);
  assert.deepEqual(r.days[1].lanes.design.tags, []);
});

// #639 -- builds per day and lane, with the capabilities each contains, from the new tag names and their JSON messages.
const caps = (...subjects) => JSON.stringify({ schema: 'construct-build/1', kind: 'build', lane: 'cockpit', capabilities: subjects.map((s, i) => ({ sha: `sha${i}`, subject: s, issues: [i + 1] })) });

test('buildReport counts builds per lane and day from <lane>/build-DATE-HHMM[-N] tags and lists their capabilities', () => {
  const r = buildReport(LOG, {
    tags: [
      { name: 'cockpit/build-2026-09-24-0905', date: '2026-09-24', message: caps('[#1] Notes screen', '[#2] Blocks tab') },
      { name: 'cockpit/build-2026-09-24-0905-2', date: '2026-09-24', message: caps('[#3] Fix') },
      { name: 'cockpit/build-2026-09-24-1830', date: '2026-09-24', message: caps('[#4] Clone') },
      { name: 'design/pack-2026-09-24-1200', date: '2026-09-24', message: '{"schema":"construct-build/1","capabilities":[{"sha":"d","subject":"Popover spec","issues":[]}]}' },
      { name: 'site/build-2026-09-23-2359', date: '2026-09-23', message: caps('[#5] Guide') },
    ],
  });
  const cockpit = r.days[1].lanes.cockpit;
  assert.equal(cockpit.builds, 3);
  assert.deepEqual(cockpit.tags, ['cockpit/build-2026-09-24-0905', 'cockpit/build-2026-09-24-0905-2', 'cockpit/build-2026-09-24-1830']);
  assert.deepEqual(cockpit.capabilities.map((c) => [c.tag, c.subject, c.issues]), [
    ['cockpit/build-2026-09-24-0905', '[#1] Notes screen', [1]],
    ['cockpit/build-2026-09-24-0905', '[#2] Blocks tab', [2]],
    ['cockpit/build-2026-09-24-0905-2', '[#3] Fix', [1]],
    ['cockpit/build-2026-09-24-1830', '[#4] Clone', [1]],
  ]);
  assert.equal(r.days[1].lanes.design.builds, 1);
  assert.equal(r.days[1].lanes.design.capabilities[0].subject, 'Popover spec');
  assert.equal(r.days[0].lanes.site.builds, 1);
  assert.equal(r.days[1].lanes.site.builds, 0);
});

test('buildReport tolerates old-format tags: day-only names, no message, free text, lightweight tags', () => {
  const r = buildReport(LOG, {
    tags: [
      { name: 'site/build-2026-09-24', date: '2026-09-24' },
      { name: 'construct/build-2026-09-24', date: '2026-09-24', message: 'Build of the day' },
      { name: 'cockpit/build-2026-09-24-2000', date: '2026-09-24', message: '{not json' },
      { name: 'design/pack-2026-09-24', date: '2026-09-24', message: 'first commit message of a lightweight tag' },
    ],
  });
  const lanes = r.days[1].lanes;
  for (const l of ['site', 'construct', 'cockpit', 'design']) {
    assert.equal(lanes[l].builds, 1, l);
    assert.deepEqual(lanes[l].capabilities, [], l);
  }
});

test('a build day comes from the tag name (UTC), and a build on a day without commits still shows up', () => {
  const r = buildReport(LOG, { tags: [{ name: 'site/build-2026-09-25-0001', date: '2026-09-25', message: caps('[#9] x') }] });
  assert.deepEqual(r.days.map((d) => d.date), ['2026-09-23', '2026-09-24', '2026-09-25']);
  assert.equal(r.days[2].lanes.site.builds, 1);
});

test('a baseline tag is a starting line: reported under baselines, never a build', () => {
  const r = buildReport(LOG, { tags: [{ name: 'cockpit/build-baseline', date: '2026-09-24' }, { name: 'design/pack-baseline', date: '2026-09-24' }] });
  assert.deepEqual(r.baselines, [{ name: 'cockpit/build-baseline', lane: 'cockpit', date: '2026-09-24' }, { name: 'design/pack-baseline', lane: 'design', date: '2026-09-24' }]);
  assert.equal(r.days[1].lanes.cockpit.builds, 0);
  assert.deepEqual(r.days[1].lanes.cockpit.tags, []);
});

test('the JSON report keeps every field it had (backward compatible); builds, capabilities and baselines are added', () => {
  const r = buildReport(LOG, { tags: [{ name: 'site/build-2026-09-24', date: '2026-09-24' }, { name: 'v0.9.0', date: '2026-09-24' }] });
  assert.deepEqual(Object.keys(r).sort(), ['baselines', 'days', 'releases']);
  assert.deepEqual(Object.keys(r.days[1]).sort(), ['commits', 'date', 'lanes']);
  assert.deepEqual(Object.keys(r.days[1].lanes.site).sort(), ['builds', 'capabilities', 'commits', 'files', 'subjects', 'tags']);
  assert.deepEqual(Object.keys(r.days[1].lanes).sort(), ['adhoc', 'cockpit', 'construct', 'design', 'guardrails', 'shared', 'site']);
  assert.deepEqual(r.releases, [{ name: 'v0.9.0', date: '2026-09-24' }]);
});

test('reportFromGit reads real annotated tags: JSON message parsed, old-format and lightweight tags tolerated, baseline separate', () => {
  const dir = makeTempDir('delivery-report-');
  const date = '2026-09-24T12:00:00Z';
  const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t', GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date };
  const vcs = (input, ...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', env, input }).trim();
  vcs(undefined, 'init', '-q');
  fs.mkdirSync(path.join(dir, 'ui'));
  fs.writeFileSync(path.join(dir, 'ui', 'a.tsx'), 'x\n');
  vcs(undefined, 'add', '-A');
  vcs(undefined, 'commit', '-q', '-m', '[#1] Notes screen');
  const sha = vcs(undefined, 'rev-parse', 'HEAD');
  const message = tagMessage({ lane: 'cockpit', branch: 'work', from: null, to: sha, builtAt: new Date(date), commits: 1, capabilities: [{ sha, subject: '[#1] Notes screen', issues: [1] }] });
  vcs(message, 'tag', '-a', 'cockpit/build-2026-09-24-1200', '-F', '-', sha);
  vcs('Build of the day\n', 'tag', '-a', 'site/build-2026-09-24', '-F', '-', sha);
  vcs(undefined, 'tag', 'construct/build-2026-09-24-1300', sha); // lightweight
  vcs('baseline\n', 'tag', '-a', 'design/pack-baseline', '-F', '-', sha);
  const r = reportFromGit({ since: '2026-09-24', until: '2026-09-24', cwd: dir });
  const lanes = r.days[0].lanes;
  assert.equal(lanes.cockpit.builds, 1);
  assert.deepEqual(lanes.cockpit.capabilities.map((c) => [c.subject, c.issues]), [['[#1] Notes screen', [1]]]);
  assert.equal(lanes.site.builds, 1);
  assert.equal(lanes.construct.builds, 1);
  assert.deepEqual(lanes.construct.capabilities, []);
  assert.equal(lanes.design.builds, 0);
  assert.deepEqual(r.baselines.map((b) => b.name), ['design/pack-baseline']);
});
