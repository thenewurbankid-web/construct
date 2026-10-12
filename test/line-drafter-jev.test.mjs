// #892: jev intent detection in shadow beside the drafter's static classify(): the jev classifier's fallback (jev down ->
// null, static used), its classify()-shaped output, the shadow log's shape and switches, and the fork records.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { draft } from '../packages/engine/line/drafter/index.mjs';
import { buildIntentCatalog } from '../packages/engine/line/drafter/contract.mjs';
import { LINE_PLAN_TOOLS } from '../packages/engine/line/contract.mjs';
import { classifyJev, jevQuestions, closedLabels, forksOf, jevPick, INTENT_STEP } from '../packages/engine/line/drafter/classifyJev.mjs';
import { runIntentShadow, intentSwitch, readShadow, pickLabels, SHADOW_FILE } from '../packages/engine/line/drafter/shadow.mjs';
import { stepProfile, stepOn } from '../packages/core/ai-profiles.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SAMPLE = path.join(REPO, 'examples/line-sample');
const CATALOG = buildIntentCatalog(LINE_PLAN_TOOLS.map((t) => t.name));

/** A copy of the sample project (the shadow writes into its Line state). */
function sampleCopy() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'line-jev-'));
  fs.cpSync(SAMPLE, dir, { recursive: true });
  return dir;
}

/** A fake jev: answers by the question's wording, fixed confidence. @param {Record<string, string>} picks @param {number} [conf] */
const fakeJev = (picks, conf = 0.9) => async ({ structured }) => {
  const key = Object.keys(picks).find((k) => structured.question.includes(k));
  const want = key ? picks[key] : structured.options[0];
  const i = Math.max(0, structured.options.findIndex((o) => o === want || o.startsWith(`${want} `)));
  return { text: JSON.stringify({ choice: i + 1, fact: 1 }), confidence: conf };
};
const UPDATE_PROP = { 'Which change': 'update', 'What kind': 'prop', 'Which named': 'P1', 'ui layer': 'yes', 'workflow layer': 'no', 'data layer': 'no', 'api layer': 'no', 'library layer': 'no' };

function readOf(request) {
  const d = draft(SAMPLE, request, { verify: false, shadow: false });
  return { d, n: { text: d.request, tokens: d.tokens } };
}

test('classifyJev never throws: jev unreachable or broken -> null, and draft keeps the static labels', async () => {
  const { d, n } = readOf('set the title of the invoices page to "Alpha"');
  assert.equal(await classifyJev(n, d.slots, CATALOG, { baseUrl: 'http://127.0.0.1:9', timeoutMs: 2000 }), null);
  assert.equal(await classifyJev(n, d.slots, CATALOG, { choose: async () => { throw new Error('down'); } }), null);
  assert.equal(await classifyJev(n, d.slots, CATALOG, { choose: async () => ({ text: 'not json' }) }), null);
  assert.equal(await classifyJev(n, d.slots, CATALOG, { choose: () => new Promise(() => {}), timeoutMs: 50 }), null, 'a hung jev times out');
  assert.equal(await jevPick({ question: 'q', options: ['a', 'b'], facts: [] }, { choose: async () => { throw new Error('down'); } }), null);
  assert.equal(d.labels.via, 'rules');
  assert.equal(d.labels.intent.id, 'update.prop');
});

test("classifyJev returns classify()'s shape plus a confidence per label", async () => {
  const { d, n } = readOf('set the title of the invoices page to "Alpha"');
  const j = await classifyJev(n, d.slots, CATALOG, { choose: fakeJev(UPDATE_PROP, 0.8) });
  assert.ok(j);
  assert.deepEqual(Object.keys(d.labels).sort(), Object.keys(j).filter((k) => k !== 'confidences').sort());
  assert.deepEqual(j.intent, { id: 'update.prop', confidence: 0.8 });
  assert.equal(j.inCatalog, true);
  assert.equal(j.via, 'jev');
  assert.match(String(j.target), /^P\d$/);
  assert.deepEqual(j.layers, [{ layer: 'ui', confidence: 0.8 }]);
  assert.deepEqual(Object.keys(j.confidences.layers).sort(), ['api', 'data', 'library', 'ui', 'workflow']);
  const q = jevQuestions(n, d.slots);
  assert.deepEqual(q.questions.map((x) => x.key), ['verb', 'object', 'slot', 'layer:ui', 'layer:workflow', 'layer:data', 'layer:api', 'layer:library']);
  assert.equal(q.questions.find((x) => x.key === 'slot').options.at(-1), 'none');
});

