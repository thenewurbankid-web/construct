// scripts/lib-approved.mjs: the hand-kept approved atoms gen-atoms merges into the catalog.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkApproved, emitApproved, emitApprovedFluent } from '../scripts/lib-approved.mjs';

const ok = { atom: 'flatMapped', entry: 'Array.prototype.flatMap', fluent: 'array(xs).flattens().with(f).andThe().flattened()', js: 'xs.flatMap(f)', params: [['xs', 'list'], ['f', 'fn']], kind: 'copy', approvedAt: 'A' };

test('the committed approved.json is valid', () => {
  const file = JSON.parse(readFileSync(new URL('../src/atoms/approved.json', import.meta.url), 'utf8'));
  assert.ok(Array.isArray(file.atoms));
  checkApproved(file.atoms);
});

test('checkApproved refuses what gen-atoms could not emit', () => {
  checkApproved([ok]);
  const bad = (fields, re) => assert.throws(() => checkApproved([{ ...ok, ...fields }]), re);
  bad({ atom: 'Flat' }, /camelCase/);
  bad({ fluent: '' }, /fluent sentence/);
  bad({ js: 'a;\nb' }, /one expression/);
  bad({ params: [['x s', 'list']] }, /identifier names/);
  bad({ kind: 'nope' }, /kind must be/);
  assert.throws(() => checkApproved([ok, ok]), /name collision with approved/);
  assert.throws(() => checkApproved([ok], new Map([['flatMapped', 'hand-written']])), /collision with hand-written/);
});

test('emitApproved writes one typed-any wrapper and one catalog entry per atom', () => {
  assert.deepEqual(emitApproved([]), { code: null, entries: [] });
  const { code, entries } = emitApproved([ok, { ...ok, atom: 'logged', kind: 'effect', js: 'console.log(x)', params: [['x', 'mixed']] }]);
  assert.match(code, /flatMapped\(xs, f\) reads "array xs flattens with f"\.\n \* Approved atom \(fluent generator, Array\.prototype\.flatMap\): exactly `xs\.flatMap\(f\)`\./);
  assert.match(code, /export function logged\(x: any\): any \{\n {2}return \(console\.log\(x\)\);\n\}/);
  assert.deepEqual(entries[0], {
    atom: 'flatMapped', module: 'generated/approved', reads: 'array xs flattens with f', js: ['xs.flatMap(f)'],
    pure: true, mutates: false, generated: true, fluent: ok.fluent, params: ok.params,
    check: [{ params: ok.params }], verified: true, verifiedBy: 'approved: the C3 gate (equivalence to the JS reference) and the read-back',
    approved: { entry: 'Array.prototype.flatMap', approvedAt: 'A' },
  });
  assert.equal(entries[1].pure, false);
  assert.equal(entries[1].impureReason, 'approved as an effect');
  assert.equal(emitApproved([{ ...ok, kind: 'in-place' }]).entries[0].mutates, true);
  // A sentence that starts a hand-written class is registered; its sentence waits until that class takes steps.
  const held = emitApproved([{ ...ok, fluent: 'clones().list(xs).and().flattens().andThe().flattened()' }]).entries[0];
  assert.equal(held.fluent, undefined);
  assert.equal(held.fluentPending, 'clones().list(xs).and().flattens().andThe().flattened()');
});

test('emitApprovedFluent speaks approved sentences that start new entries', () => {
  assert.deepEqual(emitApprovedFluent([]), { code: 'export {};\n', entries: [] });
  const { code, entries } = emitApprovedFluent([
    { atom: 'createsAtTo', fluent: 'map(m).creates().at(key).to(value).andThe().created()', params: [['m', 'map'], ['key', 'prim'], ['value', 'prim']] },
    { ...ok, fluent: 'clones().list(xs).and().flattens().andThe().flattened()' },
  ]);
  assert.deepEqual(entries, ['map']);
  assert.match(code, /export function map\(a0: any\): any \{\n {2}return \{ creates: \(\) => \(\{ at: \(a1: any\) => \(\{ to: \(a2: any\) => returns\(createsAtTo\(a0, a1, a2\), 'created'\) \}\) \}\) \};/);
  assert.match(code, /import \{ returns \} from '\.\/returns';/);
});
