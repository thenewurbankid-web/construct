// #287 — schemas/process.v1.json and the code cannot drift.
//
// Same contract as #286's plan schema: the schema is the documentation of
// record, the hand-written validator is the runtime, and every enum and
// required-field list is read OUT of the file here and compared to the
// exported constant rather than hand-copied. Adding a state, a step status or
// a log provenance in one place and not the other fails this file.
//
// The last test is the one that matters most: a process driven all the way to
// `done` by the real engine is validated by ajv against the schema, so the
// contract is checked against what the code actually produces, not against a
// hand-written example that was kept agreeable.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';
import { makeTempDir } from '../test-utils/tmpdir.mjs';
import {
  PROCESS_STATES,
  PROCESS_STATE_PATHS,
} from '../packages/engine/processMachine.mjs';
import {
  PROCESS_VERSION,
  PROCESS_TOP_LEVEL_FIELDS,
  PROCESS_REQUIRED_FIELDS,
  STEP_STATUSES,
  LOG_PROVENANCE,
  ARTIFACT_CHANGES,
  PENDING_CONTROLS,
  createProcess,
  recordArtifact,
  setApproval,
} from '../packages/engine/processModel.mjs';
import { PLAN_EXECUTORS } from '../packages/core/plan.mjs';
import { openProcessStore } from '../packages/engine/processStore.mjs';
import { createProcessEngine } from '../packages/engine/processEngine.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCHEMA = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'schemas', 'process.v1.json'), 'utf8'));
const ajvValidate = new Ajv({ allErrors: true }).compile(SCHEMA);

const messages = (errors) => (errors || []).map((e) => `${e.instancePath} ${e.message}`).join('\n');

test('the schema\'s version, field list and required list are the code\'s', () => {
  assert.equal(SCHEMA.properties.version.const, PROCESS_VERSION);
  assert.deepEqual(Object.keys(SCHEMA.properties).sort(), [...PROCESS_TOP_LEVEL_FIELDS].sort());
  assert.deepEqual([...SCHEMA.required].sort(), [...PROCESS_REQUIRED_FIELDS].sort());
  assert.equal(SCHEMA.additionalProperties, false, 'an unknown field must be a rejection, not a silent extension');
});

test('every enum in the schema is the exported constant, so the two cannot drift', () => {
  assert.deepEqual(SCHEMA.properties.state.enum, [...PROCESS_STATE_PATHS]);
  assert.deepEqual(SCHEMA.properties.pendingControl.enum, [...PENDING_CONTROLS, null]);
  assert.deepEqual(SCHEMA.definitions.stepStatus.properties.status.enum, [...STEP_STATUSES]);
  assert.deepEqual(SCHEMA.definitions.stepStatus.properties.executor.enum, [...PLAN_EXECUTORS]);
  assert.deepEqual(SCHEMA.definitions.logEntry.properties.provenance.enum, [...LOG_PROVENANCE]);
  assert.deepEqual(SCHEMA.definitions.artifact.properties.change.enum, [...ARTIFACT_CHANGES]);
  // Every top-level state appears in the state enum, substates and all.
  for (const state of PROCESS_STATES) assert.equal(SCHEMA.properties.state.enum.includes(state), true);
});

const PLAN = {
  version: 1,
  ticket: { source: 'github-issue', ref: '#287', title: 'Process runtime model in core' },
  steps: [
    { id: 'a', title: 'Create the feature', flow: 'create.feature', args: { name: 'checkout' }, executor: 'deterministic', touches: { features: ['checkout'], files: [{ path: 'features/checkout/index.ts', change: 'create' }] } },
    { id: 'b', title: 'Write the service body', flow: 'create.unit', args: { layer: 'service', name: 'Totals', feature: 'checkout', llm: 'ollama' }, executor: 'local-model', dependsOn: ['a'], touches: { files: [{ path: 'features/checkout/services/Totals.ts', change: 'create' }] } },
    { id: 'c', title: 'Review what the model wrote', flow: 'manual.task', args: { instructions: 'Read it before accepting it.' }, executor: 'user', dependsOn: ['b'], touches: { features: [], files: [] } },
  ],
};

