// Line Import v2, the read-only English view line.import.writeAtoms writes (packages/engine/line/importV2/englishView.mjs,
// ENGLISH-RULES.md build step 6, fluent plan T2.4): each atom call of the written function as its fluent sentence,
// innermost first; the app keeps the typed code. The fluent writer (T2.1a, packages/line-codemod/fluent-form.js) is
// reached through loadFluentForm; these tests use a stub writer, plus one on the real file when it is on this tree.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeTempDir } from '../test-utils/tmpdir.mjs';
import { ATOMS_FILE, ATOMS_WRITE_TOOL, assertAtomBreakdown, assertAtomUnitResult, assertEnglishView } from '../packages/engine/line/importV2/contract.mjs';
import { createMockStaticBreakdown, MOCK_ATOM_BREAKDOWN } from '../packages/engine/line/importV2/mock.mjs';
import { breakDownImport } from '../packages/engine/line/importV2/breakdown.mjs';
import { planWriteAtoms, markWritten, createAtomsTester } from '../packages/engine/line/importV2/writeAtoms.mjs';
import { englishViewOf, englishWriter, loadFluentForm, FLUENT_FORM_FILE } from '../packages/engine/line/importV2/englishView.mjs';
import { lineTools, REAL_PLAN_OPS } from '../packages/engine/line/planTools.mjs';

// The stub fluent writer: plus(x, y) -> adds(x).to(y); anything else (or a third argument) has no sentence.
function splitTop(s) {
  const out = [];
  let depth = 0;
  let at = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) depth--;
    else if (c === ',' && depth === 0) { out.push(s.slice(at, i).trim()); at = i + 1; }
  }
  out.push(s.slice(at).trim());
  return out;
}
const STUB_FORM = {
  ok: /** @type {const} */ (true),
  explainFluent(call, catalog) {
    assert.equal(catalog, STUB_CATALOG);
    const m = /^(\w+)\((.*)\)$/s.exec(call);
    if (!m || m[1] !== 'plus') return { sentence: null, reason: `${m?.[1] ?? 'it'} has no sentence in the stub` };
    const a = splitTop(m[2]);
    if (a.length !== 2) return { sentence: null, reason: 'plus takes two arguments' };
    return { sentence: `adds(${a[0]}).to(${a[1]})` };
  },
};
const STUB_CATALOG = { atoms: [{ atom: 'plus', fluent: 'adds(a).to(b)' }] };
const stubWriter = () => englishWriter(STUB_CATALOG, STUB_FORM);

// ------------------------------------------------------------------------------------------------- the view

test('englishViewOf: each atom call becomes its sentence, innermost first; the rest of the typed code stays', () => {
  const v = englishViewOf({ name: 'sum3', atoms: ['plus'], body: 'function sum3(a: number, b: number, c: number): number {\n  return plus(plus(a, b), c);\n}' }, stubWriter());
  assert.equal(v.via, 'fluent');
  assert.equal(v.code, 'function sum3(a: number, b: number, c: number): number {\n  return adds(adds(a).to(b)).to(c);\n}');
  assert.deepEqual(v.sentences, [{ atom: 'plus', sentence: 'adds(a).to(b)' }, { atom: 'plus', sentence: 'adds(adds(a).to(b)).to(c)' }]);
  assert.equal(v.full, true);
  assert.equal(v.plain, 0);
  assert.equal(v.sentence, 'sum3 reads as 2 sentences in its English view.');
  assertEnglishView(v);
});

test('englishViewOf: a call the sentence cannot take stays as code with its reason; a local function of the same shape is not an atom', () => {
  const v = englishViewOf({ name: 'f', atoms: ['plus', 'join'], body: 'function f(a, b, c) {\n  return join(plus(a, b), other(c), plus(a, b, c));\n}' }, stubWriter());
  assert.equal(v.code, 'function f(a, b, c) {\n  return join(adds(a).to(b), other(c), plus(a, b, c));\n}');
  assert.deepEqual(v.sentences, [{ atom: 'plus', sentence: 'adds(a).to(b)' }]);
  assert.deepEqual(v.reasons, [{ atom: 'plus', reason: 'plus takes two arguments' }, { atom: 'join', reason: 'join has no sentence in the stub' }]);
  assert.equal(v.plain, 2);
  assert.equal(v.full, false);
  assert.equal(v.sentence, 'f reads as 1 sentence in its English view; 2 atom calls stay as code (plus: plus takes two arguments).');
});

