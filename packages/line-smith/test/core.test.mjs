// Dedicated properties for the atoms whose equivalence isn't a single expression:
// short-circuiting, branching order, try/catch/finally order, loop limits, Result parsing.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fc from 'fast-check';
import { gens } from './support/gens.mjs';

const require = createRequire(import.meta.url);
const s = require('../dist/index.js');
const catalog = require('../src/atoms/catalog.json');
const runs = { numRuns: Number(process.env.SMITH_RUNS ?? 200) };
const prim = gens.prim;

function counted(value) {
  const thunk = () => {
    thunk.calls += 1;
    return value;
  };
  thunk.calls = 0;
  return thunk;
}

describe('logic short-circuits exactly like && || ??', () => {
  test('and(a, () => b) === a && b, and b runs only when a is truthy', () => {
    fc.assert(
      fc.property(prim, prim, (a, b) => {
        const right = counted(b);
        assert.deepStrictEqual(s.and(a, right), a && b);
        assert.equal(right.calls, a ? 1 : 0);
      }),
      runs,
    );
  });
  test('or(a, () => b) === a || b, and b runs only when a is falsy', () => {
    fc.assert(
      fc.property(prim, prim, (a, b) => {
        const right = counted(b);
        assert.deepStrictEqual(s.or(a, right), a || b);
        assert.equal(right.calls, a ? 0 : 1);
      }),
      runs,
    );
  });
  test('orElse(a, () => b) === a ?? b, and b runs only when a is null/undefined', () => {
    fc.assert(
      fc.property(gens.nullish, prim, (a, b) => {
        const right = counted(b);
        assert.deepStrictEqual(s.orElse(a, right), a ?? b);
        assert.equal(right.calls, a === null || a === undefined ? 1 : 0);
      }),
      runs,
    );
  });
  test('legacy eager and(boolean, boolean) / or(boolean, boolean) still work', () => {
    fc.assert(
      fc.property(fc.boolean(), fc.boolean(), (a, b) => {
        assert.equal(s.and(a, b), a && b);
        assert.equal(s.or(a, b), a || b);
      }),
      runs,
    );
  });
});

describe('branching equals the if / switch it replaces', () => {
  test('when runs exactly one branch, like c ? a : b', () => {
    fc.assert(
      fc.property(prim, prim, prim, (c, a, b) => {
        const yes = counted(a);
        const no = counted(b);
        assert.deepStrictEqual(s.when(c, yes, no), c ? a : b);
        assert.equal(yes.calls + no.calls, 1);
        assert.deepStrictEqual(s.when(c, counted(a)), c ? a : undefined);
      }),
      runs,
    );
  });

  test('choose equals an if / else-if / else chain, evaluating conditions lazily and in order', () => {
    fc.assert(
      fc.property(fc.array(fc.tuple(prim, prim, fc.boolean()), { maxLength: 5 }), prim, (cases, fallback) => {
        const log = [];
        const viaChoose = s.choose(
          cases.map(([c, v, lazy], i) => [lazy ? () => (log.push(`c${i}`), c) : c, () => (log.push(`b${i}`), v)]),
          () => (log.push('f'), fallback),
        );
        const chooseLog = log.splice(0);
        let viaIf;
        let i = 0;
        for (;;) {
          if (i === cases.length) {
            log.push('f');
            viaIf = fallback;
            break;
          }
          const [c, v, lazy] = cases[i];
          if (lazy) log.push(`c${i}`);
          if (c) {
            log.push(`b${i}`);
            viaIf = v;
            break;
          }
          i++;
        }
        assert.deepStrictEqual(viaChoose, viaIf);
        assert.deepStrictEqual(chooseLog, log);
      }),
      runs,
    );
  });

  const Key = fc.constantFrom('draft', 'live', 'gone', 'toString', '__proto__', 1, 2, NaN, -0);
  test('match equals switch with === on string/number keys (own cases only, NaN never matches)', () => {
    fc.assert(
      fc.property(Key, fc.subarray(['draft', 'live', 1, 0]), prim, (value, keys, fallback) => {
        const cases = Object.create(null);
        for (const k of keys) cases[k] = () => `case ${String(k)}`;
        let viaSwitch = fallback;
        for (const k of keys) {
          if (value === k) {
            viaSwitch = `case ${String(k)}`;
            break;
          }
        }
        assert.deepStrictEqual(s.match(value, { ...cases }, () => fallback), viaSwitch);
      }),
      runs,
    );
  });
  test('exhaustive match (no fallback) throws TypeError for a value outside the cases', () => {
    assert.equal(s.match('a', { a: () => 1, b: () => 2 }), 1);
    assert.throws(() => s.match('c', { a: () => 1, b: () => 2 }), TypeError);
    assert.throws(() => s.match('toString', { a: () => 1 }), TypeError);
  });
});

