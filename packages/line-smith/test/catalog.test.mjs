// The catalog (src/atoms/catalog.json) is the single source of truth for JS -> atom.
// Every export has an entry, every entry names a real export, every reading appears in
// the atom's JSDoc, and every checkable entry is equivalent to its JS form under fast-check.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import fc from 'fast-check';
import { arb } from './support/gens.mjs';
import { clone, outcome, sameOutcome, callNative } from './support/harness.mjs';

const require = createRequire(import.meta.url);
const root = new URL('..', import.meta.url).pathname;
const smith = require('../dist/index.js');
const catalog = JSON.parse(readFileSync(new URL('../src/atoms/catalog.json', import.meta.url), 'utf8'));
const NUM_RUNS = Number(process.env.SMITH_RUNS ?? 100);
const SMITH_CORE = new Set(['Chain', 'Organism', 'Comparable', 'Conditional', 'Subject', 'Clause', 'AndSubject', 'OrSubject', 'ifIt']);

describe('catalog shape', () => {
  test('every exported atom has exactly one catalog entry, and every entry is exported', () => {
    const exported = Object.keys(smith).filter((k) => typeof smith[k] === 'function' && !SMITH_CORE.has(k)).sort();
    const listed = catalog.atoms.map((a) => a.atom);
    assert.equal(new Set(listed).size, listed.length, 'duplicate catalog entries');
    assert.deepEqual([...listed].sort(), exported);
  });

  test('every entry has the required fields', () => {
    for (const a of catalog.atoms) {
      assert.equal(typeof a.reads, 'string', a.atom);
      assert.ok(Array.isArray(a.js) && a.js.length > 0, a.atom);
      assert.equal(typeof a.pure, 'boolean', a.atom);
      assert.equal(typeof a.mutates, 'boolean', a.atom);
      assert.equal(typeof a.module, 'string', a.atom);
      assert.equal(typeof a.generated, 'boolean', a.atom);
      if (!a.pure) assert.ok(a.impureReason || a.mutates, `${a.atom} is impure without a reason`);
      if (!a.verified) assert.ok(a.unverified || a.unverifiedReason, `${a.atom} is unverified without a reason`);
    }
    for (const x of catalog.excluded) assert.ok(x.atom === null && x.excluded, JSON.stringify(x));
  });

  test("every atom's JSDoc carries its catalog reading", () => {
    const sources = new Map();
    for (const a of catalog.atoms) {
      const file = `${root}src/atoms/${a.module}.ts`;
      if (!sources.has(file)) sources.set(file, readFileSync(file, 'utf8'));
      assert.ok(sources.get(file).includes(`reads "${a.reads}"`), `${a.atom}: JSDoc in ${a.module}.ts lacks reads "${a.reads}"`);
    }
  });

  test('generated output is up to date with the generator', () => {
    execFileSync(process.execPath, [`${root}scripts/gen-atoms.mjs`, '--check'], { stdio: 'pipe' });
  });
});

function curatedProperty(a, set) {
  const names = set.params.map(([n]) => n);
  const gensFor = set.params.map(([, g]) => g);
  const forms = (set.js ?? a.js).map((js) => ({ js, fn: new Function(...names, `return (${js});`) }));
  const atom = smith[a.atom];
  return fc.asyncProperty(fc.tuple(...gensFor.map(arb)), async (values) => {
    for (const { js, fn } of forms) {
      const atomArgs = values.map((v, i) => (gensFor[i].startsWith('lazy:') ? ((x) => () => x)(clone(v)) : clone(v)));
      const got = await outcome(() => atom(...atomArgs));
      const want = await outcome(() => fn(...values.map(clone)));
      sameOutcome(got, want, `${a.atom} vs ${js}`);
    }
  });
}

function generatedProperty(a) {
  const { check } = a;
  const atom = smith[a.atom];
  const params = check.params;
  const required = params.filter((p) => !p.optional && !p.rest).length;
  const argArb = fc.tuple(...params.map((p) => (p.rest ? fc.array(arb(p.gen), { maxLength: 3 }) : arb(p.gen))));
  const countArb = fc.integer({ min: required, max: params.length });
  const recvArb = check.receiver ? arb(check.receiver) : fc.constant(undefined);
  return fc.asyncProperty(recvArb, argArb, countArb, async (receiver, values, count) => {
    // Inputs are shared, not cloned: every generated atom is non-mutating (copy kinds copy
    // internally), so sharing keeps identity-sensitive results (Object.create's prototype) comparable.
    // Weak collections, the only in-place kind, get a fresh receiver per call.
    const fresh = check.native.kind === 'inplace' ? clone : (x) => x;
    const args = [];
    params.slice(0, count).forEach((p, i) => (p.rest ? args.push(...values[i]) : args.push(values[i])));
    const got = await outcome(() => (check.receiver ? atom(fresh(receiver), ...args) : atom(...args)));
    const want = await outcome(() => callNative(check.native, fresh(receiver), args));
    sameOutcome(got, want, `${a.atom} vs ${a.js[0]}`);
  });
}

let properties = 0;
describe('every checkable atom equals its JS form (fast-check)', () => {
  for (const a of catalog.atoms) {
    if (a.generated && a.check && !Array.isArray(a.check)) {
      properties++;
      test(`${a.atom} == ${a.js[0]}`, async () => {
        await fc.assert(generatedProperty(a), { numRuns: NUM_RUNS });
      });
    } else if (Array.isArray(a.check)) {
      // Hand-written atoms and approved ones (gen-atoms writes their check set from the approved params).
      a.check.forEach((set, i) => {
        properties++;
        test(`${a.atom} == ${(set.js ?? a.js).join(' == ')}${a.check.length > 1 ? ` [${i + 1}]` : ''}`, async () => {
          await fc.assert(curatedProperty(a, set), { numRuns: NUM_RUNS });
        });
      });
    }
  }
  test('summary', () => {
    const unverified = catalog.atoms.filter((a) => !a.verified);
    console.log(`# catalog: ${catalog.atoms.length} atoms, ${properties} equivalence properties, ${unverified.length} unverified, ${catalog.excluded.length} excluded entries`);
  });
});
