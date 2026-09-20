import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyTrail, startTrail, fileTitle } from './TrailHistory.ts';
import { pushStep, refreshRoot } from './TrailSteps.ts';
import { goBack, goForward, goTo } from './TrailMoves.ts';
import { canBack, canForward } from './TrailAvailability.ts';
import { foldTrail } from './TrailFold.ts';
import { linkSegments, unlinkedReferences } from './CodeLinks.ts';

const view = (path, references = [], source = '') => ({ path, source, references });
const step = (name) => ({ name, relation: null, view: view(`x/${name}.tsx`) });
const names = (t) => t.steps.map((s) => s.name);

test('fileTitle drops directories and the extension', () => {
  assert.equal(fileTitle('features/catalog/pages/HomePage.tsx'), 'HomePage');
});

test('three hops, back, forward, and the arrows enable to match', () => {
  let t = startTrail(view('features/catalog/pages/HomePage.tsx'));
  assert.equal(canBack(t), false);
  t = pushStep(pushStep(t, step('PriceCard')), step('Badge'));
  assert.deepEqual(names(t), ['HomePage', 'PriceCard', 'Badge']);
  assert.equal(t.index, 2);
  assert.equal(canForward(t), false);
  t = goBack(t);
  assert.equal(t.steps[t.index].name, 'PriceCard');
  assert.equal(canForward(t), true);
  assert.equal(goForward(t).index, 2);
  assert.equal(goBack(goBack(goBack(t))).index, 0); // clamps at the start
  assert.equal(goTo(t, 0).index, 0);
  assert.equal(goTo(t, 9).index, t.index);
});

test('opening a reference from a middle step drops the forward steps', () => {
  let t = startTrail(view('a/A.tsx'));
  t = pushStep(pushStep(t, step('B')), step('C'));
  t = goBack(t); // at B, C is forward
  t = pushStep(t, step('D'));
  assert.deepEqual(names(t), ['A', 'B', 'D']);
  assert.equal(canForward(t), false);
});

test('a trail of six or fewer shows every step; past six the middle folds and the current step stays visible', () => {
  let t = startTrail(view('a/S0.tsx'));
  for (let i = 1; i < 6; i++) t = pushStep(t, step(`S${i}`));
  assert.equal(foldTrail(t).every((x) => x.kind === 'step'), true);
  for (let i = 6; i < 10; i++) t = pushStep(t, step(`S${i}`));
  const at = (items) => items.map((x) => (x.kind === 'fold' ? `...${x.hidden.length}` : x.step.name));
  assert.deepEqual(at(foldTrail(t)), ['S0', '...7', 'S8', 'S9']);
  const mid = goTo(t, 5);
  assert.deepEqual(at(foldTrail(mid)), ['S0', '...3', 'S4', 'S5', 'S6', '...2', 'S9']);
  assert.ok(foldTrail(mid).some((x) => x.kind === 'step' && x.index === mid.index));
});

test('refreshRoot replaces the first view and keeps the hops', () => {
  let t = pushStep(startTrail(view('a/A.tsx', [], 'old')), step('B'));
  t = refreshRoot(t, view('a/A.tsx', [], 'new'));
  assert.equal(t.steps[0].view.source, 'new');
  assert.equal(t.steps.length, 2);
  assert.equal(refreshRoot(emptyTrail, view('z/Z.tsx')).steps.length, 1);
});

test('linkSegments marks only resolved references; unresolved ones stay in plain text runs', () => {
  const source = 'import { A } from "./a"; import { T } from "pkg"; <A /><T />';
  const ref = (name, target, at) => ({ name, kind: 'import', start: at, end: at + name.length, line: 1, column: 1, target, reason: target ? null : 'outside' });
  const a = source.indexOf('A');
  const t = source.indexOf('T');
  const segs = linkSegments(source, [ref('T', null, t), ref('A', 'f/A.tsx', a)]);
  assert.equal(segs.map((s) => s.text).join(''), source);
  assert.deepEqual(segs.filter((s) => s.ref).map((s) => s.text), ['A']);
  assert.ok(!segs.some((s) => s.ref && s.text === 'T'));
  assert.ok(segs.some((s) => !s.ref && s.text.includes('T')));
});

test('unlinkedReferences lists each unresolved name once with its reason', () => {
  const r = (name, line, target, reason) => ({ name, kind: 'jsx', start: 0, end: 1, line, column: 1, target, reason });
  assert.deepEqual(unlinkedReferences([r('Tooltip', 3, null, 'pkg'), r('Tooltip', 11, null, 'pkg'), r('A', 1, 'f.tsx', null)]), [{ name: 'Tooltip', line: 3, reason: 'pkg' }]);
});