describe('attempt equals try / catch / finally, including the finally order', () => {
  const Plan = fc.record({ bodyThrows: fc.boolean(), hasRecover: fc.boolean(), recoverThrows: fc.boolean(), hasCleanup: fc.boolean(), cleanupThrows: fc.boolean(), value: prim });

  function native(plan, log) {
    const body = () => {
      log.push('body');
      if (plan.bodyThrows) throw new Error('body');
      return plan.value;
    };
    const recover = (e) => {
      log.push(`recover:${e.message}`);
      if (plan.recoverThrows) throw new Error('recover');
      return 'recovered';
    };
    const cleanup = () => {
      log.push('cleanup');
      if (plan.cleanupThrows) throw new Error('cleanup');
    };
    if (plan.hasRecover && plan.hasCleanup) {
      try {
        return body();
      } catch (e) {
        return recover(e);
      } finally {
        cleanup();
      }
    }
    if (plan.hasRecover) {
      try {
        return body();
      } catch (e) {
        return recover(e);
      }
    }
    if (plan.hasCleanup) {
      try {
        return body();
      } finally {
        cleanup();
      }
    }
    return body();
  }
  function viaAttempt(plan, log) {
    const body = () => {
      log.push('body');
      if (plan.bodyThrows) throw new Error('body');
      return plan.value;
    };
    const recover = (e) => {
      log.push(`recover:${e.message}`);
      if (plan.recoverThrows) throw new Error('recover');
      return 'recovered';
    };
    const cleanup = () => {
      log.push('cleanup');
      if (plan.cleanupThrows) throw new Error('cleanup');
    };
    return s.attempt(body, plan.hasRecover ? recover : undefined, plan.hasCleanup ? cleanup : undefined);
  }
  const run = (fn, plan) => {
    const log = [];
    try {
      return { value: fn(plan, log), log };
    } catch (e) {
      return { error: e.message, log };
    }
  };

  test('same result, same thrown error, same event order', () => {
    fc.assert(fc.property(Plan, (plan) => assert.deepStrictEqual(run(viaAttempt, plan), run(native, plan))), runs);
  });

  test('attemptAsync equals async try / catch / finally, awaiting cleanup last', async () => {
    await fc.assert(
      fc.asyncProperty(Plan, async (plan) => {
        const make = (log) => ({
          body: async () => {
            log.push('body');
            await null;
            if (plan.bodyThrows) throw new Error('body');
            return plan.value;
          },
          recover: async (e) => {
            log.push(`recover:${e.message}`);
            if (plan.recoverThrows) throw new Error('recover');
            return 'recovered';
          },
          cleanup: async () => {
            await null;
            log.push('cleanup');
            if (plan.cleanupThrows) throw new Error('cleanup');
          },
        });
        const settle = async (p, log) => p.then((value) => ({ value, log }), (e) => ({ error: e.message, log }));
        const a = [];
        const fa = make(a);
        const got = await settle(s.attemptAsync(fa.body, plan.hasRecover ? fa.recover : undefined, plan.hasCleanup ? fa.cleanup : undefined), a);
        const b = [];
        const fb = make(b);
        const want = await settle(
          (async () => {
            try {
              return await fb.body();
            } catch (e) {
              if (!plan.hasRecover) throw e;
              return await fb.recover(e);
            } finally {
              if (plan.hasCleanup) await fb.cleanup();
            }
          })(),
          b,
        );
        assert.deepStrictEqual(got, want);
      }),
      runs,
    );
  });

  test('fail throws exactly what it is given', () => {
    fc.assert(fc.property(prim, (v) => assert.throws(() => s.fail(v), (e) => Object.is(e, v))), runs);
  });
});

