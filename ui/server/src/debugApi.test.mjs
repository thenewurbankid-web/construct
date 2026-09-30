// LIN-137 -- the debug chain route. Behaviour over a real fixture project (a full answer set compiles a valid, ordered
// plan; debug.fix's ai exit is excluded from the compiled plan and recorded as its own decision instead), the current
// step advancing one chooser at a time, and security: a foreign Origin, a non-JSON body, a body over the cap, and an
// unknown chooser or option are all refused without reading anything. Port 49700 is this file's own.
import '../../../test-utils/workspaceRoot.mjs';
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { createDebugRouter, readDebug, MAX_ANSWERS, MAX_FEATURE } from './debugApi.mjs';
import { validatePlan } from '../../../packages/core/plan.mjs';
import { makeTempDir } from '../../../test-utils/tmpdir.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const SHARED = path.join(REPO, 'fixtures', 'impact-shared');
const ORIGIN = 'http://localhost:3000';

const root = makeTempDir('lin137-debug-');
fs.cpSync(SHARED, root, { recursive: true });

let server;
const base = 'http://127.0.0.1:49700';
before(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/debug', createDebugRouter({ getRoot: () => ({ ok: true, root }), clientOrigin: ORIGIN }));
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(49700, '127.0.0.1', resolve));
});
after(() => {
  server.close();
  server.closeAllConnections?.();
});

