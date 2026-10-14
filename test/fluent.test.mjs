// The fluent facade (smith/fluent) says the same thing as the atoms: every `fluent` form in
// the catalog is evaluated as written and held to the atom it stands for.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import fc from 'fast-check';
import { arb } from './support/gens.mjs';
import { clone, outcome, sameOutcome } from './support/harness.mjs';

const require = createRequire(import.meta.url);
const smith = require('../dist/index.js');
const fluent = require('../dist/fluent/index.js');
const catalog = JSON.parse(readFileSync(new URL('../src/atoms/catalog.json', import.meta.url), 'utf8'));
const NUM_RUNS = Number(process.env.SMITH_RUNS ?? 100);
const ENTRY = ['checks', 'text', 'list', 'when', 'choose', 'match', 'attempt'];
// The fluent forms use shorter names than the atoms' parameters.
const SHORT = { list: 'xs', item: 'x', text: 's', separator: 'sep', pattern: 'p', replacement: 'r', compare: 'order', type: 'Type' };
// Checked by the dedicated properties at the end of this file, not by the catalog's check sets.
const DEDICATED = new Set(['and', 'choose', 'match', 'attempt']);

const withFluent = catalog.atoms.filter((a) => a.fluent);
const mentions = (source, name) => new RegExp(`(^|[^\\w.])${name}\\b`).test(source);
const run = (source, names, values) => new Function(...ENTRY, ...names, `return (${source});`)(...ENTRY.map((k) => fluent[k]), ...values);