describe('loops are bounded', () => {
  test('iterateWhile rejects a missing or infinite limit', () => {
    for (const bad of [Infinity, -1, 1.5, NaN, undefined]) {
      assert.throws(() => s.iterateWhile(0, () => false, (x) => x, bad), RangeError);
    }
  });
  test('iterateWhile equals the state-threading while loop and throws at the limit', () => {
    fc.assert(
      fc.property(fc.integer({ min: -20, max: 20 }), fc.integer({ min: 0, max: 40 }), fc.integer({ min: 0, max: 40 }), (start, target, limit) => {
        let x = start;
        let n = 0;
        while (x < target && n < limit) {
          x++;
          n++;
        }
        if (x < target) assert.throws(() => s.iterateWhile(start, (v) => v < target, (v) => v + 1, limit), RangeError);
        else assert.equal(s.iterateWhile(start, (v) => v < target, (v) => v + 1, limit), x);
      }),
      runs,
    );
  });
});

describe('parseJson is JSON.parse as a Result', () => {
  test('ok exactly when JSON.parse succeeds, with the same value', () => {
    fc.assert(
      fc.property(fc.oneof(fc.json(), fc.string()), (text) => {
        let want;
        try {
          want = { ok: true, value: JSON.parse(text) };
        } catch (e) {
          want = { ok: false, name: e.constructor.name };
        }
        const got = s.parseJson(text);
        assert.deepStrictEqual(got.ok ? got : { ok: false, name: got.error.constructor.name }, want);
      }),
      runs,
    );
  });

  test('the catalog does not claim JSON.parse(text) for it (that form belongs to parseJsonOrThrow)', () => {
    const forms = (name) => catalog.atoms.find((a) => a.atom === name).js;
    assert.ok(!forms('parseJson').some((js) => /^JSON\.parse\(/.test(js)), forms('parseJson').join(' | '));
    assert.deepEqual(forms('parseJsonOrThrow'), ['JSON.parse(text, reviver)']);
  });
});

describe('sortedBy key forms', () => {
  test('a property name or a one-argument selector sorts by that key, stably, without touching the input', () => {
    fc.assert(
      fc.property(fc.array(fc.record({ id: fc.integer({ min: 0, max: 5 }), title: fc.string({ maxLength: 3 }) }), { maxLength: 8 }), (books) => {
        const before = JSON.stringify(books);
        const byTitle = (a, b) => (a.title < b.title ? -1 : a.title > b.title ? 1 : 0);
        assert.deepStrictEqual(s.sortedBy(books, 'title'), [...books].sort(byTitle));
        assert.deepStrictEqual(s.sortedBy(books, (b) => b.id), [...books].sort((a, b) => a.id - b.id));
        assert.equal(JSON.stringify(books), before);
      }),
      runs,
    );
  });
});

describe('time and randomness take their source as a parameter (R11)', () => {
  test('seededSource: the same seed gives the same sequence, always in [0, 1)', () => {
    fc.assert(
      fc.property(fc.integer(), (seed) => {
        const a = s.seededSource(seed);
        const b = s.seededSource(seed);
        for (let i = 0; i < 20; i++) {
          const x = a();
          assert.equal(x, b());
          assert.ok(x >= 0 && x < 1);
        }
        const r = s.seededSource(seed);
        const v = s.randomBetween(5, 10, r);
        assert.ok(v >= 5 && v < 10);
      }),
      runs,
    );
  });
});

describe('generated atoms checked by a dedicated property', () => {
  test('bindFunction(fn, thisArg, ...args) calls like fn.bind(thisArg, ...args)', () => {
    fc.assert(
      fc.property(gens.fn, prim, fc.array(prim, { maxLength: 3 }), fc.array(prim, { maxLength: 3 }), (fn, thisArg, bound, more) => {
        const viaAtom = s.bindFunction(fn, thisArg, ...bound);
        const native = fn.bind(thisArg, ...bound);
        assert.deepStrictEqual(viaAtom(...more), native(...more));
        assert.equal(viaAtom.length, native.length);
        assert.equal(viaAtom.name, native.name);
      }),
      runs,
    );
  });
  test('promiseFrom(executor) settles exactly like new Promise(executor)', async () => {
    await fc.assert(
      fc.asyncProperty(fc.boolean(), prim, fc.boolean(), async (resolves, value, throwsInstead) => {
        const executor = (resolve, reject) => {
          if (throwsInstead) throw new RangeError('executor');
          if (resolves) resolve(value);
          else reject(value);
        };
        const settle = (p) => p.then((v) => ({ v }), (e) => ({ e: e instanceof Error ? e.constructor.name : e }));
        assert.deepStrictEqual(await settle(s.promiseFrom(executor)), await settle(new Promise(executor)));
      }),
      runs,
    );
  });
});