const post = async (body, headers = {}, raw) => {
  const res = await fetch(`${base}/api/debug/read`, { method: 'POST', headers: { origin: ORIGIN, 'content-type': 'application/json', ...headers }, body: raw ?? JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
};

test('no answers yet: the first chooser (debug.reproduce) is current, nothing else is answered', async () => {
  const r = await post({ feature: 'cart' });
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  assert.equal(r.body.current, 'debug.reproduce');
  assert.equal(r.body.done, false);
  assert.equal(r.body.plan, null);
  assert.deepEqual(Object.keys(r.body.summaries), ['debug.reproduce', 'debug.isolate', 'debug.fix', 'debug.verify']);
  assert.equal(r.body.summaries['debug.reproduce'].chosen, null);
  assert.equal(r.body.exits['debug.fix'].kind, 'ai');
  assert.equal(r.body.exits['debug.reproduce'].kind, 'manual');
});

test('answers advance the current step one chooser at a time', async () => {
  const r = await post({ feature: 'cart', answers: [{ chooser: 'debug.reproduce', option: 'playwright-test' }] });
  assert.equal(r.body.current, 'debug.isolate');
  assert.equal(r.body.summaries['debug.reproduce'].chosen, 'playwright-test');
  assert.equal(r.body.summaries['debug.isolate'].chosen, null);
});

test('a full answer set (excluding the ai exit) compiles a valid, ordered plan of four steps', async () => {
  const r = await post({
    feature: 'cart',
    answers: [
      { chooser: 'debug.reproduce', option: 'playwright-test' },
      { chooser: 'debug.isolate', option: 'narrow' },
      { chooser: 'debug.fix', option: 'add-unit' },
      { chooser: 'debug.verify', option: 'rerun-repro' },
    ],
  });
  assert.equal(r.body.done, true);
  assert.equal(r.body.current, null);
  assert.equal(r.body.fixIsAi, false);
  assert.equal(validatePlan(r.body.plan).valid, true);
  assert.deepEqual(r.body.plan.steps.map((s) => s.flow), ['test.run', 'test.run', 'create.unit', 'test.run']);
});

test('debug.fix answered with its ai exit is excluded from the compiled plan (three steps, not four)', async () => {
  const r = await post({
    feature: 'cart',
    answers: [
      { chooser: 'debug.reproduce', option: 'playwright-test' },
      { chooser: 'debug.isolate', option: 'narrow' },
      { chooser: 'debug.fix', option: 'exit' },
      { chooser: 'debug.verify', option: 'rerun-repro' },
    ],
  });
  assert.equal(r.body.done, true);
  assert.equal(r.body.fixIsAi, true);
  assert.equal(validatePlan(r.body.plan).valid, true);
  assert.deepEqual(r.body.plan.steps.map((s) => s.flow), ['test.run', 'test.run', 'test.run']);
});

test('readDebug (in-process): the ai-fix choice is recorded beside the compiled decisions', () => {
  const trace = { choices: [] };
  const out = readDebug(
    {
      feature: 'cart',
      answers: [
        { chooser: 'debug.reproduce', option: 'playwright-test' },
        { chooser: 'debug.isolate', option: 'narrow' },
        { chooser: 'debug.fix', option: 'exit' },
        { chooser: 'debug.verify', option: 'rerun-repro' },
      ],
    },
    root,
    trace,
  );
  assert.equal(out.status, 200);
  assert.equal(trace.planValidated, true);
  assert.deepEqual(trace.choices.map((c) => c.chooser.id), ['debug.reproduce', 'debug.isolate', 'debug.fix', 'debug.verify']);
  assert.deepEqual(trace.choices.map((c) => c.chosen), ['playwright-test', 'narrow', 'exit', 'rerun-repro']);
});

test('no feature: 400', async () => {
  const r = await post({});
  assert.equal(r.status, 400);
  assert.equal(r.body.code, 'FEATURE_REQUIRED');
});

test('a feature name over the cap: 400', async () => {
  const r = await post({ feature: 'x'.repeat(MAX_FEATURE + 1) });
  assert.equal(r.status, 400);
  assert.equal(r.body.code, 'FEATURE_TOO_LONG');
});

test('too many answers: 400', async () => {
  const r = await post({ feature: 'cart', answers: Array(MAX_ANSWERS + 1).fill({ chooser: 'debug.reproduce', option: 'playwright-test' }) });
  assert.equal(r.status, 400);
  assert.equal(r.body.code, 'BAD_ANSWERS');
});

test('an unknown chooser id: 400', async () => {
  const r = await post({ feature: 'cart', answers: [{ chooser: 'debug.nope', option: 'playwright-test' }] });
  assert.equal(r.status, 400);
  assert.equal(r.body.code, 'BAD_ANSWERS');
});

test('an unknown option id: refused when the plan compiles (CHAIN_ANSWER_UNKNOWN_OPTION)', async () => {
  const r = await post({
    feature: 'cart',
    answers: [
      { chooser: 'debug.reproduce', option: 'playwright-test' },
      { chooser: 'debug.isolate', option: 'narrow' },
      { chooser: 'debug.fix', option: 'add-unit' },
      { chooser: 'debug.verify', option: 'nope' },
    ],
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.plan, null);
  assert.deepEqual(r.body.errors.map((e) => e.code), ['CHAIN_ANSWER_UNKNOWN_OPTION']);
});

test('a foreign Origin is refused', async () => {
  const r = await post({ feature: 'cart' }, { origin: 'https://evil.example' });
  assert.equal(r.status, 403);
});

test('a non-JSON body is refused', async () => {
  const r = await post(undefined, { 'content-type': 'text/plain' }, 'feature=cart');
  assert.equal(r.status, 415);
});

test('a body over the cap is refused', async () => {
  const r = await post({ feature: 'cart', answers: [], padding: 'x'.repeat(9000) });
  assert.equal(r.status, 413);
});

test('no project open: the getRoot failure is surfaced as-is', async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/debug', createDebugRouter({ getRoot: () => ({ ok: false, status: 409, body: { ok: false, error: 'No project open.' } }), clientOrigin: ORIGIN }));
  const s = http.createServer(app);
  await new Promise((resolve) => s.listen(49701, '127.0.0.1', resolve));
  const res = await fetch('http://127.0.0.1:49701/api/debug/read', { method: 'POST', headers: { origin: ORIGIN, 'content-type': 'application/json' }, body: JSON.stringify({ feature: 'cart' }) });
  assert.equal(res.status, 409);
  s.close();
  s.closeAllConnections?.();
});