test('a freshly created process validates against the schema', () => {
  const p = createProcess(PLAN, { id: 'p1', projectRoot: '/tmp/project', now: () => '2026-09-20T10:00:00.000Z' });
  assert.equal(ajvValidate(p), true, messages(ajvValidate.errors));
});

test('an artifact with hashes and a verdict validates, and an absolute path does not', () => {
  const now = () => '2026-09-20T10:00:00.000Z';
  let p = createProcess(PLAN, { id: 'p1', projectRoot: '/tmp/project', now });
  p = recordArtifact(p, { path: 'features/checkout/index.ts', change: 'create', stepId: 'a', before: undefined, after: 'export {};\n', now });
  p = setApproval(p, true, ['features/checkout/index.ts']);
  assert.equal(ajvValidate(p), true, messages(ajvValidate.errors));

  const bad = { ...p, artifacts: [{ ...p.artifacts[0], path: '/etc/passwd' }] };
  assert.equal(ajvValidate(bad), false, 'artifact paths are project-relative so a record stays portable');
});

test('a process the real engine drove to done, with every state it passed through, validates', async () => {
  const projectRoot = makeTempDir('construct-schema-project-');
  const stateDir = makeTempDir('construct-schema-state-');
  fs.mkdirSync(path.join(projectRoot, 'features', 'checkout'), { recursive: true });
  let t = Date.UTC(2026, 8, 20, 11, 0, 0);
  const now = () => { const at = new Date(t).toISOString(); t += 1000; return at; };

  const store = openProcessStore(projectRoot, { stateDir, now });
  store.save(createProcess({ ...PLAN, steps: PLAN.steps.slice(0, 2) }, { id: 'p1', projectRoot, now }));

  const seen = [];
  const engine = createProcessEngine({
    store,
    now,
    validate: () => ({ violations: [], ok: true }),
    onChange: (record) => {
      seen.push(record.state);
      // EVERY intermediate record a client could be handed must validate,
      // not only the final one.
      assert.equal(ajvValidate(record), true, `${record.state}: ${messages(ajvValidate.errors)}`);
    },
    executeStep: async ({ step, transaction }) => {
      transaction.writeFile(step.id === 'a' ? 'features/checkout/index.ts' : 'features/checkout/services/Totals.ts', `// ${step.id}\n`);
      return { ok: true, llm: step.executor === 'local-model' ? { provider: 'ollama', calls: 1 } : null };
    },
  });

  engine.start('p1');
  const done = await engine.settled('p1');

  assert.equal(done.state, 'done');
  assert.equal(ajvValidate(done), true, messages(ajvValidate.errors));
  assert.equal(seen.includes('running.active'), true);
  assert.equal(done.artifacts.length, 2);
  assert.equal(done.steps[1].llm.provider, 'ollama');
});

test('a cancelled process, including its skipped steps and warn lines, validates', async () => {
  const projectRoot = makeTempDir('construct-schema-cancel-');
  const stateDir = makeTempDir('construct-schema-cancel-state-');
  let t = Date.UTC(2026, 8, 20, 12, 0, 0);
  const now = () => { const at = new Date(t).toISOString(); t += 1000; return at; };
  const store = openProcessStore(projectRoot, { stateDir, now });
  store.save(createProcess(PLAN, { id: 'p1', projectRoot, now }));

  const engine = createProcessEngine({ store, now, executeStep: async () => ({ ok: true, llm: null }) });
  const cancelled = engine.cancel('p1');

  assert.equal(cancelled.process.state, 'cancelled');
  assert.equal(ajvValidate(cancelled.process), true, messages(ajvValidate.errors));
  assert.equal(cancelled.process.steps.every((s) => s.status === 'skipped'), true);
});
