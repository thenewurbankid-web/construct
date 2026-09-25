// #633 -- the Requirement route hands the project's decision provider's suggestion to the screen: `suggestions` per open question and
// offer (option, reason, provider name and version), computed with the provider architecture.yml names (rules by default, `off`, a
// plugin), and records what a person answered WITH that suggestion and `accepted: true|false`. Suggest-only: nothing is chosen for
// the person. A plugin that fails is replaced by rules and the line is in `decisionProvider.notes`. Ports: 49580-49589 are this file's.
import '../../../test-utils/workspaceRoot.mjs';
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { createRequirementRouter } from './requirementApi.mjs';
import { readTraces } from '../../../packages/core/decision-trace-store.mjs';
import { clearDecisionCache } from '../../../packages/core/decision-project.mjs';
import { makeTempDir } from '../../../test-utils/tmpdir.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const ORIGIN = 'http://localhost:3000';
const FROB = 'A customer wants to frobnicate the invoice list.';
const LIST = 'A user wants to see a list of products';
const PORT = 49580;

let server;
let router = null;
let root;
let stateDir;
let lines;
const saved = process.env.CONSTRUCT_STATE_DIR;

before(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/requirement', (req, res, next) => router(req, res, next));
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(PORT, '127.0.0.1', resolve));
});
after(() => {
  server.close();
  server.closeAllConnections?.();
  if (saved === undefined) delete process.env.CONSTRUCT_STATE_DIR;
  else process.env.CONSTRUCT_STATE_DIR = saved;
});

/** A fresh project (with the decision block and plugin files given), a fresh state directory and a route with the given plugin switch. */
function fresh({ decision, plugins = {}, allowPlugins = true, yml = '' } = {}) {
  root = makeTempDir('og633-api-root-');
  fs.cpSync(path.join(REPO, 'fixtures', 'impact-shared'), root, { recursive: true });
  const block = decision ? `\ndecision:\n${Object.entries(decision).map(([k, v]) => `  ${k}: ${JSON.stringify(v)}`).join('\n')}\n` : '';
  fs.appendFileSync(path.join(root, 'architecture.yml'), `${block}${yml}\n`);
  for (const [rel, body] of Object.entries(plugins)) fs.writeFileSync(path.join(root, rel), body);
  stateDir = makeTempDir('og633-api-state-');
  process.env.CONSTRUCT_STATE_DIR = stateDir;
  lines = [];
  clearDecisionCache();
  delete globalThis.__api633;
  router = createRequirementRouter({ getRoot: () => ({ ok: true, root }), clientOrigin: ORIGIN, allowPlugins, decisionLog: (l) => lines.push(l) });
}
const post = async (body) => {
  const res = await fetch(`http://127.0.0.1:${PORT}/api/requirement/read`, { method: 'POST', headers: { origin: ORIGIN, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
};
const traces = () => readTraces(root, { stateDir }).decisions;
const jev = (body, version = '0.3') => `globalThis.__api633 = (globalThis.__api633 ?? 0) + 1;\nexport default { name: 'jev', version: '${version}', suggest(summary) { ${body} } };\n`;
const PICK_WRITE = jev("globalThis.__api633 += 1; return { option: summary.options.find((o) => o.id === 'write')?.id ?? summary.options[1].id, reason: 'It changes stored data.', score: 0.7 };");

test('the default provider is rules: suggestions by question id with the provider name and version, and nothing is chosen for the person', async () => {
  fresh();
  const r = await post({ text: FROB });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.suggestions, { o1: { option: 'read', reason: 'first available step', runnerUp: 'write', provider: { name: 'rules', version: '1' } } });
  assert.deepEqual(r.body.decisionProvider, { name: 'rules', version: '1', requested: 'rules', fellBackFrom: null, notes: [] });
  assert.equal(r.body.open.length, 1, 'still an open question: the suggestion answered nothing');
  assert.equal(r.body.open[0].chosen, null);
  assert.equal(r.body.plan, null);
  assert.equal(r.body.card.answers ?? undefined, undefined);
  assert.equal(fs.existsSync(path.join(stateDir, 'traces')), false, 'no answer, no trace');
});

test('the shape offer carries the rules suggestion with its own reason (the data object is plural)', async () => {
  fresh();
  const r = await post({ text: LIST });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.suggestions['q-shape'], { option: 'list', reason: r.body.offers[0].suggestion.reason, runnerUp: 'scaffold', provider: { name: 'rules', version: '1' } });
  assert.match(r.body.suggestions['q-shape'].reason, /plural/);
  assert.equal(r.body.offers[0].chosen, null, 'suggested, not chosen');
});

test('accepting the suggestion is recorded as accepted: true, choosing another as accepted: false; both by the person', async () => {
  fresh();
  assert.equal((await post({ text: FROB, answers: [{ id: 'o1', option: 'read' }] })).status, 200);
  let [d] = traces();
  assert.deepEqual([d.by, d.chosen, d.suggestion.option, d.provider], ['person', 'read', 'read', { name: 'rules', version: '1' }]);
  assert.equal(d.outcome.accepted, true);
  fresh();
  assert.equal((await post({ text: FROB, answers: [{ id: 'o1', option: 'interact' }] })).status, 200);
  [d] = traces();
  assert.deepEqual([d.by, d.chosen, d.suggestion.option], ['person', 'interact', 'read']);
  assert.equal(d.outcome.accepted, false, 'overriding is recorded as overriding');
  // A shape answer, the same way (list is the suggestion).
  fresh();
  await post({ text: LIST, answers: [{ id: 'q-shape', option: 'scaffold' }] });
  const shape = traces().find((x) => x.chooser.id === 'requirement.placement.shape');
  assert.deepEqual([shape.chosen, shape.suggestion.option, shape.outcome.accepted], ['scaffold', 'list', false]);
});

test('`decision: { provider: off }` suggests nothing and records no suggestion, but still records the answer', async () => {
  fresh({ decision: { provider: 'off' } });
  const r = await post({ text: FROB, answers: [{ id: 'o1', option: 'write' }] });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.suggestions, {});
  assert.equal(r.body.decisionProvider.name, 'off');
  const [d] = traces();
  assert.deepEqual([d.chosen, d.by, 'suggestion' in d, 'provider' in d], ['write', 'person', false, false]);
  assert.equal(d.outcome.accepted, undefined);
  assert.equal((await post({ text: FROB })).body.suggestions.o1, undefined, 'and the unanswered question shows none');
});

