// #940 Smith System 1 data generator: determinism, no eval leak, dedupe, schema. Smith itself is replaced by a fake
// summarizer here (the real one is a linked repo that may be absent), except in the one test that skips without it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { assertPair, buildDataset, leakKeys, leaks, makePair, normalizeCode, splitOf, toJsonl } from '../lib.mjs';
import { functionsOf, ledgerEval, smithEmptyReason, smithPairs, toJs } from '../sources.mjs';
import { generate } from '../generate.mjs';

/** A stand-in for summarizeCode: deterministic, always meaningful English. */
const fakeSmith = async (code) => ({ via: 'smith', sentences: [`Function ${/function\s+(\w+)|^(\w+)\s*\(/.exec(code)?.slice(1).find(Boolean) ?? 'anonymous'} works in some steps.`, `It computes values from ${code.length} characters of code.`] });
const ROOTS = ['bench/lending/starter', 'packages/line-atoms/atoms'];
const dump = (ds) => ['train', 'val', 'test', 'eval'].map((k) => toJsonl(ds[k])).join('---\n') + JSON.stringify(ds.stats);

test('determinism: the same repo gives byte-identical output, and input order does not matter', async () => {
  const a = await generate({ summarizeCode: fakeSmith, roots: ROOTS });
  const b = await generate({ summarizeCode: fakeSmith, roots: ROOTS });
  assert.equal(dump(a), dump(b));
  assert.ok(a.stats.total > 20, `expected a real dataset, got ${a.stats.total}`);
  const all = [...a.train, ...a.val, ...a.test].map(({ meta: { split, ...meta }, ...p }) => ({ ...p, meta }));
  const ev = a.eval.map(({ meta: { split, ...meta }, ...p }) => ({ ...p, meta }));
  const fwd = buildDataset(all, ev);
  const rev = buildDataset([...all].reverse(), [...ev].reverse());
  assert.equal(dump(fwd), dump(rev));
  assert.equal(splitOf('const a = 1;'), splitOf('const a = 1; // same code'));
});

test('eval: the probe-winning ledger facts with code, never in train/val/test', async () => {
  const ev = ledgerEval();
  const names = ev.pairs.flatMap((p) => p.meta.names);
  for (const n of ['ListPage', 'DetailPage', 'FormPage', 'PicksPage', 'BookPage']) assert.ok(names.includes(n), `eval covers ${n}`);
  for (const p of ev.pairs) assert.equal(p.direction, 'js->en');
  assert.ok(ev.pairs.every((p) => /^(L\+tools|CL) [45]\/5$/.test(p.meta.wonBy)));

  const ds = await generate({ summarizeCode: fakeSmith, roots: ROOTS });
  const keys = leakKeys(ds.eval);
  for (const split of ['train', 'val', 'test']) {
    for (const p of ds[split]) assert.ok(!leaks(p, keys), `${split} pair ${p.id} (${p.meta.file} ${p.meta.name}) leaks eval`);
  }
  // The lending starter's ListPage/DetailPage/FormPage are in the Smith roots: the guard must have held them out.
  assert.ok(ds.stats.perSource.smith.leakHeldOut >= 3, JSON.stringify(ds.stats.perSource.smith));
  // A candidate that copies an eval code (comments/whitespace aside) is held out.
  const e = ds.eval[0];
  const copy = makePair({ source: 'smith', direction: 'js->en', code: `// copied\n${e.code}\n`, english: 'Something else entirely.', meta: {} });
  const res = buildDataset([copy], ds.eval);
  assert.equal(res.stats.total, 0);
  assert.equal(res.stats.perSource.smith.leakHeldOut, 1);
});