test('englishViewOf: no writer, or a writer that is down, gives an off view with one sentence (the write carries on)', () => {
  const none = englishViewOf({ name: 'total', atoms: ['plus'], body: 'function total(a, b) { return plus(a, b); }' }, undefined);
  assert.deepEqual(none, { via: 'off', code: '', sentences: [], plain: 0, reasons: [], full: false, reason: 'the English writer is not set up for this run', sentence: 'total has no English view: the English writer is not set up for this run.' });
  const down = englishViewOf({ name: 'total', atoms: ['plus'], body: 'x' }, englishWriter(STUB_CATALOG, { ok: false, reason: 'the fluent writer is not here' }));
  assert.equal(down.sentence, 'total has no English view: the fluent writer is not here.');
  assert.equal(englishWriter(undefined, STUB_FORM).ok, false);
  assert.throws(() => assertEnglishView({ ...down, code: 'x' }), /be empty when off/);
  assert.throws(() => assertEnglishView({ ...englishViewOf({ name: 't', atoms: ['plus'], body: 'plus(a, b)' }, stubWriter()), full: false }), /full must be true exactly when/);
});

test('loadFluentForm: a missing file is a reason, not a throw; a file with explainFluent is loaded through require', () => {
  const dir = makeTempDir('construct-line-english-view-');
  assert.deepEqual(loadFluentForm(path.join(dir, 'nope.js')), { ok: false, reason: 'the fluent writer (line-codemod fluent-form.js) is not on this tree' });
  const file = path.join(dir, 'fluent-form.js');
  fs.writeFileSync(file, "module.exports = { explainFluent: (call) => ({ sentence: call === 'plus(a, b)' ? 'adds(a).to(b)' : null, reason: 'no' }) };\n");
  const form = loadFluentForm(file);
  assert.equal(form.ok, true);
  const w = englishWriter({ atoms: [] }, form);
  assert.deepEqual(w.ok && w.explain('plus(a, b)'), { sentence: 'adds(a).to(b)' });
  assert.deepEqual(w.ok && w.explain('minus(a, b)'), { sentence: null, reason: 'no' });
  fs.writeFileSync(path.join(dir, 'bad.js'), 'module.exports = {};\n');
  assert.deepEqual(loadFluentForm(path.join(dir, 'bad.js')), { ok: false, reason: 'the fluent writer has no explainFluent' });
});

test('the real fluent writer (T2.1a), when it is on this tree, gives a view that passes the contract', { skip: fs.existsSync(FLUENT_FORM_FILE) ? false : 'packages/line-codemod/fluent-form.js (T2.1a) is not on this tree yet' }, () => {
  const catalog = { atoms: [{ atom: 'plus', fluent: 'adds(a).to(b)', check: [{ params: [['a'], ['b']] }] }] };
  const v = englishViewOf({ name: 'total', atoms: ['plus'], body: 'function total(a: number, b: number) {\n  return plus(a, b);\n}' }, englishWriter(catalog));
  assert.equal(v.via, 'fluent');
  assert.equal(v.sentences.length + v.plain, 1);
  assertEnglishView(v);
});

// ------------------------------------------------------------------------------------------------- the write

const FOLDER = 'src/calc';
const FILE = `${FOLDER}/rules.ts`;
const RULES = 'export function total(a: number, b: number): number {\n  return a + b;\n}\n';
const FIT = { proposal: { feature: 'calc', blocks: [{ kind: 'domain', name: 'rules', units: [], from: [`${FILE}#total`], sentence: 'rules is a domain.', area: 'feature' }], unassigned: [] }, steps: [] };

