// Mock mode (?line=mock): every Line screen shares one in-memory project, and applying a fix there behaves like
// POST /api/line/fix (Saved., the problem gone; an advice-only or unknown fix is a refusal, not a throw).
import test from 'node:test';
import assert from 'node:assert/strict';
import { MOCK_ROOT, mockLineOps, mockWrite } from './lineMockOps.ts';

const findings = () => mockLineOps.readLineProject(MOCK_ROOT).findings;

test('mock findings carry keys and fixes; applying the recommended one saves and clears it', () => {
  const before = findings();
  const target = before.find((f) => f.fixes && f.fixes.length && f.fixes[0].step);
  assert.ok(target, 'the mock has a fixable finding');
  const r = mockWrite(() => mockLineOps.applyFix(MOCK_ROOT, { findingKey: target.key, fixId: target.fixes[0].id }));
  assert.equal(r.ok, true);
  assert.match(r.sentence, /^Saved\./);
  assert.equal(findings().some((f) => f.key === target.key), false, 'the problem is gone from the shared project');
});

test('an unknown problem is a refusal sentence, not a throw', () => {
  const r = mockWrite(() => mockLineOps.applyFix(MOCK_ROOT, { findingKey: 'LINE-BASE|nope|1', fixId: 'x' }));
  assert.equal(r.ok, false);
  assert.equal(r.code, 'UNKNOWN_FINDING');
});