test('dedupe: one pair per normalized code, hand-written source first', () => {
  const code = 'function add(a, b) {\n  return a + b;\n}';
  const smith = makePair({ source: 'smith', direction: 'js->en', code, english: 'Add using a and b works in 1 step. It returns a + b.', meta: { name: 'add' } });
  const atom = makePair({ source: 'atoms', direction: 'en->js', code: `/* sum */ function add(a,b){ return a+b; }`, english: 'Add two numbers.', meta: { atom: 'add' } });
  const other = makePair({ source: 'smith', direction: 'js->en', code: 'function sub(a, b) { return a - b; }', english: 'Sub using a and b works in 1 step.', meta: { name: 'sub' } });
  assert.equal(normalizeCode(smith.code), normalizeCode(atom.code));
  const ds = buildDataset([smith, other, atom], []);
  assert.equal(ds.stats.total, 2);
  const kept = [...ds.train, ...ds.val, ...ds.test];
  assert.ok(kept.some((p) => p.id === atom.id) && !kept.some((p) => p.id === smith.id));
  assert.equal(ds.stats.perSource.smith.duplicates, 1);
  assert.equal(new Set(kept.map((p) => normalizeCode(p.code))).size, kept.length);
});

test('schema: every written pair is {id, source, direction, code, english, meta} with a split', async () => {
  const ds = await generate({ summarizeCode: fakeSmith, roots: ROOTS });
  for (const split of ['train', 'val', 'test', 'eval']) {
    for (const p of ds[split]) {
      assertPair(p);
      assert.deepEqual(Object.keys(p), ['id', 'source', 'direction', 'code', 'english', 'meta']);
      assert.equal(p.meta.split, split);
      assert.equal(p.source === 'ledger', split === 'eval');
      assert.deepEqual(JSON.parse(JSON.stringify(p)), p);
    }
  }
  for (const src of ['atoms', 'typed-contracts', 'probe', 'smith']) assert.ok(ds.stats.perSource[src]?.kept > 0, `${src} contributes`);
  const good = makePair({ source: 'atoms', direction: 'en->js', code: 'function f() {}', english: 'Do nothing.', meta: {} });
  assert.throws(() => assertPair({ ...good, english: ' ' }), /empty english/);
  assert.throws(() => assertPair({ ...good, code: '// only a comment' }), /empty code/);
  assert.throws(() => assertPair({ ...good, source: 'web' }), /bad source/);
  assert.throws(() => assertPair({ ...good, direction: 'en->py' }), /bad direction/);
  assert.throws(() => assertPair({ ...good, english: 'Changed.' }), /id does not match/);
  assert.throws(() => assertPair({ ...good, extra: 1 }), /unknown keys/);
});

test('Smith empties: placeholder-only and blank outputs are skipped and counted', async () => {
  assert.equal(smithEmptyReason('Next using state works in 1 step. It returns (...)'), 'placeholder');
  assert.equal(smithEmptyReason('(...)'), 'blank');
  assert.equal(smithEmptyReason('Price label using amount works in 3 steps. If amount < 0, return \'invalid\'. It returns amount times rate.'), null);
  const fns = functionsOf(toJs('export const f = (x: number) => x + 1;\nexport function g() { return <b>hi</b>; }', 'a.tsx'));
  assert.deepEqual(fns.map((f) => [f.name, f.kind, !!f.fromArrow]), [['f', 'function', true], ['g', 'function', false]]);
  const empty = async () => ({ via: 'smith', sentences: ['F works in 1 step.', 'It returns (...)'] });
  const r = await smithPairs({ summarizeCode: empty, roots: ['bench/lending/starter'] });
  assert.equal(r.pairs.length, 0);
  assert.equal(r.counts.smithEmpty.placeholder, r.counts.smithFunctions);
  assert.equal(r.counts.smithEmpty.total, r.counts.smithFunctions);
});

test('real Smith (skipped when atomic-codemod is not linked): non-empty translations of the lending starter', async (t) => {
  const { smithLinks } = await import('../../../summarize/links.mjs');
  if (!smithLinks().codemod.ok) return t.skip('atomic-codemod is not linked');
  const r = await smithPairs({ roots: ['bench/lending/starter'] });
  assert.ok(r.counts.smithFunctions > 0);
  assert.equal(r.counts.smithNonEmpty + r.counts.smithEmpty.total, r.counts.smithFunctions);
  for (const p of r.pairs) assert.equal(smithEmptyReason(p.english), null);
});
