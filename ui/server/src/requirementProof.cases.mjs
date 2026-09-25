// #653 -- the proof routes of the Requirement screen (POST /api/requirement/proof/{status,run,skip}), against a REAL project:
// a `construct init` project where the plan of "a list of products" is applied through its own commands. Green run, a deliberately
// broken page (an app failure that names the state), the plan not applied yet (refused, with the reason), a skip that needs a
// reason, one run at a time, a bounded time, and security (foreign Origin, non-JSON, over the cap, a feature the plan does not
// name, a plan that is not a plan, no project open). The skip and the result are recorded as decision traces. Ports 49520-49522
// are this file's (49520 the real runner, 49521 a slow fake one).
import '../../../test-utils/workspaceRoot.mjs';
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import express from 'express';
import { createRequirementRouter, readRequirement } from './requirementApi.mjs';
import { PROOF_REASON, checkReason, shapeRun } from './requirementProofApi.mjs';
import { readTraces } from '../../../packages/core/decision-trace-store.mjs';
import { makeProofProject } from '../../../test-utils/proofProject.mjs';
import { makeTempDir } from '../../../test-utils/tmpdir.mjs';

const ORIGIN = 'http://localhost:3000';
const SENTENCE = 'A user wants to see a list of products';
const project = makeProofProject({ prefix: 'og653-api-' });
const stateDir = makeTempDir('og653-state-');
process.env.CONSTRUCT_STATE_DIR = stateDir;
const chosen = readRequirement({ text: SENTENCE, answers: [{ id: 'q-shape', option: 'list' }] }, project.root);
const PLAN = chosen.body.plan;

const servers = [];
let slow;
const gate = { release: null };
const listen = (port, deps) => new Promise((resolve) => {
  const app = express();
  app.use(express.json());
  app.use('/api/requirement', createRequirementRouter({ clientOrigin: ORIGIN, ...deps }));
  const server = http.createServer(app);
  servers.push(server);
  server.listen(port, '127.0.0.1', resolve);
});
before(async () => {
  await listen(49520, { getRoot: () => ({ ok: true, root: project.root }) });
  await listen(49521, {
    getRoot: () => ({ ok: true, root: project.root }),
    proofTimeoutMs: 100,
    proofRunner: () => new Promise((resolve) => { gate.release = () => resolve({ ok: true, feature: 'products', durationMs: 1, counts: { total: 1, passed: 1, failed: 0, notRun: 0 }, tests: [{ title: 't', status: 'passed', durationMs: 1 }] }); }),
  });
  await listen(49522, { getRoot: () => ({ ok: false, status: 409, body: { ok: false, code: 'NO_PROJECT', error: 'No project is open.' } }) });
  slow = 49521;
});
after(() => {
  for (const s of servers) { s.close(); s.closeAllConnections?.(); }
  project.remove();
});

