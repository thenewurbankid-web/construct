// #611 -- a block turned off for a project (Features, Blocks tab) stops EVERY start of a plan that uses it, not only the
// Features screen's Run: the Git screen's Review analysis and the Tests screen's run start their own plans, so the refusal
// lives in processesService.startPlan. Nothing is saved or started on refusal; turning the block back on restores the run.
import '../../../test-utils/workspaceRoot.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeTempDir } from '../../../test-utils/tmpdir.mjs';
import { createProcessesService } from './processesService.mjs';
import { openBlockSettingsStore } from './blockSettingsStore.mjs';
import { analysisPlan, createAnalyses, createResults } from './reviewAnalyses.mjs';
import { testRunPlan, createTestRuns, createRunResults } from './testRuns.mjs';

const SHA = 'a'.repeat(40);
const review = () => analysisPlan({ baseName: 'main', headName: 'feature', baseSha: SHA, headSha: 'b'.repeat(40), expected: null });
const tests = () => testRunPlan({ feature: 'jobs', origin: 'http://localhost:3000' });

function setup() {
  const root = makeTempDir('og611-project-');
  fs.writeFileSync(path.join(root, 'architecture.yml'), 'version: 1\npreset: strict-nextjs\nproject:\n  framework: nextjs\nfeatures:\n  root: features\n');
  const stateDir = makeTempDir('og611-state-');
  const blocks = openBlockSettingsStore(root, { stateDir });
  // A start that never finishes: only the decision to start is under test.
  const service = createProcessesService({ getProjectDir: () => root, stateDir, executeStep: () => new Promise(() => {}), getBlockSettings: (r) => openBlockSettingsStore(r, { stateDir }).disabledFlows() });
  return { root, stateDir, blocks, service, count: () => service.store().all().processes.length };
}

const turn = (blocks, flow, enabled) => {
  const { record } = blocks.read();
  return blocks.update({ rev: record.rev, blocks: { [flow]: { enabled } } });
};

test('review.analyze off: the Git screen path refuses, names the block and where to turn it on, and starts nothing', () => {
  const { service, blocks, count } = setup();
  turn(blocks, 'review.analyze', false);
  const r = service.startPlan(review());
  assert.equal(r.ok, false);
  assert.equal(r.status, 409);
  assert.match(r.error, /"review\.analyze" is turned off/);
  assert.match(r.error, /Features, Blocks tab/);
  assert.equal(count(), 0, 'no process record was created');
  // Through the screen's own service (createAnalyses), the caller sees the same refusal.
  const analyses = createAnalyses({ service, results: createResults() });
  const viaScreen = analyses.start({ baseName: 'main', headName: 'feature', baseSha: SHA, headSha: 'b'.repeat(40), expected: null });
  assert.equal(viaScreen.ok, false);
  assert.match(viaScreen.error, /turned off/);
  assert.equal(count(), 0);
});

test('test.run off: the Tests screen path refuses and starts nothing; turning it back on restores the run', () => {
  const { service, blocks, count } = setup();
  turn(blocks, 'test.run', false);
  const runs = createTestRuns({ service, results: createRunResults() });
  const refused = runs.start({ feature: 'jobs', origin: 'http://localhost:3000' });
  assert.equal(refused.ok, false);
  assert.match(refused.error, /"test\.run" is turned off/);
  assert.equal(count(), 0);
  turn(blocks, 'test.run', true);
  const started = service.startPlan(tests());
  assert.equal(started.ok, true, JSON.stringify(started));
  assert.equal(count(), 1);
});

test('a block that is off does not stop a different block; a plan with no off block starts', () => {
  const { service, blocks } = setup();
  turn(blocks, 'test.run', false);
  assert.equal(service.startPlan(review()).ok, true);
});

test('settings that cannot be read refuse every start (fail closed), and say how to reset', () => {
  const { service, blocks, count } = setup();
  fs.mkdirSync(path.dirname(blocks.file), { recursive: true });
  fs.writeFileSync(blocks.file, '{ not json');
  const r = service.startPlan(review());
  assert.equal(r.ok, false);
  assert.match(r.error, /could not be read/);
  assert.equal(count(), 0);
});

test('without a settings source (harnesses) nothing is refused', () => {
  const root = makeTempDir('og611-project-');
  fs.writeFileSync(path.join(root, 'architecture.yml'), 'version: 1\npreset: strict-nextjs\nproject:\n  framework: nextjs\nfeatures:\n  root: features\n');
  const service = createProcessesService({ getProjectDir: () => root, stateDir: makeTempDir('og611-state-'), executeStep: () => new Promise(() => {}) });
  assert.equal(service.startPlan(review()).ok, true);
});
