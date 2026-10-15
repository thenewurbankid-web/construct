// The fluent facade (smith/fluent) says the same thing as the atoms: every `fluent` sentence in
// the catalog, and every `fluentDeprecated` form it replaced, is evaluated as written and held
// to the atom it stands for.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import fc from 'fast-check';
import { arb } from './support/gens.mjs';
import { emitApprovedFluent } from '../scripts/lib-approved.mjs';
import { clone, outcome, sameOutcome } from './support/harness.mjs';

const require = createRequire(import.meta.url);
const smith = require('../dist/index.js');
const fluent = require('../dist/fluent/index.js');
const catalog = JSON.parse(readFileSync(new URL('../src/atoms/catalog.json', import.meta.url), 'utf8'));
const everyGrammar = JSON.parse(readFileSync(new URL('../src/atoms/naming.json', import.meta.url), 'utf8')).grammar.every;
const NUM_RUNS = Number(process.env.SMITH_RUNS ?? 100);
// The hand-written entries, plus the entries approved sentences start (src/fluent/approved.ts, generated).
const APPROVED_ENTRY = emitApprovedFluent(JSON.parse(readFileSync(new URL('../src/atoms/approved.json', import.meta.url), 'utf8')).atoms).entries;
const ENTRY = ['checks', 'clones', 'text', 'list', 'when', 'chooses', 'matches', 'attempts', ...APPROVED_ENTRY];
// The forms before Atomic English, kept for one release.
const DEPRECATED_ENTRY = ['choose', 'match', 'attempt'];
const ENTRIES = [...ENTRY, ...DEPRECATED_ENTRY];
// R9: the starts that only every() sentences use, and the placeholders their bodies name.
const EVERY_ENTRY = ['every', 'the', 'folds', 'does'];
const PLACEHOLDERS = everyGrammar.placeholders;
// The fluent forms use shorter names than the atoms' parameters.
const SHORT = { list: 'xs', item: 'x', text: 's', separator: 'sep', pattern: 'p', replacement: 'r', compare: 'order', type: 'Type' };
// Checked by the dedicated properties at the end of this file, not by the catalog's check sets.
const DEDICATED = new Set(['and', 'choose', 'match', 'attempt']);

const withFluent = catalog.atoms.filter((a) => a.fluent);
// [atom, form] for every sentence and every deprecated form.
const forms = withFluent.flatMap((a) => [[a, a.fluent], ...(a.fluentDeprecated ? [[a, a.fluentDeprecated]] : [])]);
const mentions = (source, name) => new RegExp(`(^|[^\\w.])${name}\\b`).test(source);
const run = (source, names, values) => new Function(...ENTRIES, ...names, `return (${source});`)(...ENTRIES.map((k) => fluent[k]), ...values);

