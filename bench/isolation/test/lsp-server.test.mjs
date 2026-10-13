// #943 -- the Line LSP server: Smith layer, atomicGate and the dynamic index (a new function shows up in all three
// layers after update(), with no full rebuild). Needs the Smith clones (ATOMIC_CODEMOD_SOURCE_DIR, SMITH_SOURCE_DIR);
// the Smith-dependent tests skip when atomic-codemod is not linked.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { CASES, materialize } from '../chain/quick/k3.mjs';
import { createLineLsp } from '../../../packages/engine/lsp/server.mjs';
import * as S from '../../../packages/engine/lsp/smith.mjs';
import { atomicGate, isTemplate, PLACEHOLDER_EMPTY_RATIO } from '../../../packages/engine/lsp/gate.mjs';
import { ts } from '../../../packages/engine/lsp/host.mjs';

const ready = S.smithReady();
const REPO_NM = path.resolve(import.meta.dirname, '../../../node_modules');

test('dynamic index: a function added on disk appears in the TS, Smith and rules layers after update(), without a rebuild', { skip: !ready && 'atomic-codemod not linked' }, async () => {
  const root = materialize(CASES[6]); // browse/domains/sortByTitle exists, pageOf does not
  try {
    const lsp = await createLineLsp(root, { extraRoots: [REPO_NM] });
    const before = lsp.size.functions;
    assert.equal(lsp.nextSteps({ need: 'browse/domains/pageOf', from: 'browse' }).options[0].step, 'create');
    assert.equal(lsp.smithReferences('browse/domains/pageOf').ok, false);
    const rel = 'features/browse/domains/pageOf.ts';
    fs.writeFileSync(path.join(root, rel), 'export function pageOf(items: string[], page: number): string[] {\n  return items.slice((page - 1) * 3, page * 3);\n}\n');
    const u = await lsp.update([rel, 'features/browse/domains/sortByTitle.ts']);
    assert.deepEqual(u.touched, [rel], 'the unchanged file is not re-indexed');
    assert.equal(lsp.stats.builds, 1);
    assert.equal(lsp.size.functions, before + 1);
    const sym = lsp.symbol('browse/domains/pageOf');
    assert.equal(sym.file, rel);
    assert.equal(sym.ts, 'function pageOf(items: string[], page: number): string[]');            // TS layer
    assert.match(sym.smith[0], /^It returns items slice/);                                        // Smith layer
    assert.deepEqual(sym.rules, []);                                                              // rules layer: indexed, clean
    assert.equal(lsp.nextSteps({ need: 'browse/domains/pageOf', from: 'browse' }).options[0].step, 'reuse');
    assert.deepEqual(lsp.smithDefinition(sym.smith[0]).ids.map((x) => x.id), ['browse/domains/pageOf']);
    assert.ok(u.ms < 2000, `incremental update took ${u.ms} ms`);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('smithDiagnostics: exact template match first, then gaps both ways', { skip: !ready && 'atomic-codemod not linked' }, async () => {
  const idx = await S.smithIndexFile('features/book/domains/formatPages.ts', 'export function formatPages(pages: number): string {\n  return pages + \' pages\';\n}\n');
  const id = 'book/domains/formatPages';
  const got = S.smithReferences(id, idx).sentences;
  assert.equal(got.length, 1);
  const d = await S.smithDiagnostics({ [id]: [got[0], 'It returns nothing'] }, idx);
  assert.equal(d.exact, 1);
  assert.deepEqual(d.missing.map((m) => m.sentence), ['it returns nothing']);
  const e = await S.smithDiagnostics({ [id]: [] }, idx);
  assert.equal(e.extra.length, 1);
  // the embedding fallback is the caller's: a fake embed that calls every pair identical makes the gap a fuzzy match
  const f = await S.smithDiagnostics({ [id]: ['It returns the pages'] }, idx, { embed: async (xs) => xs.map(() => [1, 0]) });
  assert.equal(f.fuzzy.length, 1);
  assert.equal(f.missing.length, 0);
});

test('smithCompletions: templates filled from scope names plus Line atoms ranked by the intent, as an enum', () => {
  const c = S.smithCompletions({ kind: 'function', names: ['book', 'pages'], intent: 'split the list into pages' });
  assert.equal(c.items[0].text, 'return book');
  assert.ok(c.items.some((i) => i.text === "return book's pages"));
  const firstAtom = c.items.find((i) => i.kind === 'atom');
  assert.equal(firstAtom.id, 'client-pagination');
  assert.deepEqual(c.schema.properties.sentence.enum, c.items.map((i) => i.text));
  assert.ok(c.items.length <= 30);
});

test('atomicGate: shape checks and the Smith round trip, one line each; dumb JSX is exempt', { skip: !ready && 'atomic-codemod not linked' }, async () => {
  assert.equal(PLACEHOLDER_EMPTY_RATIO, 0.5);
  const ok = await atomicGate({ rel: 'features/book/domains/formatPages.ts', source: 'export function formatPages(pages: number): string {\n  return pages + \' pages\';\n}\n', fn: 'formatPages' });
  assert.equal(ok.pass, true, JSON.stringify(ok.checks));
  const bad = await atomicGate({ rel: 'features/book/domains/formatPages.ts', source: "import rows from '../fixtures/rows.json';\nexport function formatPages(pages: number, unused: string): string {\n  localStorage.setItem('rows', String(rows));\n  return pages + ' pages';\n}\n", fn: 'formatPages' });
  assert.equal(bad.pass, false);
  assert.deepEqual(bad.failed.sort(), ['connections', 'purity', 'stub']);
  assert.ok(bad.checks.every((c) => !c.line.includes('\n')));
  const sf = ts.createSourceFile('x.tsx', 'export function Row({ book }: P) {\n  return <li>{book.title} <button onClick={() => remove(book.id)}>x</button></li>;\n}\n', ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  assert.equal(isTemplate(sf.statements[0]), true);
  const tpl = await atomicGate({ rel: 'features/book/components/Row.tsx', source: sf.text, fn: 'Row', smith: async () => { throw new Error('templates are not sent to Smith'); } });
  assert.equal(tpl.exempt, true);
});
