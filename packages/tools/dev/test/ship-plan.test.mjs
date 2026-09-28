// #635 -- ship-plan.mjs: the delivery plan (every lane ships daily Mon-Fri) laid over a delivery-report.mjs report.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildReport } from '../delivery-report.mjs';
import { isWorkingDay, planFromReport, ON_HOLD } from '../ship-plan.mjs';

test('isWorkingDay is Mon-Fri, not Sat/Sun', () => {
  assert.equal(isWorkingDay('2026-09-21'), true); // Monday
  assert.equal(isWorkingDay('2026-09-25'), true); // Friday
  assert.equal(isWorkingDay('2026-09-26'), false); // Saturday
  assert.equal(isWorkingDay('2026-09-27'), false); // Sunday
});

test('a lane with a commit that day is delivered; nothing is delivered without a tag or a commit', () => {
  const log = ['@@a1|2026-09-21|core: fix', 'packages/core/plan.mjs', ''].join('\n');
  const report = buildReport(log, {});
  const plan = planFromReport(report, { since: '2026-09-21', until: '2026-09-21', today: '2026-09-28' });
  assert.equal(plan.days[0].lanes.construct.status, 'delivered');
  assert.equal(plan.days[0].lanes.cockpit.status, 'held'); // touched by nothing that day
  assert.match(plan.days[0].lanes.cockpit.reason, /no commits or build tag landed for cockpit on 2026-09-21/);
});

test('a working day with no commits or tags in range is held, with a reason, even though the report has no entry for it at all', () => {
  const plan = planFromReport({ days: [], releases: [], baselines: [] }, { since: '2026-09-21', until: '2026-09-21', today: '2026-09-28' });
  assert.equal(plan.days.length, 1);
  assert.equal(plan.days[0].lanes.site.status, 'held');
});

test('a weekend day is not-a-working-day, not held', () => {
  const plan = planFromReport({ days: [], releases: [], baselines: [] }, { since: '2026-09-26', until: '2026-09-26', today: '2026-09-28' });
  assert.equal(plan.days[0].isWorkingDay, false);
  assert.equal(plan.days[0].lanes.construct.status, 'not-a-working-day');
});

test('a working day still to come is pending, not held', () => {
  const plan = planFromReport({ days: [], releases: [], baselines: [] }, { since: '2026-09-29', until: '2026-09-29', today: '2026-09-28' });
  assert.equal(plan.days[0].lanes.construct.status, 'pending');
});

test('design is held with the on-hold reason, not the generic one, and never pending', () => {
  const past = planFromReport({ days: [], releases: [], baselines: [] }, { since: '2026-09-21', until: '2026-09-21', today: '2026-09-28' });
  assert.equal(past.days[0].lanes.design.status, 'held');
  assert.equal(past.days[0].lanes.design.reason, ON_HOLD.design);
  const future = planFromReport({ days: [], releases: [], baselines: [] }, { since: '2026-09-29', until: '2026-09-29', today: '2026-09-28' });
  assert.equal(future.days[0].lanes.design.status, 'held');
});

test('every day in [since, until] is covered, spanning a full week', () => {
  const plan = planFromReport({ days: [], releases: [], baselines: [] }, { since: '2026-09-21', until: '2026-09-27', today: '2026-09-28' });
  assert.deepEqual(plan.days.map((d) => d.date), ['2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25', '2026-09-26', '2026-09-27']);
});

test('releases and baselines pass through from the report unchanged', () => {
  const report = { days: [], releases: [{ name: 'v0.10.0', date: '2026-09-21' }], baselines: [{ name: 'design/pack-baseline', lane: 'design', date: '2026-09-21' }] };
  const plan = planFromReport(report, { since: '2026-09-21', until: '2026-09-21', today: '2026-09-28' });
  assert.deepEqual(plan.releases, report.releases);
  assert.deepEqual(plan.baselines, report.baselines);
});
