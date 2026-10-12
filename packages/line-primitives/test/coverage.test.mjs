// The held-out coverage metric (roadmap item 1) and its CLI, `construct line primitives coverage`.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { builtPrimitives, coverage, coverageLines, loadSurvey } from '../coverage.mjs';
import * as mock from '../mock.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(HERE, '..', '..', 'cli', 'construct.mjs');

test('a held-out component maps with no loss only when the primitive has all its states and events', () => {
  const r = coverage(mock.SURVEY, mock.PRIMITIVES);
  assert.deepEqual(r.heldOut, ['held']);
  assert.deepEqual(r.overall, { total: 2, noLoss: 1, loss: 0, unmapped: 1, percent: 50 });
  const lossy = { ...mock.SURVEY, components: [{ lib: 'held', name: 'Button', cluster: 'button', states: ['default', 'loading'], events: ['press', 'focus'] }] };
  const row = coverage(lossy, mock.PRIMITIVES).rows[0];
  assert.equal(row.status, 'loss');
  assert.deepEqual(row.missingStates, ['loading']);
  assert.deepEqual(row.missingEvents, ['focus']);
  assert.match(coverageLines(r)[0], /^50% of held-out components map onto a Line primitive with no loss \(1 of 2/);
});

test('the real survey measures only the built primitives, per held-out library', () => {
  const r = coverage(loadSurvey());
  assert.equal(builtPrimitives().length >= 15, true);
  assert.deepEqual(Object.keys(r.byLib), ['chakra', 'mantine']);
  assert.equal(r.overall.total, r.byLib.chakra.total + r.byLib.mantine.total);
  assert.ok(r.overall.percent > 0 && r.overall.percent <= 100);
  assert.ok(r.rows.every((x) => ['chakra', 'mantine'].includes(x.lib)));
});

test('construct line primitives coverage prints the metric; --json gives the rows', () => {
  const text = spawnSync(process.execPath, [CLI, 'line', 'primitives', 'coverage'], { encoding: 'utf8' });
  assert.equal(text.status, 0, text.stderr);
  assert.match(text.stdout, /% of held-out components map onto a Line primitive with no loss/);
  const json = spawnSync(process.execPath, [CLI, 'line', 'primitives', 'coverage', '--json'], { encoding: 'utf8' });
  const parsed = JSON.parse(json.stdout);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.rows.length, parsed.overall.total);
  const bad = spawnSync(process.execPath, [CLI, 'line', 'primitives', 'size'], { encoding: 'utf8' });
  assert.notEqual(bad.status, 0);
  assert.match(bad.stderr, /not a primitives command/);
});
