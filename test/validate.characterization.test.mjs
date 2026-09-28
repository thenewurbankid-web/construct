// #544 -- characterization snapshot of `construct validate` (all four DEFAULT_ENFORCERS
// modules) over every fixture/example project in the repo, asserted byte-identical against
// the committed golden. This is the safety net #545's per-rule catalog migration is checked
// against: a rule moved into packages/core/rules/ must never change what this test sees.
// To intentionally update the golden after a real behavior change, run:
//   node test/validate.characterization.golden.gen.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT, runCharacterization } from './validate.characterization.shared.mjs';

const GOLDEN_PATH = path.join(REPO_ROOT, 'test', 'validate.characterization.golden.json');

test('construct validate over every fixture/example project matches the committed golden byte-for-byte', () => {
  const current = `${JSON.stringify(runCharacterization(), null, 2)}\n`;
  const golden = fs.readFileSync(GOLDEN_PATH, 'utf8');
  assert.equal(current, golden, 'run `node test/validate.characterization.golden.gen.mjs` only when a rule\'s intended behavior really changed');
});
