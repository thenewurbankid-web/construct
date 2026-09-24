// #635 -- delivery-report.mjs: lane ownership by path, and the per-day, per-lane report from a git log text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { laneOf, buildReport } from '../delivery-report.mjs';

test('laneOf assigns a file to the lane that owns its path, else shared', () => {
  assert.equal(laneOf('ui/client/app/page.tsx'), 'cockpit');
  assert.equal(laneOf('packages/core/plan.mjs'), 'construct');
  assert.equal(laneOf('site/content/user/import.md'), 'site');
  assert.equal(laneOf('packages/docs-site/lib/pages.mjs'), 'site');
  assert.equal(laneOf('docs/design/README.md'), 'design');
  assert.equal(laneOf('packages/studio/src/server.mjs'), 'adhoc');
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
