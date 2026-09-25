// #648 -- the "System requirements" page and the code cannot disagree: every number the page quotes for a tier is the tier constant,
// and every measured number is the one in the committed benchmark snapshot (written by packages/tools/dev/benchmark.mjs --update-docs).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TIERS, TIER_ORDER, renderTierTable } from '../packages/core/machine.mjs';
import { renderMeasuredTable, readBlock, snapshotOf, CHECKS } from '../packages/tools/dev/benchmark.mjs';
import { userPages } from '../packages/docs-site/lib/structure.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const page = fs.readFileSync(path.join(ROOT, 'site/content/user/system-requirements.md'), 'utf8');
const snapshot = JSON.parse(fs.readFileSync(path.join(ROOT, 'packages/tools/dev/benchmark-snapshot.json'), 'utf8'));
const budgets = JSON.parse(fs.readFileSync(path.join(ROOT, 'packages/tools/dev/budgets.json'), 'utf8'));
const REGEN = 'run: node packages/tools/dev/benchmark.mjs --docs-only';

test('the page is in the site table of contents', () => {
  assert.ok(userPages().some((p) => p.file.endsWith('system-requirements.md') && p.path === 'user-guide/system-requirements/'));
});

test('the tier table of the page is generated from TIERS', () => {
  assert.equal(readBlock(page, 'tiers'), renderTierTable(), `the tier table is out of date; ${REGEN}`);
});

test('every number in the tier table of the page equals the tier constant (parsed from the page, not from the generator)', () => {
  const rows = readBlock(page, 'tiers').split('\n').slice(2);
  assert.equal(rows.length, TIER_ORDER.length);
  for (const [i, id] of TIER_ORDER.entries()) {
    const t = TIERS[id];
    const cells = rows[i].split('|').map((c) => c.trim()).filter(Boolean);
    assert.equal(cells[0], `**${t.name}**`);
    assert.equal(Number(cells[2]), t.cores, `${id} cores`);
    const gb = [...cells[3].matchAll(/(\d+) GB/g)].map((m) => Number(m[1]));
    assert.deepEqual(gb, t.comfortableRamGb ? [t.ramGb, t.comfortableRamGb] : [t.ramGb], `${id} memory`);
    assert.equal(Number(/about (\d+) GB/.exec(cells[4])[1]), t.diskGb, `${id} disk`);
  }
});

test('the measured table of the page is exactly the committed snapshot with the committed budgets', () => {
  assert.equal(readBlock(page, 'measured'), renderMeasuredTable(snapshot, budgets), `the measured table is out of date; ${REGEN}`);
});

test('the snapshot has a line for every check, and its numbers came from a real run', () => {
  assert.deepEqual(Object.keys(snapshot.checks), CHECKS.map((c) => c.id));
  assert.match(snapshot.measuredOn, /^\d{4}-\d{2}-\d{2}$/);
  for (const [id, c] of Object.entries(snapshot.checks)) {
    if (c.skipped) continue;
    assert.ok(c.ms > 0 && c.peakMb > 0, `${id} has a time and a peak memory`);
    assert.ok(c.ms <= budgets.checks[id].maxMs && c.peakMb <= budgets.checks[id].maxRssMb, `${id} was inside its budget when measured`);
  }
});

test('snapshotOf rounds medians to 10 ms and 5 MB and keeps skipped checks with their reason', () => {
  const s = snapshotOf(
    { version: { ms: 34, rssMb: 45.3 }, 'cockpit-start': { skipped: 'dependencies are not installed' } },
    { date: '2026-09-25T10:00:00Z', machine: { node: '22.14.0', cores: 8, totalRamMb: 15603 }, runs: 5 },
  );
  assert.deepEqual(s.checks.version, { label: 'construct --version', ms: 30, peakMb: 45 });
  assert.deepEqual(s.checks['cockpit-start'], { label: 'Cockpit server, start until it answers', skipped: 'dependencies are not installed' });
  assert.deepEqual([s.measuredOn, s.memoryGb, s.cores], ['2026-09-25', 15, 8]);
});