test('a plugin named in architecture.yml suggests instead of rules, and its suggestion is what is recorded with accepted true or false', async () => {
  fresh({ decision: { provider: 'jev', plugin: 'jev.mjs' }, plugins: { 'jev.mjs': PICK_WRITE } });
  const r = await post({ text: FROB });
  assert.deepEqual(r.body.suggestions.o1, { option: 'write', reason: 'It changes stored data.', runnerUp: null, score: 0.7, provider: { name: 'jev', version: '0.3' } });
  assert.deepEqual([r.body.decisionProvider.name, r.body.decisionProvider.version, r.body.decisionProvider.fellBackFrom], ['jev', '0.3', null]);
  assert.match(r.body.decisionProvider.notes[0], /loaded provider "jev" version 0\.3/);
  assert.equal(r.body.open[0].chosen, null, 'still the person\'s to answer');
  await post({ text: FROB, answers: [{ id: 'o1', option: 'write' }] });
  let [d] = traces();
  assert.deepEqual([d.chosen, d.by, d.provider, d.suggestion, d.outcome.accepted], ['write', 'person', { name: 'jev', version: '0.3' }, { option: 'write', reason: 'It changes stored data.', score: 0.7 }, true]);
  await post({ text: FROB, answers: [{ id: 'o1', option: 'read' }] });
  d = traces().find((x) => x.chosen === 'read');
  assert.deepEqual([d.provider.name, d.suggestion.option, d.outcome.accepted], ['jev', 'write', false]);
  assert.equal(globalThis.__api633, 2, 'the plugin file was imported once, and asked once for this question (answers are cached)');
});

test('where plugins are not enabled the plugin file is never imported: rules answer, and the response says so', async () => {
  fresh({ decision: { provider: 'jev', plugin: 'jev.mjs' }, plugins: { 'jev.mjs': PICK_WRITE }, allowPlugins: false });
  const r = await post({ text: FROB });
  assert.equal(globalThis.__api633, undefined);
  assert.deepEqual([r.body.suggestions.o1.provider.name, r.body.suggestions.o1.fellBackFrom, r.body.decisionProvider.fellBackFrom], ['rules', 'jev', 'jev']);
  assert.match(r.body.decisionProvider.notes[0], /CONSTRUCT_DECISION_PLUGINS=on/);
  assert.deepEqual(lines, r.body.decisionProvider.notes, 'the same line was logged');
});

test('a plugin that throws, is slow, or answers an option that is not on the list falls back to rules; the response and the recording still work', async () => {
  const cases = {
    throws: "throw new Error('model down');",
    slow: 'return new Promise((resolve) => setTimeout(resolve, 3000, { option: "write", reason: "late" }).unref());',
    'not-on-the-list': "return { option: 'teleport', reason: 'made up' };",
    junk: "return ['write'];",
  };
  for (const [name, body] of Object.entries(cases)) {
    fresh({ decision: { provider: 'jev', plugin: 'jev.mjs', timeoutMs: 200 }, plugins: { 'jev.mjs': jev(body) } });
    const r = await post({ text: FROB, answers: [{ id: 'o1', option: 'read' }] });
    assert.equal(r.status, 200, name);
    assert.deepEqual(r.body.suggestions, {}, `${name}: nothing open after the answer`);
    assert.equal(r.body.decisionProvider.fellBackFrom, 'jev', name);
    assert.match(r.body.decisionProvider.notes.join('\n'), /the rules provider answered instead/, name);
    const [d] = traces();
    assert.deepEqual([d.provider, d.suggestion.option, d.outcome.accepted], [{ name: 'rules', version: '1' }, 'read', true], `${name}: recorded as the rules provider's suggestion`);
    const open = await post({ text: FROB });
    assert.deepEqual([open.body.suggestions.o1.provider.name, open.body.suggestions.o1.fellBackFrom], ['rules', 'jev'], name);
  }
});

test('a plugin outside the project is refused with a line; the read still answers with rules', async () => {
  fresh({ decision: { provider: 'jev', plugin: '../evil.mjs' } });
  const r = await post({ text: FROB });
  assert.equal(r.status, 200);
  assert.equal(r.body.suggestions.o1.provider.name, 'rules');
  assert.match(r.body.decisionProvider.notes[0], /PLUGIN_OUTSIDE_PROJECT/);
  assert.equal(JSON.stringify(r.body.decisionProvider).includes(root), false, 'no server path in the response');
});

test('`traces: off` asks no provider for a recording and writes nothing, while the screen still gets its suggestions', async () => {
  fresh({ decision: { provider: 'jev', plugin: 'jev.mjs' }, plugins: { 'jev.mjs': PICK_WRITE }, yml: 'traces: off' });
  const r = await post({ text: FROB, answers: [{ id: 'o1', option: 'read' }] });
  assert.equal(r.status, 200);
  assert.equal(fs.existsSync(path.join(stateDir, 'traces')), false);
  assert.equal(globalThis.__api633, 1, 'imported for the read, but never asked to record a decision that is not written');
});
