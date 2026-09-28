// #750 -- `construct mutation-check` (packages/core/mutation-check.mjs): an on-demand, Stryker-backed
// test-strength signal scoped to touched files. Tests inject a fake `runStryker` so the suite never pays
// for an actual mutation run (that's the whole point of "on-demand", not "on every keystroke").
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeTempDir } from '../test-utils/tmpdir.mjs';
import { mutationCheck, mutationCheckBlock, summarizeMutantResults } from '../packages/core/mutation-check.mjs';
import { ConstructError } from '../packages/core/diagnostics.mjs';
import { runBlock } from '../packages/core/block-contract.mjs';

function mutant(status, overrides = {}) {
  return { status, fileName: 'total.ts', location: { start: { line: 1 } }, mutatorName: 'ArithmeticOperator', ...overrides };
}

test('summarizeMutantResults: score is detected / (detected + survived), NoCoverage excluded from the denominator', () => {
  const results = [mutant('Killed'), mutant('Killed'), mutant('Survived'), mutant('NoCoverage'), mutant('Timeout')];
  const summary = summarizeMutantResults(results);
  assert.equal(summary.mutationScore, 75); // (killed 2 + timeout 1) / (3 + survived 1) = 3/4
  assert.deepEqual(summary.counts, { killed: 2, survived: 1, timeout: 1, noCoverage: 1, other: 0, total: 5 });
});

test('summarizeMutantResults: surviving mutants report file, line and mutator', () => {
  const results = [mutant('Survived', { fileName: 'a.ts', location: { start: { line: 7 } }, mutatorName: 'EqualityOperator' })];
  const { survivingMutants } = summarizeMutantResults(results);
  assert.deepEqual(survivingMutants, [{ file: 'a.ts', line: 7, mutator: 'EqualityOperator' }]);
});

test('summarizeMutantResults: no valid mutants (e.g. all NoCoverage) reports a null score, not NaN', () => {
  const { mutationScore } = summarizeMutantResults([mutant('NoCoverage')]);
  assert.equal(mutationScore, null);
});

test('mutationCheck: requires at least one file', async () => {
  const root = makeTempDir('construct-mutation-check-');
  await assert.rejects(() => mutationCheck(root, []), (err) => err instanceof ConstructError && err.exitCode === 2);
});

test('mutationCheck: scopes Stryker to the given files, restores cwd, and reports the summary', async () => {
  const root = makeTempDir('construct-mutation-check-');
  fs.writeFileSync(path.join(root, 'total.ts'), 'export const total = (a, b) => a + b;\n');
  const previousCwd = process.cwd();
  let seenCliOptions;
  let cwdDuringRun;
  const runStryker = async (cliOptions) => {
    seenCliOptions = cliOptions;
    cwdDuringRun = process.cwd();
    return [mutant('Killed'), mutant('Survived')];
  };
  const result = await mutationCheck(root, ['total.ts'], { runStryker, testCommand: 'node --test' });
  assert.equal(process.cwd(), previousCwd, 'cwd is restored after the run');
  assert.equal(cwdDuringRun, fs.realpathSync(root), 'Stryker ran with the project root as cwd');
  assert.deepEqual(seenCliOptions.mutate, ['total.ts']);
  assert.equal(seenCliOptions.testRunner, 'command');
  assert.deepEqual(seenCliOptions.commandRunner, { command: 'node --test' });
  assert.deepEqual(result.files, ['total.ts']);
  assert.equal(result.mutationScore, 50);
});

test('mutationCheck: restores cwd even when Stryker throws', async () => {
  const root = makeTempDir('construct-mutation-check-');
  const previousCwd = process.cwd();
  const runStryker = async () => {
    throw new Error('mutation run failed');
  };
  await assert.rejects(() => mutationCheck(root, ['total.ts'], { runStryker }), /mutation run failed/);
  assert.equal(process.cwd(), previousCwd);
});

test('mutationCheckBlock is a valid, read-only block-contract block that surfaces its result via ctx', async () => {
  assert.equal(mutationCheckBlock.writes, false);
  const root = makeTempDir('construct-mutation-check-');
  const runStryker = async () => [mutant('Killed')];
  const ctx = { root };
  const { changedFiles } = await runBlock(mutationCheckBlock, { files: ['total.ts'], testCommand: undefined, runStryker }, ctx);
  assert.deepEqual(changedFiles, []);
  assert.equal(ctx.lastResult.mutationScore, 100);
});
