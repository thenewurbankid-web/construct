// Tests for the probe (bench/atoms/equivalence.js probe, converter.probe in bench/atoms/checked.js): one function run on
// its own in QuickJS, recording what it touches. The runtime is a hand-written stand-in, as in atoms-checked.test.js.
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { compileCatalog } = require('./atoms-catalog');
const { createSandbox } = require('./bench/atoms/equivalence');
const { createCheckedConverter } = require('./bench/atoms/checked');

const BUNDLE = 'globalThis.__smith = { plus: (a, b) => a + b };';

describe('the probe', () => {
  let sandbox;
  before(async () => { sandbox = await createSandbox({ bundle: BUNDLE }); });
  after(() => sandbox.dispose());

  test('a pure function touches nothing outside on any run', () => {
    const r = sandbox.probe('function total(a: number, b: number) { return a + b; }', { runs: 10, seed: 3 });
    assert.equal(r.status, 'ran');
    assert.equal(r.runs, 10);
    assert.equal(r.exercised, 10);
    assert.equal(r.threw, 0);
    assert.deepEqual(r.outside, []);
    assert.deepEqual(r.effects, { calls: [], writes: [], deletes: [], reads: [] });
  });

  test('a write to a parameter is seen, on a stub and on a generated value', () => {
    const real = sandbox.probe('function bump(o: { n: number }) { o.n = o.n + 1; return o.n; }', { runs: 10, seed: 3 });
    assert.deepEqual(real.effects.writes, ['arg0']);
    const stubbed = sandbox.probe('function tag(o) { o.seen = true; delete o.old; return o; }', { runs: 10, seed: 3 });
    assert.ok(stubbed.effects.writes.includes('arg0.seen'));
    assert.ok(stubbed.effects.deletes.includes('arg0.old'));
  });

  test('a call to an outside name is a call, with its path; module state written is a write', () => {
    const io = sandbox.probe('async function load(id: string) { const r = await fetch("/api/" + id); return r.json(); }', { runs: 10, seed: 3 });
    assert.deepEqual(io.outside, ['fetch']);
    assert.ok(io.effects.calls.includes('fetch'));
    const flow = sandbox.probe('function checkout(cart) { const t = totalOf(cart); saveOrder(t); return t; }', { runs: 10, seed: 3 });
    assert.deepEqual(flow.effects.calls, ['saveOrder', 'totalOf']);
    const state = sandbox.probe('function next() { counter.value = counter.value + 1; return counter.value; }', { runs: 10, seed: 3 });
    assert.deepEqual(state.effects.writes, ['counter.value']);
    assert.deepEqual(state.effects.reads, ['counter.value']);
  });

  test('a hook is an outside call; a generator or code that does not parse is not runnable', () => {
    const hook = sandbox.probe('function useCount() { const [n] = useState(0); return n; }', { runs: 5, seed: 1 });
    assert.equal(hook.status, 'ran');
    assert.deepEqual(hook.effects.calls, ['useState']);
    assert.equal(sandbox.probe('function* g() { yield 1; }').status, 'not-runnable');
    const bad = sandbox.probe('function (', {});
    assert.equal(bad.status, 'not-runnable');
    assert.match(bad.why, /^cannot prepare/);
  });

  test('hooks: observable runs hooks as stand-ins: a useEffect that fetches is a call to fetch; hooks leave `outside`', () => {
    const code = 'function useUser(id: string) { const [u, setU] = useState(null); useEffect(() => { fetch("/u/" + id).then(setU); }, [id]); return u; }';
    const r = sandbox.probe(code, { runs: 5, seed: 1, hooks: 'observable' });
    assert.equal(r.status, 'ran');
    assert.deepEqual(r.outside, ['fetch']);
    assert.deepEqual(r.hooks, ['useEffect', 'useState']);
    assert.ok(r.effects.calls.includes('fetch'));
    assert.ok(!r.effects.calls.some((c) => /^use/.test(c)));
    // off (the default), the same hook is outside calls only, and the effect never runs
    const off = sandbox.probe(code, { runs: 5, seed: 1 });
    assert.deepEqual(off.outside, ['fetch', 'useEffect', 'useState']);
    assert.equal(off.hooks, undefined);
    assert.ok(!off.effects.calls.includes('fetch'));
  });

  test('hooks: a pure useMemo, useCallback and useRef touch nothing outside', () => {
    const r = sandbox.probe('function useTotal(items: number[]) { const t = useMemo(() => items.reduce((a, b) => a + b, 0), [items]); const f = useCallback((x) => x + t, [t]); const ref = useRef(0); ref.current = t; return f(1); }', { runs: 8, seed: 2, hooks: 'observable' });
    assert.equal(r.exercised, 8);
    assert.deepEqual(r.outside, []);
    assert.deepEqual(r.effects, { calls: [], writes: [], deletes: [], reads: [] });
  });

  test('hooks: a setter is fired with a generated value, so an effect that waits on its state is seen; cleanups run', () => {
    const saved = sandbox.probe('function useQuery() { const [q, setQ] = useState(""); useEffect(() => { if (q) localStorage.setItem("q", q); }, [q]); return [q, setQ]; }', { runs: 8, seed: 3, hooks: 'observable' });
    assert.deepEqual(saved.effects.calls, ['localStorage.setItem']);
    const cleaned = sandbox.probe('function useTick() { useEffect(() => { const t = setInterval(tick, 10); return () => clearInterval(t); }, []); return 1; }', { runs: 3, seed: 1, hooks: 'observable' });
    assert.deepEqual(cleaned.effects.calls, ['clearInterval', 'setInterval']);
    const reduced = sandbox.probe('function useCount() { const [n, add] = useReducer((s, a) => s + 1, 0); useLayoutEffect(() => { if (n) document.title = String(n); }); return n; }', { runs: 3, seed: 1, hooks: 'observable' });
    assert.deepEqual(reduced.effects.writes, ['document.title'], 'a dispatch runs the reducer, and the new state re-runs the effect');
    const late = sandbox.probe('function useLate() { const [v, setV] = useState(0); useEffect(() => { (async () => { setV(await load()); })(); }, []); useEffect(() => { if (v) track(v); }, [v]); return v; }', { runs: 5, seed: 1, hooks: 'observable' });
    assert.ok(late.effects.calls.includes('track'), 'a state set after an await re-renders on the next microtask');
    const loop = sandbox.probe('function useLoop() { const [n, setN] = useState(0); useEffect(() => { setN(n + 1); }); return n; }', { runs: 3, seed: 1, hooks: 'observable' });
    assert.deepEqual([loop.status, loop.exercised, loop.timeouts], ['ran', 3, 0], 'an effect that sets state on every render stops at the render cap');
    assert.equal(sandbox.probe('function f() { return 1; }', { hooks: 'react' }).status, 'not-runnable');
  });

  test('the same seed gives the same evidence', () => {
    const code = 'function pick(o) { return o.a ? send(o.b) : o.c; }';
    assert.deepEqual(sandbox.probe(code, { runs: 8, seed: 9 }), sandbox.probe(code, { runs: 8, seed: 9 }));
  });

  test('checkPair is unchanged by the probe: reads are not part of a pair\'s trace', () => {
    sandbox.probe('function f() { cfg.a; return 1; }', { runs: 5 });
    const r = sandbox.checkPair({ original: 'function f() { cfg.a; return 1; }', converted: 'function f() { return 1; }', runs: 10 });
    assert.equal(r.status, 'same');
    const w = sandbox.checkPair({ original: 'function f() { cfg.a = 1; return 1; }', converted: 'function f() { return 1; }', runs: 10 });
    assert.equal(w.status, 'different');
  });
});

test('the checked converter exposes the probe on its own sandbox', async () => {
  const compiled = compileCatalog([{ atom: 'plus', js: ['a + b'], params: ['a', 'b'], firstKinds: ['number'] }]);
  const c = await createCheckedConverter({ compiled, bundle: BUNDLE });
  try {
    const r = c.probe('function send(x) { return post(x); }', { runs: 5 });
    assert.equal(r.status, 'ran');
    assert.deepEqual(r.effects.calls, ['post']);
  } finally { c.dispose(); }
});