describe('fluent facade', () => {
  test('the entry points are exactly the ones the catalog forms start with', () => {
    assert.deepEqual(Object.keys(fluent).filter((k) => /^[a-z]/.test(k)).sort(), [...ENTRY].sort());
    for (const a of withFluent) assert.ok(ENTRY.some((k) => a.fluent.startsWith(`${k}(`)), a.fluent);
  });

  test('every fluent form is checked here', () => {
    for (const a of withFluent) assert.ok(DEDICATED.has(a.atom) || Array.isArray(a.check), `${a.atom} has a fluent form and no check`);
  });

  for (const a of withFluent) {
    if (DEDICATED.has(a.atom)) continue;
    a.check.forEach((set, i) => {
      const names = set.params.map(([n]) => SHORT[n] ?? n);
      const gens = set.params.map(([, g]) => g.replace(/^lazy:/, ''));
      // A form that leaves out the atom's trailing optional parameters is the atom called without them.
      const used = names.filter((n) => mentions(a.fluent, n)).length;
      test(`${a.fluent} == ${a.atom}${a.check.length > 1 ? ` [${i + 1}]` : ''}`, async () => {
        assert.ok(used > 0 && names.slice(0, used).every((n) => mentions(a.fluent, n)), `${a.atom}: form does not use a prefix of ${names}`);
        await fc.assert(
          fc.asyncProperty(fc.tuple(...gens.map(arb)), async (values) => {
            const args = values.slice(0, used).map((v, k) => (set.params[k][1].startsWith('lazy:') ? ((x) => () => x)(clone(v)) : clone(v)));
            const got = await outcome(() => run(a.fluent, names, values.map(clone)));
            const want = await outcome(() => smith[a.atom](...args));
            sameOutcome(got, want, `${a.fluent} vs ${a.atom}`);
          }),
          { numRuns: NUM_RUNS },
        );
      });
    });
  }

  const form = (atom) => catalog.atoms.find((a) => a.atom === atom).fluent;
  const prim = arb('prim');

  test('is().not() flips every check that follows it', () => {
    fc.assert(
      fc.property(prim, prim, (a, b) => {
        assert.equal(fluent.checks().if(a).is().not().text(), !smith.isText(a));
        assert.equal(fluent.checks().if(a).is().not().not().equalTo(b), smith.equals(a, b));
      }),
      { numRuns: NUM_RUNS },
    );
  });

  test(`${form('and')} == and, and b only runs when a is truthy`, () => {
    fc.assert(
      fc.property(prim, prim, (a, b) => {
        let ran = 0;
        const got = fluent.checks().if(a).and(() => (ran++, b));
        assert.deepStrictEqual(got, smith.and(a, () => b));
        assert.equal(ran, a ? 1 : 0);
        assert.deepStrictEqual(run(form('and'), ['a', 'b'], [a, b]), a && b);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  test(`${form('when')}: only the chosen branch runs`, () => {
    fc.assert(
      fc.property(prim, prim, prim, (c, a, b) => {
        const ran = [];
        const got = fluent.when(c).yields(() => (ran.push('a'), a)).otherwise(() => (ran.push('b'), b));
        assert.deepStrictEqual(got, c ? a : b);
        assert.deepEqual(ran, [c ? 'a' : 'b']);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  test(`${form('choose')} == choose: the first truthy condition wins and later ones never run`, () => {
    fc.assert(
      fc.property(prim, prim, prim, prim, prim, (c1, c2, a, b, fallback) => {
        const ran = [];
        const second = () => (ran.push('c2'), c2);
        const got = fluent.choose().when(c1, () => a).when(second, () => b).otherwise(() => fallback);
        assert.deepStrictEqual(got, smith.choose([[c1, () => a], [() => c2, () => b]], () => fallback));
        assert.deepStrictEqual(got, c1 ? a : c2 ? b : fallback);
        assert.deepEqual(ran, c1 ? [] : ['c2']);
        assert.deepStrictEqual(run(form('choose'), ['c1', 'c2', 'a', 'b', 'fallback'], [c1, c2, a, b, fallback]), got);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  test(`${form('match')} == match: a switch on the value`, () => {
    const key = fc.oneof(fc.constantFrom('a', 'b', 'toString', '__proto__'), fc.integer({ min: 0, max: 3 }), fc.constant(NaN));
    fc.assert(
      fc.property(key, key, prim, prim, (value, k, a, fallback) => {
        const got = run(form('match'), ['value', 'k', 'a', 'fallback'], [value, k, a, fallback]);
        assert.deepStrictEqual(got, smith.match(value, { [k]: () => a }, () => fallback));
        const second = fluent.match(value).on(k, () => a).on('other', () => 'other').otherwise(() => fallback);
        assert.deepStrictEqual(second, smith.match(value, { [k]: () => a, other: () => 'other' }, () => fallback));
      }),
      { numRuns: NUM_RUNS },
    );
  });

  test(`${form('attempt')} == attempt: body, recover, cleanup, in that order`, () => {
    fc.assert(
      fc.property(fc.boolean(), fc.boolean(), prim, prim, (bodyThrows, recoverThrows, value, recovered) => {
        const trace = (log) => ({
          body: () => {
            log.push('body');
            if (bodyThrows) throw new RangeError('body');
            return value;
          },
          recover: (e) => {
            log.push(`recover ${e.constructor.name}`);
            if (recoverThrows) throw new TypeError('recover');
            return recovered;
          },
          cleanup: () => void log.push('cleanup'),
        });
        const settle = (fn) => {
          try {
            return { ok: fn() };
          } catch (e) {
            return { threw: e.constructor.name };
          }
        };
        const [fluentLog, atomLog, bareLog, bareAtomLog] = [[], [], [], []];
        const f = trace(fluentLog);
        const a = trace(atomLog);
        assert.deepStrictEqual(settle(() => fluent.attempt(f.body).onFailure(f.recover).finally(f.cleanup)), settle(() => smith.attempt(a.body, a.recover, a.cleanup)));
        assert.deepEqual(fluentLog, atomLog);
        const g = trace(bareLog);
        const h = trace(bareAtomLog);
        assert.deepStrictEqual(settle(() => fluent.attempt(g.body).finally(g.cleanup)), settle(() => smith.attempt(h.body, undefined, h.cleanup)));
        assert.deepEqual(bareLog, bareAtomLog);
      }),
      { numRuns: NUM_RUNS },
    );
    assert.equal(run(form('attempt'), ['body', 'recover', 'cleanup'], ['done', 'unused', undefined]), 'done');
  });
});
