import test from 'node:test';
import assert from 'node:assert/strict';
import { createMockLineOps } from '../../../../../packages/engine/line/mock.mjs';
import { pageParts, withFragments } from '../domain/PageParts.ts';
import { treeFromSource } from '../domain/SourceTree.ts';
import { saveCodeFragment } from './SaveFragmentFlow.ts';

const FILE = 'features/orders/pages/OrdersPage.tsx';
const frag = { id: 'handler:n0:onMore', file: FILE, kind: 'handler', label: 'What happens when ListPage asks for more', code: '() => 1', range: { start: 10, end: 17 }, contentHash: 'h1', nodeId: 'n0' };
const fakeApi = (answer) => {
  const sent = [];
  return { sent, setFragment: async (req) => { sent.push(req); if (answer instanceof Error) throw answer; return answer; } };
};

test('saveCodeFragment: sends only the fragment id, its new code and the hash it was read with', async () => {
  const api = fakeApi({ ok: true, sentence: 'Saved. Changes the code.', files: [FILE], findings: [] });
  const out = await saveCodeFragment(api, frag, '() => 2');
  assert.deepEqual(api.sent, [{ file: FILE, fragmentId: frag.id, code: '() => 2', contentHash: 'h1' }]);
  assert.deepEqual(out, { ok: true, sentence: 'Saved. Changes the code.', findings: [] });
});

test('saveCodeFragment: a refusal keeps its sentence and carries the parser message as detail; empty code is never sent', async () => {
  const api = fakeApi({ ok: false, sentence: 'This code is not a single valid expression, so nothing was saved.', code: 'BAD_CODE', detail: "')' expected." });
  assert.deepEqual(await saveCodeFragment(api, frag, '() => {'), { ok: false, sentence: 'This code is not a single valid expression, so nothing was saved.', findings: [], detail: "')' expected." });
  const quiet = fakeApi({ ok: true, sentence: 'Saved.', files: [], findings: [] });
  assert.match((await saveCodeFragment(quiet, frag, '  ')).sentence, /^Nothing was saved: the code is empty/);
  assert.equal(quiet.sent.length, 0);
  assert.match((await saveCodeFragment(fakeApi(new TypeError('Failed to fetch')), frag, '1')).sentence, /^Nothing was saved: the server did not answer/);
});

test('withFragments: the mock page part gets its handler, and the mock saves it through applyChange', () => {
  const ops = createMockLineOps();
  const tree = treeFromSource(ops.files()[FILE], FILE, 'orders');
  const list = ops.listFragments('/mock', FILE);
  const parts = withFragments(pageParts(tree), list.fragments);
  assert.deepEqual(parts.map((p) => [p.tag, (p.fragments ?? []).map((f) => f.label)]), [['ListPage', ['What happens when ListPage asks for more']]]);
  const r = ops.applyChange('/mock', ops.planSetFragment('/mock', { file: FILE, fragmentId: list.fragments[0].id, code: "() => alert('All')", contentHash: list.contentHash }));
  assert.equal(r.ok, true);
  assert.match(ops.files()[FILE], /onMore=\{\(\) => alert\('All'\)\}/);
});