const call = async (name, body, { port = 49520, headers = {}, raw } = {}) => {
  const res = await fetch(`http://127.0.0.1:${port}/api/requirement/proof/${name}`, { method: 'POST', headers: { origin: ORIGIN, connection: 'close', 'content-type': 'application/json', ...headers }, body: raw ?? JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
};
const target = { feature: 'products', plan: PLAN };
const traces = () => readTraces(project.root, { stateDir }).decisions.filter((d) => d.chooser.id === 'requirement.proof.next');

test('the read response carries the plan\'s proof, pending and incomplete', () => {
  assert.equal(chosen.status, 200);
  assert.ok(JSON.stringify(PLAN).length < 32 * 1024, `a whole plan fits the proof routes' cap: ${JSON.stringify(PLAN).length} bytes`);
  assert.deepEqual(chosen.body.proof.steps.map((s) => [s.name, s.kind, s.verifiedBy]), [['Products', 'render', 's12']]);
  assert.equal(chosen.body.proof.complete, false);
  assert.equal(chosen.body.proof.state, 'pending');
});

test('before the plan is applied: status says so, run is refused with the reason, and a skip is allowed only with a reason', async () => {
  const status = await call('status', target);
  assert.deepEqual([status.status, status.body.applied], [200, false]);
  assert.deepEqual(status.body.options.map((o) => o.id), ['run-proof', 'skip-proof'], 'the closed options of a proof that has not run');
  const run = await call('run', target);
  assert.equal(run.status, 409);
  assert.equal(run.body.code, 'NOT_APPLIED');
  assert.match(run.body.error, /Approve the plan first/);
  for (const reason of [undefined, '', '   ', 'short', 'x'.repeat(PROOF_REASON.max + 1), 'two\nlines of reason', 12]) {
    const r = await call('skip', { ...target, reason });
    assert.deepEqual([r.status, r.body.code], [400, 'REASON_REQUIRED'], JSON.stringify(reason));
  }
  assert.equal(traces().length, 0, 'a refused skip records nothing');
});

test('after the plan is applied: status says so, a run is green and the chain is complete; the run is recorded', async () => {
  project.applyPlan(PLAN);
  assert.equal((await call('status', target)).body.applied, true);
  const run = await call('run', target);
  assert.equal(run.status, 200, JSON.stringify(run.body));
  assert.equal(run.body.run.state, 'green');
  assert.equal(run.body.run.complete, true);
  assert.equal(run.body.run.counts.failed, 0);
  assert.ok(run.body.run.counts.total >= 10);
  assert.deepEqual(run.body.run.summary.options, [], 'a green proof offers nothing more to do');
  const [t] = traces();
  assert.equal(t.chosen, 'run-proof');
  assert.equal(t.by, 'person');
  assert.equal(t.outcome?.testsPassed, true);
  assert.deepEqual(t.options, ['run-proof', 'skip-proof']);
});

test('a deliberately broken page fails the proof: the failing state is named, classified app, and the options are the closed ones', async () => {
  project.breakEmptyState();
  const run = await call('run', target);
  assert.equal(run.status, 200);
  assert.equal(run.body.run.state, 'failed');
  assert.equal(run.body.run.complete, false);
  const [f] = run.body.run.failures;
  assert.equal(f.kind, 'app');
  assert.equal(f.expected, 'empty');
  assert.equal(f.reached, 'blank');
  assert.equal(f.summary, 'The page given no rows: the empty state is wrong, the screen shows blank.');
  assert.ok(f.message.length <= 800);
  assert.doesNotMatch(JSON.stringify(run.body), /construct-proof-/, 'no temp directory of the runner leaks into the answer');
  assert.deepEqual(run.body.run.summary.options.map((o) => o.id), ['edit-code', 'fill-with-ai', 'skip-proof']);
  assert.ok(traces().some((t) => t.chosen === 'run-proof' && t.outcome?.testsPassed === false), 'the failed run is recorded as its outcome');
});

test('a skip with a reason is recorded (with the options of the failed run) and answers "skipped", complete, with the trimmed reason', async () => {
  const r = await call('skip', { ...target, reason: '  the empty state is redesigned in #700  ' });
  assert.equal(r.status, 200);
  assert.deepEqual([r.body.skipped, r.body.state, r.body.complete, r.body.reason], [true, 'skipped', true, 'the empty state is redesigned in #700']);
  const skip = traces().find((t) => t.chosen === 'skip-proof');
  assert.deepEqual(skip.options, ['edit-code', 'fill-with-ai', 'skip-proof']);
  assert.doesNotMatch(JSON.stringify(skip), /redesigned/, 'the free text of the reason is not in the trace');
  project.fixEmptyState();
  assert.equal((await call('run', target)).body.run.state, 'green', 'fixed, it is green again');
});

test('a convention failure (a file the proof binds to is gone) is classified as such', async () => {
  const page = 'features/products/pages/ProductsPage.page.tsx';
  const original = project.read(page);
  fs.renameSync(`${project.root}/${page}`, `${project.root}/${page}.gone`);
  const run = await call('run', target);
  fs.renameSync(`${project.root}/${page}.gone`, `${project.root}/${page}`);
  assert.equal(project.read(page), original);
  assert.equal(run.body.run.state, 'failed');
  assert.equal(run.body.run.failures[0].kind, 'convention');
  assert.deepEqual(run.body.run.summary.options.map((o) => o.id), ['regenerate-screen', 'edit-code', 'skip-proof']);
});

test('one run at a time per project, and a bounded time (the lock outlives the request that gave up)', async () => {
  const first = call('run', target, { port: slow });
  await new Promise((r) => setTimeout(r, 40));
  const second = await call('run', target, { port: slow });
  assert.deepEqual([second.status, second.body.code], [409, 'RUN_IN_PROGRESS']);
  const timedOut = await first;
  assert.deepEqual([timedOut.status, timedOut.body.code], [504, 'TIMEOUT']);
  assert.equal((await call('run', target, { port: slow })).body.code, 'RUN_IN_PROGRESS', 'still held: the run has not ended');
  gate.release();
  await new Promise((r) => setTimeout(r, 40));
  const again = call('run', target, { port: slow });
  await new Promise((r) => setTimeout(r, 20));
  gate.release();
  assert.notEqual((await again).body.code, 'RUN_IN_PROGRESS', 'the lock is released once the run ended');
});

test('security: what is refused, without running anything', async () => {
  assert.equal((await call('run', target, { headers: { origin: 'http://evil.example' } })).status, 403);
  assert.equal((await call('run', target, { headers: { 'content-type': 'text/plain' }, raw: 'feature=products' })).status, 415);
  assert.equal((await call('run', target, { raw: JSON.stringify({ ...target, pad: 'x'.repeat(70 * 1024) }) })).status, 413);
  for (const feature of ['../products', 'products/../..', '/etc', 'Products X', '', 7, undefined, 'core']) {
    const r = await call('run', { feature, plan: PLAN });
    assert.equal(r.status, 400, JSON.stringify(feature));
    assert.match(r.body.code, /^(BAD_FEATURE|NO_PROOF_IN_PLAN)$/, JSON.stringify(feature));
  }
  assert.equal((await call('run', { feature: 'products' })).body.code, 'BAD_PLAN');
  assert.equal((await call('run', { feature: 'products', plan: [] })).body.code, 'BAD_PLAN');
  assert.equal((await call('run', { feature: 'products', plan: { version: 1, steps: 'x' } })).body.code, 'BAD_PLAN');
  const shaped = structuredClone(PLAN);
  shaped.steps.find((s) => s.flow === 'test.proof').args.name = '../../evil.proof.test.ts';
  assert.equal((await call('run', { feature: 'products', plan: shaped })).body.code, 'BAD_PLAN', 'a proof is named by its file name, never a path');
  const smuggled = { ...target, path: '/etc', root: '/', dir: '/tmp' };
  assert.equal((await call('status', smuggled)).body.files[0], 'ProductsScreen.proof.test.ts', 'a path in the body is not read');
  const none = await call('run', target, { port: 49522 });
  assert.deepEqual([none.status, none.body.code], [409, 'NO_PROJECT']);
});

test('shapeRun and checkReason: a run that could not start is a failed chain with the reason; the reason is one trimmed line', () => {
  const shaped = shapeRun({ ok: false, error: { code: 'RUNNER_MISSING', message: 'no esbuild' } });
  assert.deepEqual([shaped.state, shaped.complete, shaped.error.code], ['failed', false, 'RUNNER_MISSING']);
  assert.deepEqual(shaped.summary.options.map((o) => o.id), ['edit-code', 'skip-proof']);
  assert.deepEqual(checkReason('  a good reason  '), { ok: true, reason: 'a good reason' });
  assert.equal(checkReason('x'.repeat(PROOF_REASON.min)).ok, true);
  assert.equal(checkReason('x'.repeat(PROOF_REASON.min - 1)).ok, false);
  assert.equal(checkReason('x'.repeat(PROOF_REASON.max)).ok, true);
});
