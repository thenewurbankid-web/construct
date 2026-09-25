// #648 -- the budget comparison, with fake measurements (no process is started), and the shape of budgets.json.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { measureCli, compareBudgets, parseTimeLine, spread, mediansOf, renderMeasuredTable, spliceBlock, readBlock, CHECKS } from '../benchmark.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const budgets = { checks: { version: { maxMs: 600, maxRssMb: 120 }, validate: { maxMs: 3000, maxRssMb: 400 }, 'cockpit-start': { maxMs: 10000, maxRssMb: 400 } } };
const status = (r) => Object.fromEntries(r.results.map((x) => [x.id, x.status]));

test('every check inside its budget passes', () => {
  const r = compareBudgets({ version: { ms: 300, rssMb: 60 }, validate: { ms: 3000, rssMb: 400 }, 'cockpit-start': { ms: 900, rssMb: 200 } }, budgets);
  assert.equal(r.ok, true);
  assert.deepEqual(status(r), { version: 'pass', validate: 'pass', 'cockpit-start': 'pass' }, 'exactly at the budget is a pass');
});

test('a time or a memory over its budget is a regression, and says by how much', () => {
  const slow = compareBudgets({ version: { ms: 601, rssMb: 60 }, validate: { ms: 100, rssMb: 100 }, 'cockpit-start': { skipped: 'x' } }, budgets);
  assert.equal(slow.ok, false);
  assert.equal(status(slow).version, 'regression');
  assert.match(slow.results[0].notes[0], /took 601 ms, budget 600 ms/);
  const fat = compareBudgets({ version: { ms: 100, rssMb: 60 }, validate: { ms: 100, rssMb: 401.5 }, 'cockpit-start': { skipped: 'x' } }, budgets);
  assert.equal(fat.ok, false);
  assert.match(fat.results[1].notes[0], /peaked at 402 MB, budget 400 MB/);
});

test('a budget with no measurement is missing and fails: a removed check cannot pass silently', () => {
  const r = compareBudgets({ version: { ms: 300, rssMb: 60 }, 'cockpit-start': { skipped: 'x' } }, budgets);
  assert.equal(r.ok, false);
  assert.deepEqual(status(r), { version: 'pass', validate: 'missing', 'cockpit-start': 'skipped' });
  const noTime = compareBudgets({ version: { ms: null, rssMb: 60 }, validate: { ms: 1, rssMb: 1 }, 'cockpit-start': { skipped: 'x' } }, budgets);
  assert.equal(status(noTime).version, 'missing', 'a time that was not measured is missing');
});

test('a skipped check names its reason and does not fail; unmeasured memory is a note, not a failure', () => {
  const r = compareBudgets({ version: { ms: 300, rssMb: null }, validate: { ms: 300, rssMb: 100 }, 'cockpit-start': { skipped: 'the Cockpit server dependencies are not installed' } }, budgets);
  assert.equal(r.ok, true);
  assert.deepEqual(r.results.find((x) => x.id === 'cockpit-start').notes, ['skipped: the Cockpit server dependencies are not installed']);
  assert.match(r.results.find((x) => x.id === 'version').notes[0], /unmeasured/);
});

test('a regression in one check does not hide a pass in another', () => {
  const r = compareBudgets({ version: { ms: 9000, rssMb: 1 }, validate: { ms: 1, rssMb: 1 }, 'cockpit-start': { ms: 1, rssMb: 1 } }, budgets);
  assert.deepEqual(status(r), { version: 'regression', validate: 'pass', 'cockpit-start': 'pass' });
});

test('GNU time output: the last line is time and peak memory, the command\'s own stderr is kept apart', () => {
  const t = parseTimeLine('warning: something\n__TIME__ 0.71 163840\n');
  assert.equal(t.rssMb, 160);
  assert.equal(Math.round(t.ms), 710);
  assert.equal(t.stderr, 'warning: something');
  assert.equal(parseTimeLine('no time line here'), null);
});

test('spread and medians', () => {
  assert.deepEqual(spread([3, 1, 2, null]), { min: 1, median: 2, max: 3 });
  assert.deepEqual(spread([4, 2]), { min: 2, median: 3, max: 4 });
  assert.equal(spread([null]), null);
  const report = { checks: { a: { skipped: 'no deps' }, b: { ms: { median: 12 }, rssMb: null } } };
  assert.deepEqual(mediansOf(report), { a: { skipped: 'no deps' }, b: { ms: 12, rssMb: null } });
});

test('the generated blocks of a page are replaced in place and read back; a page without the markers is an error', () => {
  const md = 'intro\n<!-- t:start -->\nold\n<!-- t:end -->\noutro\n';
  const next = spliceBlock(md, 't', 'new\nlines');
  assert.equal(next, 'intro\n<!-- t:start -->\nnew\nlines\n<!-- t:end -->\noutro\n');
  assert.equal(readBlock(next, 't'), 'new\nlines');
  assert.equal(spliceBlock(next, 't', 'new\nlines'), next, 'idempotent');
  assert.throws(() => spliceBlock('no markers', 't', 'x'), /no <!-- t:start -->/);
  assert.equal(readBlock('nothing', 't'), null);
});

test('the measured table shows a skipped check with its reason and formats short times in milliseconds', () => {
  const table = renderMeasuredTable({ checks: { version: { label: 'v', ms: 40, peakMb: 45 }, validate: { label: 'val', ms: 1200, peakMb: 160 }, 'cockpit-start': { label: 'ck', skipped: 'no deps' } } }, budgets);
  assert.match(table, /\| v \| 40 ms \| 45 MB \| 0\.6 s and 120 MB \|/);
  assert.match(table, /\| val \| 1\.2 s \| 160 MB \| 3 s and 400 MB \|/);
  assert.match(table, /\| ck \| not measured: no deps \| \|/);
});

test('budgets.json is data only: a maxMs and a maxRssMb for every check the script runs, nothing else', () => {
  const file = JSON.parse(fs.readFileSync(path.join(HERE, '..', 'budgets.json'), 'utf8'));
  assert.deepEqual(Object.keys(file.checks), CHECKS.map((c) => c.id));
  for (const [id, b] of Object.entries(file.checks)) {
    assert.deepEqual(Object.keys(b).sort(), ['maxMs', 'maxRssMb'], id);
    assert.ok(b.maxMs > 0 && b.maxRssMb > 0, id);
  }
  // budgets are tightened from measurements (#657), but stay generous: at least 1.5 times the committed snapshot, so timing noise does not trip them
  const snap = JSON.parse(fs.readFileSync(path.join(HERE, '..', 'benchmark-snapshot.json'), 'utf8'));
  for (const [id, b] of Object.entries(file.checks)) {
    assert.ok(b.maxMs >= snap.checks[id].ms * 1.5 && b.maxRssMb >= snap.checks[id].peakMb * 1.5, `${id}: budget is at least 1.5 times the snapshot`);
  }
});

test('measureCli runs the real CLI cold and reports time and peak memory (or null memory where nothing can measure it)', async () => {
  const r = await measureCli(['--version']);
  assert.equal(r.exitCode, 0);
  assert.ok(r.ms > 0 && r.ms < 30_000);
  assert.ok(r.rssMb === null || (r.rssMb > 5 && r.rssMb < 2000));
  assert.match(r.method, /^(gnu-time|ps-sampling)$/);
});