test('fork records: disagreement and low confidence mark a label, with both values kept', () => {
  const st = { intent: 'update.prop', object: 'prop', slot: 'page:P1', layers: ['ui'] };
  const jv = { intent: 'update.handler', object: 'handler', slot: 'page:P1', layers: ['ui'] };
  const conf = { intent: 0.9, object: 0.9, slot: 0.2, layers: { ui: 0.9, workflow: 0.9, data: 0.9, api: 0.9, library: 0.9 } };
  assert.deepEqual(forksOf(st, jv, conf, 0.5), [
    { label: 'intent', static: 'update.prop', jev: 'update.handler', confidence: 0.9, reason: 'disagree' },
    { label: 'object', static: 'prop', jev: 'handler', confidence: 0.9, reason: 'disagree' },
    { label: 'slot', static: 'page:P1', jev: 'page:P1', confidence: 0.2, reason: 'low-confidence' },
  ]);
  assert.deepEqual(forksOf(st, null, null), [], 'no jev answer, no fork');
});

test('the construct.intent step ships off, and the shadow switch is off by default (nothing asked, nothing written)', async () => {
  const p = stepProfile(INTENT_STEP);
  assert.equal(stepOn(p), false);
  assert.equal(p.ladder.measured, null);
  const dir = sampleCopy();
  const prev = process.env.LINE_JEV_SHADOW; delete process.env.LINE_JEV_SHADOW;
  try {
    assert.deepEqual(intentSwitch(dir), { shadow: false, on: false, gate: 0.5 });
    let asked = 0;
    draft(dir, 'set the title of the invoices page to "Alpha"', { verify: false, shadow: { choose: async () => { asked += 1; return { text: '{}' }; } } });
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(asked, 0);
    assert.equal(fs.existsSync(path.join(dir, 'line', SHADOW_FILE)), false);
    // A project can turn the shadow on; turning the step on does nothing without a measured win.
    fs.mkdirSync(path.join(dir, 'line'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'line', 'ai-profiles.json'), JSON.stringify({ v: 1, steps: { [INTENT_STEP]: { on: true, shadow: true, gate: 0.6 } } }));
    assert.deepEqual(intentSwitch(dir), { shadow: true, on: false, gate: 0.6 });
    assert.equal(pickLabels({ via: 'rules' }, { via: 'jev', confidences: { intent: 1, slot: 1, layers: { ui: 1 } } }, intentSwitch(dir)).used, false);
  } finally { if (prev !== undefined) process.env.LINE_JEV_SHADOW = prev; fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the shadow log: one slot-form record per request with static, jev, confidences and forks; static still decides', async () => {
  const dir = sampleCopy();
  try {
    const d = draft(dir, 'set the title of the invoices page to "Alpha"', { verify: false, shadow: false });
    const ctx = { normalized: { text: d.request, tokens: d.tokens }, slots: d.slots, catalog: CATALOG, labels: d.labels };
    const rec = await runIntentShadow(dir, ctx, { force: true, choose: fakeJev({ ...UPDATE_PROP, 'What kind': 'handler' }, 0.7) });
    assert.ok(rec);
    const [logged] = readShadow(dir);
    assert.deepEqual(logged, rec);
    assert.deepEqual(Object.keys(rec).sort(), ['at', 'decision', 'forks', 'gate', 'jev', 'request', 'static', 'used', 'v']);
    assert.equal(rec.decision, 'intent');
    assert.equal(rec.used, false);
    assert.doesNotMatch(JSON.stringify(rec), /InvoicesPage|Alpha/, 'slot form: no project names or values');
    assert.deepEqual(rec.static, { ...closedLabels(d.labels, d.slots), via: 'rules' });
    assert.equal(rec.jev.intent, 'update.handler');
    assert.deepEqual(rec.forks.map((f) => [f.label, f.static, f.jev, f.reason]), [['intent', 'update.prop', 'update.handler', 'disagree'], ['object', 'prop', 'handler', 'disagree']]);
    // jev down: the record says so (jev null, no forks); the labels the drafter used are unchanged.
    const down = await runIntentShadow(dir, ctx, { force: true, choose: async () => { throw new Error('down'); } });
    assert.equal(down.jev, null);
    assert.deepEqual(down.forks, []);
    assert.equal(readShadow(dir).length, 2);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
