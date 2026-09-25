// #643 -- the Requirement route records the closed questions a person answers as decision-trace.v1 records in the state
// directory (never the project): the answer, the rules suggestion and whether it was taken, and `planValidated` once the plan
// from those answers validates. Off by `traces: off`, failure-safe, and it never changes a response. Ports 49500-49549 are this
// file's (49500 the route on its own).
import '../../../test-utils/workspaceRoot.mjs';
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { createRequirementRouter, readRequirement } from './requirementApi.mjs';
import { readTraces, traceDir } from '../../../packages/core/decision-trace-store.mjs';
import { makeTempDir } from '../../../test-utils/tmpdir.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const ORIGIN = 'http://localhost:3000';
const FROB = 'A customer wants to frobnicate the invoice list.';
const LIST = 'A user wants to see a list of products';
const PORT = 49500;

let server;
let root;
let stateDir;
const saved = process.env.CONSTRUCT_STATE_DIR;

before(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/requirement', createRequirementRouter({ getRoot: () => ({ ok: true, root }), clientOrigin: ORIGIN }));
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(PORT, '127.0.0.1', resolve));
});
after(() => {
  server.close();
  server.closeAllConnections?.();
  if (saved === undefined) delete process.env.CONSTRUCT_STATE_DIR;
  else process.env.CONSTRUCT_STATE_DIR = saved;
});