async function fixture() {
  const dir = makeTempDir('construct-line-english-write-');
  fs.mkdirSync(path.join(dir, FOLDER), { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"calc-app","type":"module","private":true}\n');
  fs.writeFileSync(path.join(dir, FILE), RULES);
  const r = await breakDownImport(dir, FIT, { create: createMockStaticBreakdown });
  fs.mkdirSync(path.join(dir, FOLDER, 'line'), { recursive: true });
  fs.writeFileSync(path.join(dir, FOLDER, ATOMS_FILE), `${JSON.stringify(r.breakdown)}\n`);
  return { dir, folderRoot: path.join(dir, FOLDER) };
}
const args = { folder: FOLDER, file: FILE, name: 'total' };
const testerWith = async (english) => ({ ...(await createAtomsTester({ create: () => createMockStaticBreakdown() })), ...(english ? { english } : {}) });
const unitOf = (folderRoot) => JSON.parse(fs.readFileSync(path.join(folderRoot, ATOMS_FILE), 'utf8')).units.find((u) => u.name === 'total');

test('plan: the change carries the English view next to the typed code, and its summary says how it reads', async () => {
  const { folderRoot } = await fixture();
  const change = planWriteAtoms(folderRoot, args, await testerWith(stubWriter()));
  const written = change.files.find((f) => f.path === 'rules.ts').content;
  assert.match(written, /return plus\(a, b\);/, 'the app keeps its typed code');
  assert.equal(change.english.code, 'function total(a: number, b: number): number {\n  return adds(a).to(b);\n}');
  assert.equal(change.english.full, true);
  assert.match(change.summary, /\. total reads as 1 sentence in its English view\.$/);
  assert.ok(!change.files.some((f) => /english/i.test(f.path)), 'the view is not an app file');
});

test('plan: without an English writer (a preview, or the real tester before T2.1a) the view is off and the write is planned as before', async () => {
  const { folderRoot } = await fixture();
  const preview = planWriteAtoms(folderRoot, args);
  assert.equal(preview.english.via, 'off');
  const noForm = planWriteAtoms(folderRoot, args, await testerWith(englishWriter(STUB_CATALOG, { ok: false, reason: 'the fluent writer (line-codemod fluent-form.js) is not on this tree' })));
  assert.equal(noForm.english.sentence, 'total has no English view: the fluent writer (line-codemod fluent-form.js) is not on this tree.');
  assert.match(noForm.files.find((f) => f.path === 'rules.ts').content, /return plus\(a, b\);/);
});

test('markWritten records the English view with written; the contract refuses a view on a unit that was not written', async () => {
  const { folderRoot } = await fixture();
  assert.equal(markWritten(folderRoot, args, 'total as written behaves as the original on 25 generated inputs (mock).', await testerWith(stubWriter())), true);
  const b = JSON.parse(fs.readFileSync(path.join(folderRoot, ATOMS_FILE), 'utf8'));
  assertAtomBreakdown(b);
  const u = b.units.find((x) => x.name === 'total');
  assert.equal(u.english.code, 'function total(a: number, b: number): number {\n  return adds(a).to(b);\n}');
  assert.throws(() => assertAtomUnitResult({ ...MOCK_ATOM_BREAKDOWN.units[0], english: u.english }), /english must be set only on a written unit/);
});

test('step: through the plan tools the written unit gets its English view once the behaviour test passes', async () => {
  const { dir, folderRoot } = await fixture();
  const tools = lineTools({ root: dir, ops: /** @type {any} */ ({ ...REAL_PLAN_OPS, atomsTester: await testerWith(stubWriter()) }) });
  const r = await tools.find((t) => t.name === ATOMS_WRITE_TOOL).run(args);
  assert.ok(!r.needsYou, JSON.stringify(r.checks));
  const u = unitOf(folderRoot);
  assert.ok(u.written);
  assert.deepEqual(u.english.sentences, [{ atom: 'plus', sentence: 'adds(a).to(b)' }]);
  assert.match(fs.readFileSync(path.join(dir, FILE), 'utf8'), /return plus\(a, b\);/, 'the file keeps the typed atom calls');
});
