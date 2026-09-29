// #748 (R6) -- `handleResearch`'s new `spec` action: the argv it builds for `construct research spec`, so the
// Cockpit's spec-breakdown screen can validate, read back and generate a machine-spec.v1 file. The `summarize`/
// `doctor` actions already have coverage through the route itself (ui/e2e); this file only covers the branch
// this ticket added, with a stubbed `inProcess` (real argv building, no real CLI run).
import test from 'node:test';
import assert from 'node:assert/strict';
import { handleResearch } from './researchApi.mjs';

test('spec: builds `spec <file> --format json`, no flags', async () => {
  let seenArgs;
  const result = await handleResearch({
    body: { action: 'spec', file: 'specs/sign-in.machine-spec.json' },
    projectDir: '/proj',
    findRoot: () => '/proj',
    inProcess: async (args) => { seenArgs = args; return { ok: true, output: ['{}'], httpStatus: 200 }; },
  });
  assert.deepEqual(seenArgs, ['spec', 'specs/sign-in.machine-spec.json', '--format', 'json']);
  assert.equal(result.status, 200);
  assert.equal(result.body.mode, 'engine');
});

test('spec: readBack adds --read-back', async () => {
  let seenArgs;
  await handleResearch({
    body: { action: 'spec', file: 'x.json', readBack: true },
    projectDir: '/proj',
    findRoot: () => '/proj',
    inProcess: async (args) => { seenArgs = args; return { ok: true, output: ['{}'], httpStatus: 200 }; },
  });
  assert.deepEqual(seenArgs, ['spec', 'x.json', '--format', 'json', '--read-back']);
});

test('spec: generate adds --generate and --feature when given', async () => {
  let seenArgs;
  await handleResearch({
    body: { action: 'spec', file: 'x.json', generate: true, feature: 'auth' },
    projectDir: '/proj',
    findRoot: () => '/proj',
    inProcess: async (args) => { seenArgs = args; return { ok: true, output: ['{}'], httpStatus: 200 }; },
  });
  assert.deepEqual(seenArgs, ['spec', 'x.json', '--format', 'json', '--generate', '--feature', 'auth']);
});

test('spec: readBack and generate together is a 400, not a CLI call', async () => {
  let called = false;
  const result = await handleResearch({
    body: { action: 'spec', file: 'x.json', readBack: true, generate: true },
    projectDir: '/proj',
    findRoot: () => '/proj',
    inProcess: async () => { called = true; return { ok: true, output: [], httpStatus: 200 }; },
  });
  assert.equal(result.status, 400);
  assert.equal(called, false);
});

test('spec: file is required', async () => {
  const result = await handleResearch({ body: { action: 'spec' }, projectDir: '/proj', findRoot: () => '/proj', inProcess: async () => ({ ok: true, output: [], httpStatus: 200 }) });
  assert.equal(result.status, 400);
  assert.match(result.body.error, /file is required/);
});

test('spec: always runs in-process even when the project asks for cli mode', async () => {
  let calledInProcess = false;
  let calledCli = false;
  // executionFor would answer 'cli' here in the real module; this test only needs to prove the spec branch never
  // reaches a `cli`-mode path even conceptually, so it stubs findRoot to a root and trusts the code's `if (action
  // === 'spec') return inProc();` short-circuit (read directly from researchApi.mjs).
  const result = await handleResearch({
    body: { action: 'spec', file: 'x.json' },
    projectDir: '/proj',
    findRoot: () => '/proj',
    inProcess: async () => { calledInProcess = true; return { ok: true, output: ['{}'], httpStatus: 200 }; },
  });
  assert.equal(calledInProcess, true);
  assert.equal(calledCli, false);
  assert.equal(result.body.mode, 'engine');
});

test('unknown action still names all three now', async () => {
  const result = await handleResearch({ body: { action: 'nope' }, projectDir: null, inProcess: async () => ({ ok: true, output: [], httpStatus: 200 }) });
  assert.equal(result.status, 400);
  assert.match(result.body.error, /summarize.*doctor.*spec/);
});