/** A fresh project and a fresh state directory for every test, so what is recorded is only what the test did. */
function fresh(yml) {
  root = makeTempDir('og643-api-root-');
  fs.cpSync(path.join(REPO, 'fixtures', 'impact-shared'), root, { recursive: true });
  if (yml !== undefined) fs.appendFileSync(path.join(root, 'architecture.yml'), `\n${yml}\n`);
  stateDir = makeTempDir('og643-api-state-');
  process.env.CONSTRUCT_STATE_DIR = stateDir;
}
const post = async (body) => {
  const res = await fetch(`http://127.0.0.1:${PORT}/api/requirement/read`, { method: 'POST', headers: { origin: ORIGIN, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
};
const traces = () => readTraces(root, { stateDir });
/** The route adds the decision provider's `suggestions` (#633) to what the deterministic blocks return; the rest is byte for byte theirs. */
const bare = ({ suggestions, decisionProvider, ...rest }) => rest;

test('reading a sentence and answering nothing records nothing', async () => {
  fresh();
  assert.equal((await post({ text: FROB })).status, 200, 'the first read only asks the question');
  assert.equal((await post({ text: 'A user can click a button to save.' })).status, 200);
  assert.equal(fs.existsSync(traceDir(root, { stateDir })), false, 'no answer, no trace');
});

test('a person answering an open question of the card is recorded: the question as offered, the option, by a person, the rules suggestion overridden, the plan validated', async () => {
  fresh();
  const r = await post({ text: FROB, answers: [{ id: 'o1', option: 'interact' }] });
  assert.equal(r.status, 200);
  assert.ok(r.body.plan, 'the answer produced a plan');
  const { decisions, skipped } = traces();
  assert.equal(skipped, 0);
  assert.equal(decisions.length, 1);
  const [d] = decisions;
  assert.equal(d.chooser.id, 'requirement.card.verb');
  assert.deepEqual([d.chosen, d.by], ['interact', 'person']);
  assert.deepEqual(d.options, ['read', 'write', 'interact', 'navigate', 'ignore']);
  assert.equal(d.summary.chosen, null, 'the question as it was offered');
  assert.equal(d.summary.id, 'o1');
  assert.deepEqual(d.suggestion, { option: 'read', reason: 'first available step' });
  assert.deepEqual(d.provider, { name: 'rules', version: '1' });
  assert.deepEqual(d.outcome, { accepted: false, planValidated: true });
  assert.equal(JSON.stringify(decisions).includes(root), false, 'no server path in a trace');
  assert.equal(fs.readdirSync(root).includes('decisions.jsonl'), false);
  assert.equal(fs.existsSync(path.join(root, '.construct')), false, 'nothing recorded inside the project');
});

test('the client replays every answer on every request: the same answers record each decision once, and a new answer adds one', async () => {
  fresh();
  const answers = [{ id: 'o1', option: 'interact' }];
  await post({ text: FROB, answers });
  await post({ text: FROB, answers });
  await post({ text: FROB, answers });
  assert.equal(traces().decisions.length, 1);
  assert.equal(traces().outcomes.length, 1, 'planValidated once too');
  await post({ text: FROB, answers: [{ id: 'o1', option: 'read' }] });
  const ds = traces().decisions;
  assert.equal(ds.length, 2, 'a different answer is a different decision');
  assert.deepEqual(ds.map((d) => d.outcome.accepted), [false, true], 'taking the suggestion is recorded as accepted');
});

test('the q-shape offer: answering it is recorded with the offer as shown and the rules suggestion; the plan validated', async () => {
  fresh();
  assert.equal((await post({ text: LIST })).status, 200);
  assert.equal(fs.existsSync(traceDir(root, { stateDir })), false, 'an unanswered offer records nothing');
  const shaped = await post({ text: LIST, answers: [{ id: 'q-shape', option: 'list' }] });
  assert.equal(shaped.body.offers[0].chosen, 'list');
  await post({ text: LIST, answers: [{ id: 'q-shape', option: 'scaffold' }] });
  const [a, b] = traces().decisions;
  assert.equal(a.chooser.id, 'requirement.placement.shape');
  assert.deepEqual([a.chosen, a.by, a.options], ['list', 'person', ['list', 'scaffold']]);
  assert.equal(a.summary.id, 'q-shape');
  assert.equal(a.summary.chosen, null);
  assert.deepEqual(a.suggestion, { option: 'list', reason: 'first available step' });
  assert.deepEqual(a.outcome, { accepted: true, planValidated: true });
  assert.deepEqual([b.chosen, b.outcome.accepted, b.outcome.planValidated], ['scaffold', false, true]);
});

test('a placement question is recorded too (a server check with no server block), with the question AS OFFERED', async () => {
  fresh();
  await post({ text: 'A user can click a button safely.', answers: [{ id: 'q-server', option: 'mutation' }] });
  const [d] = traces().decisions;
  assert.equal(d.chooser.id, 'requirement.placement.server-check');
  assert.deepEqual([d.chosen, d.summary.id, d.summary.chosen], ['mutation', 'q-server', null]);
  assert.deepEqual(d.options, d.summary.options.map((o) => o.id));
});

test('a refused answer records nothing', async () => {
  fresh();
  assert.equal((await post({ text: FROB, answers: [{ id: 'o1', option: 'teleport' }] })).status, 400);
  assert.equal(fs.existsSync(traceDir(root, { stateDir })), false);
});

test('`traces: off` in the project stops it, and the response is the same', async () => {
  fresh('traces: off');
  const body = { text: FROB, answers: [{ id: 'o1', option: 'interact' }] };
  const r = await post(body);
  assert.equal(r.status, 200);
  assert.equal(fs.existsSync(traceDir(root, { stateDir })), false, 'no directory, no file');
  assert.deepEqual(bare(r.body), JSON.parse(JSON.stringify(readRequirement(body, root).body)), 'recording is not part of the response');
});

test('a recording that fails never changes the response: the state directory is a file', async () => {
  fresh();
  const notADir = path.join(makeTempDir('og643-api-bad-'), 'state');
  fs.writeFileSync(notADir, 'a file, not a directory');
  process.env.CONSTRUCT_STATE_DIR = notADir;
  const body = { text: FROB, answers: [{ id: 'o1', option: 'interact' }] };
  const r = await post(body);
  assert.equal(r.status, 200, 'the chain is not broken by a bad state directory');
  assert.deepEqual(bare(r.body), JSON.parse(JSON.stringify(readRequirement(body, root).body)));
  assert.equal(fs.readFileSync(notADir, 'utf8'), 'a file, not a directory');
});

test('the response is exactly what the deterministic blocks return: no field of the recording leaks into it', async () => {
  fresh();
  const body = { text: LIST, answers: [{ id: 'q-shape', option: 'list' }] };
  const r = await post(body);
  assert.deepEqual(bare(r.body), JSON.parse(JSON.stringify(readRequirement(body, root).body)));
  for (const key of ['trace', 'traces', 'choices', 'decisionTrace']) assert.equal(key in r.body, false);
});