describe('fluent facade', () => {
  test('the entry points are exactly the ones the catalog forms start with', () => {
    assert.deepEqual(Object.keys(fluent).filter((k) => /^[a-z]/.test(k)).sort(), [...ENTRIES, ...EVERY_ENTRY, ...PLACEHOLDERS].sort());
    for (const a of withFluent) assert.ok(ENTRY.some((k) => a.fluent.startsWith(`${k}(`)), a.fluent);
    for (const [, f] of forms) assert.ok(ENTRIES.some((k) => f.startsWith(`${k}(`)), f);
  });

  test('every fluent form is checked here', () => {
    for (const a of withFluent) assert.ok(DEDICATED.has(a.atom) || Array.isArray(a.check), `${a.atom} has a fluent form and no check`);
  });

  for (const [a, form] of forms) {
    if (DEDICATED.has(a.atom)) continue;
    a.check.forEach((set, i) => {
      const names = set.params.map(([n]) => SHORT[n] ?? n);
      const gens = set.params.map(([, g]) => g.replace(/^lazy:/, ''));
      // A form that leaves out the atom's trailing optional parameters is the atom called without them.
      const used = names.filter((n) => mentions(form, n)).length;
      test(`${form} == ${a.atom}${a.check.length > 1 ? ` [${i + 1}]` : ''}`, async () => {
        assert.ok(used > 0 && names.slice(0, used).every((n) => mentions(form, n)), `${a.atom}: form does not use a prefix of ${names}`);
        await fc.assert(
          fc.asyncProperty(fc.tuple(...gens.map(arb)), async (values) => {
            const args = values.slice(0, used).map((v, k) => (set.params[k][1].startsWith('lazy:') ? ((x) => () => x)(clone(v)) : clone(v)));
            const got = await outcome(() => run(form, names, values.map(clone)));
            const want = await outcome(() => smith[a.atom](...args));
            sameOutcome(got, want, `${a.fluent} vs ${a.atom}`);
          }),
          { numRuns: NUM_RUNS },
        );
      });
    });
  }

  const form = (atom) => catalog.atoms.find((a) => a.atom === atom).fluent;
  const old = (atom) => catalog.atoms.find((a) => a.atom === atom).fluentDeprecated;
  const prim = arb('prim');

  test('is().not() flips every check that follows it', () => {
    fc.assert(
      fc.property(prim, prim, (a, b) => {
        assert.equal(fluent.checks().if(a).is().not().text(), !smith.isText(a));
        assert.equal(fluent.checks().if(a).is().not().not().equal().to(b), smith.equals(a, b));
        assert.equal(fluent.checks().if(a).is().not().an().instance().of(Object), !smith.isA(a, Object));
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
        const got = fluent.chooses().when(c1).yields(() => a).when(second).yields(() => b).otherwise(() => fallback);
        assert.deepStrictEqual(got, smith.choose([[c1, () => a], [() => c2, () => b]], () => fallback));
        assert.deepStrictEqual(got, c1 ? a : c2 ? b : fallback);
        assert.deepEqual(ran, c1 ? [] : ['c2']);
        assert.deepStrictEqual(fluent.choose().when(c1, () => a).when(second, () => b).otherwise(() => fallback), got);
        for (const f of [form('choose'), old('choose')]) assert.deepStrictEqual(run(f, ['c1', 'c2', 'a', 'b', 'fallback'], [c1, c2, a, b, fallback]), got);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  test(`${form('match')} == match: a switch on the value`, () => {
    const key = fc.oneof(fc.constantFrom('a', 'b', 'toString', '__proto__'), fc.integer({ min: 0, max: 3 }), fc.constant(NaN));
    fc.assert(
      fc.property(key, key, prim, prim, (value, k, a, fallback) => {
        for (const f of [form('match'), old('match')]) {
          const got = run(f, ['value', 'k', 'a', 'fallback'], [value, k, a, fallback]);
          assert.deepStrictEqual(got, smith.match(value, { [k]: () => a }, () => fallback));
        }
        const want = smith.match(value, { [k]: () => a, other: () => 'other' }, () => fallback);
        assert.deepStrictEqual(fluent.matches().value(value).on(k).yields(() => a).on('other').yields(() => 'other').otherwise(() => fallback), want);
        assert.deepStrictEqual(fluent.match(value).on(k, () => a).on('other', () => 'other').otherwise(() => fallback), want);
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
        const full = [
          (f) => fluent.attempts().to(f.body).and().recovers().with(f.recover).and().cleans().up().with(f.cleanup),
          (f) => fluent.attempt(f.body).onFailure(f.recover).finally(f.cleanup),
        ];
        const bare = [(f) => fluent.attempts().to(f.body).and().cleans().up().with(f.cleanup), (f) => fluent.attempt(f.body).finally(f.cleanup)];
        for (const sentence of full) {
          const [fluentLog, atomLog] = [[], []];
          const f = trace(fluentLog);
          const a = trace(atomLog);
          assert.deepStrictEqual(settle(() => sentence(f)), settle(() => smith.attempt(a.body, a.recover, a.cleanup)));
          assert.deepEqual(fluentLog, atomLog);
        }
        for (const sentence of bare) {
          const [bareLog, bareAtomLog] = [[], []];
          const g = trace(bareLog);
          const h = trace(bareAtomLog);
          assert.deepStrictEqual(settle(() => sentence(g)), settle(() => smith.attempt(h.body, undefined, h.cleanup)));
          assert.deepEqual(bareLog, bareAtomLog);
        }
      }),
      { numRuns: NUM_RUNS },
    );
    for (const f of [form('attempt'), old('attempt')]) assert.equal(run(f, ['body', 'recover', 'cleanup'], ['done', 'unused', () => {}]), 'done');
  });
});

// R9: each every() sentence is its plain-JS callback, on generated lists, and returns the kind of
// value its first word says.
describe('every() sentences (R9)', () => {
  const names = [...ENTRIES, ...EVERY_ENTRY, ...PLACEHOLDERS, 'xs', 'rows'];
  const sentence = (source) => new Function(...names, `return (${source});`);
  const say = (source, xs) => sentence(source)(...[...ENTRIES, ...EVERY_ENTRY, ...PLACEHOLDERS].map((k) => fluent[k]), xs, xs);
  const plain = (js, xs) => new Function('xs', 'rows', 'delay', `return (${js});`)(xs, xs, smith.delay);
  // Every kind of primitive, so a TypeError the plain callback throws (5n * 2) is thrown here too.
  const lists = { list: arb('list'), nums: arb('nums'), ints: fc.array(fc.integer({ min: -9, max: 9 }), { maxLength: 8 }) };
  const kinds = {
    nothing: (r) => r === undefined,
    list: (r, xs) => Array.isArray(r) && r !== xs,
    boolean: (r) => typeof r === 'boolean',
    item: (r, xs) => r === undefined || xs.some((v) => Object.is(v, r)),
    value: () => true,
  };

  test('the table has a sentence for each callback', () => {
    assert.deepEqual(everyGrammar.sentences.map((s) => s.js.match(/^xs\.(\w+)/)[1]), ['map', 'filter', 'every', 'some', 'find', 'reduce']);
  });

  for (const { js, fluent: form } of everyGrammar.sentences) {
    const kind = everyGrammar.starts[form.match(/^(\w+)/)[1]];
    for (const [gen, arbitrary] of Object.entries(lists)) {
      test(`${form} == ${js} [${gen}]`, async () => {
        await fc.assert(
          fc.asyncProperty(arbitrary, async (xs) => {
            const input = clone(xs);
            const got = await outcome(() => say(form, input));
            sameOutcome(got, await outcome(() => plain(js, clone(xs))), `${form} vs ${js}`);
            assert.deepStrictEqual(input, xs, 'xs is left alone');
            if ('ok' in got) assert.ok(kinds[kind](say(form, input), input), `${form} returns a ${kind}`);
          }),
          { numRuns: NUM_RUNS },
        );
      });
    }
  }

  // Nested callbacks (every(y).in(x)) on lists of lists.
  const rows = { rows: fc.array(arb('list'), { maxLength: 5 }), introws: fc.array(lists.ints, { maxLength: 5 }) };
  for (const { js, fluent: form } of everyGrammar.nested) {
    for (const [gen, arbitrary] of Object.entries(rows)) {
      test(`${form} == ${js} [${gen}]`, async () => {
        await fc.assert(
          fc.asyncProperty(arbitrary, async (xs) => {
            const input = clone(xs);
            sameOutcome(await outcome(() => say(form, input)), await outcome(() => plain(js, clone(xs))), `${form} vs ${js}`);
            assert.deepStrictEqual(input, xs, 'rows are left alone');
          }),
          { numRuns: NUM_RUNS },
        );
      });
    }
  }

  // The index (at(i)) and does() forms.
  for (const { js, fluent: form } of everyGrammar.shapes) {
    const kind = everyGrammar.starts[form.match(/^(\w+)/)[1]];
    for (const [gen, arbitrary] of Object.entries(lists)) {
      test(`${form} == ${js} [${gen}]`, async () => {
        await fc.assert(
          fc.asyncProperty(arbitrary, async (xs) => {
            const input = clone(xs);
            const got = await outcome(() => say(form, input));
            sameOutcome(got, await outcome(() => plain(js, clone(xs))), `${form} vs ${js}`);
            assert.deepStrictEqual(input, xs, 'xs is left alone');
            if ('ok' in got) assert.ok(kinds[kind](say(form, input), input), `${form} returns ${kind}`);
          }),
          { numRuns: NUM_RUNS },
        );
      });
    }
  }

  // Async bodies, on a fake setTimeout (delay reads it on every call): a timer fires on a later
  // macrotask, shortest first, so the log shows when each timer is set (s) and fires (f), and
  // `most` how many were waiting at once. The sentence and its plain-JS twin must give the same
  // result and the same log: one at a time by default, all at once after all().at().once().
  async function timed(fn) {
    const real = globalThis.setTimeout;
    const pending = [];
    const log = [];
    let seq = 0;
    let most = 0;
    globalThis.setTimeout = (callback, ms) => {
      pending.push({ callback, ms, seq: seq++ });
      most = Math.max(most, pending.length);
      log.push(`s${ms}`);
      setImmediate(() => {
        pending.sort((a, b) => a.ms - b.ms || a.seq - b.seq);
        const t = pending.shift();
        log.push(`f${t.ms}`);
        t.callback();
      });
    };
    try {
      const result = fn();
      const promised = result instanceof Promise;
      return { promised, outcome: await outcome(() => result), log, most };
    } finally {
      globalThis.setTimeout = real;
    }
  }
  const waits = { ms: fc.array(fc.integer({ min: 0, max: 30 }), { maxLength: 6 }) };
  const waitRows = { rows: fc.array(waits.ms, { maxLength: 4 }) };
  for (const [group, gens] of [[everyGrammar.async, waits], [everyGrammar.nestedAsync, waitRows]]) {
    for (const { js, kind, fluent: form } of group) {
      const together = form.includes('all().at().once()');
      test(`${form} == ${js}`, async () => {
        await fc.assert(
          fc.asyncProperty(Object.values(gens)[0], async (xs) => {
            const got = await timed(() => say(form, clone(xs)));
            const want = await timed(() => plain(js, clone(xs)));
            assert.ok(got.promised, `${form} returns a Promise`);
            sameOutcome(got.outcome, want.outcome, `${form} vs ${js}`);
            assert.deepEqual(got.log, want.log, 'the same timers, set and fired in the same order');
            if ('ok' in got.outcome) assert.ok(kinds[kind](got.outcome.ok, xs), `${form} resolves to ${kind}`);
            const n = form.startsWith('every(x).in(rows)') ? Math.min(1, xs.flat().length) : together ? xs.length : Math.min(1, xs.length);
            assert.equal(got.most, n, together ? 'all at once' : 'one at a time');
          }),
          { numRuns: NUM_RUNS },
        );
      });
    }
  }

  test('one at a time vs all().at().once(), on real timers: finishing order and wall time', async () => {
    const { every, does, x } = fluent;
    const run = async (sentence) => {
      const real = globalThis.setTimeout;
      const fired = [];
      globalThis.setTimeout = (callback, ms) => real(() => (fired.push(ms), callback()), ms);
      const started = performance.now();
      try {
        await sentence();
      } finally {
        globalThis.setTimeout = real;
      }
      return { fired, ms: performance.now() - started };
    };
    const ms = [60, 20, 40];
    const one = await run(() => every(x).in(ms).is().mapped().to().clone().by().waiting(x));
    const all = await run(() => every(x).in(ms).all().at().once().is().mapped().to().clone().by().waiting(x));
    const each = await run(() => does().every(x).in(ms).by().waiting(x));
    assert.deepEqual(one.fired, [60, 20, 40]);
    assert.deepEqual(each.fired, [60, 20, 40]);
    assert.deepEqual(all.fired, [20, 40, 60]);
    assert.ok(one.ms >= 115 && each.ms >= 115, `one at a time waits for the sum (${one.ms.toFixed(0)}, ${each.ms.toFixed(0)} ms)`);
    assert.ok(all.ms < 115, `all at once waits for the longest (${all.ms.toFixed(0)} ms)`);
  });

  test('an async body on an empty list still returns a Promise; a sync body never does', async () => {
    const { every, does, x } = fluent;
    const empty = does().every(x).in([]).by().waiting(x);
    assert.ok(empty instanceof Promise);
    assert.equal(await empty, undefined);
    assert.deepEqual(await every(x).in([]).all().at().once().is().mapped().to().clone().by().waiting(x), []);
    assert.equal(does().every(x).in([1]).all().at().once().by().multiplying(x).by(2), undefined);
  });

  test('to().clone() is a new list, never xs; the items are what the body returns', () => {
    const xs = [1, 2];
    const doubled = fluent.every(fluent.x).in(xs).is().mapped().to().clone().by().multiplying(fluent.x).by(1);
    assert.notEqual(doubled, xs);
    assert.deepEqual(doubled, xs);
  });

  test('a body longer than one atom is not computed in place', () => {
    const { every, x } = fluent;
    // A placeholder that reaches a plain atom or raw JS throws instead of computing NaN.
    assert.throws(() => every(x).in([1]).is().mapped().to().clone().by().multiplying(x).by(smith.plus(x, 1)), /placeholder.*molecule in your app, made of existing atoms.*not a new Smith atom/);
    assert.throws(() => every(x).in([1]).is().kept().if(x).is().positive() && x * 2, /placeholder.*molecule in your app, made of existing atoms.*not a new Smith atom/);
    assert.throws(() => `${x}`, TypeError);
  });

  test('a placeholder the sentence did not bind is a ReferenceError', () => {
    const { every, x, y } = fluent;
    assert.throws(() => every(x).in([1]).is().kept().if(y).is().positive(), { name: 'ReferenceError', message: /y is not bound/ });
    // An empty list never runs the body, like the plain callback.
    assert.deepEqual(every(x).in([]).is().kept().if(y).is().positive(), []);
  });

  test('checks().if() with no subject asks about the items; with one, it is the subject', () => {
    assert.equal(fluent.checks().if(undefined).is().nothing(), true);
    assert.ok(fluent.checks().if() instanceof fluent.ChecksIfEach);
  });
});

