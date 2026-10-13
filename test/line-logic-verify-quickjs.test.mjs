// QuickJS backend of the isolated runner (logicVerify/quickjs/, isolatedRun.mjs `sandbox: 'quickjs'`): same results as
// the vm child on representative pairs, the escape set blocked, deterministic, and the runtime usable after a run hits
// a limit. The full vm-vs-QuickJS comparison is bench/isolation/quickjs/compare.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeTempDir } from '../test-utils/tmpdir.mjs';
import { isolatedPair, isolatedRun, SANDBOXES } from '../packages/engine/line/logicVerify/isolatedRun.mjs';
import { evalGuest, runQuickjsRequest } from '../packages/engine/line/logicVerify/quickjs/quickjsRun.mjs';
import { guestBootstrap } from '../packages/engine/line/logicVerify/quickjs/guest.mjs';
import { ESCAPES } from './fixtures/logic-verify/quickjs-escapes.mjs';

function pairRoots(beforeSrc, afterSrc, file = 'src/unit.ts') {
  const top = makeTempDir('lv-quickjs-test-');
  for (const [side, src] of [['before', beforeSrc], ['after', afterSrc]]) {
    fs.mkdirSync(path.join(top, side, path.dirname(file)), { recursive: true });
    fs.writeFileSync(path.join(top, side, file), src);
  }
  return { top, beforeRoot: path.join(top, 'before'), afterRoot: path.join(top, 'after') };
}
async function both(beforeSrc, afterSrc, fn = 'save', file = 'src/unit.ts') {
  const r = pairRoots(beforeSrc, afterSrc, file);
  try {
    const out = {};
    for (const sandbox of SANDBOXES) {
      const { ms, ...rest } = await isolatedPair({ beforeRoot: r.beforeRoot, afterRoot: r.afterRoot, before: { file, fn }, after: { file, fn }, sandbox });
      out[sandbox] = rest;
    }
    return out;
  } finally {
    fs.rmSync(r.top, { recursive: true, force: true });
  }
}

const SAVE = (method) => `export async function save(id: string, n: number): Promise<number> {
  localStorage.setItem('cart', id);
  const res = await fetch(\`/api/items/\${n}?q=\${id}\`, { method: '${method}', body: JSON.stringify({ id }) });
  setTimeout(() => console.log('saved', id, new Date().toISOString(), Math.random()), 100);
  return res.status + n * 2;
}`;
const HOOK = (step) => `import { useState, useEffect, useCallback } from 'react';
export function useCart(id: string) {
  const [count, setCount] = useState(0);
  useEffect(() => { localStorage.setItem('cart', id); return () => localStorage.removeItem('cart'); }, [id]);
  const add = useCallback(() => setCount((c) => c + ${step}), []);
  return { count, add };
}`;

test('quickjs: the default sandbox is still vm, and an unknown one is refused', async () => {
  assert.deepEqual(SANDBOXES, ['vm', 'quickjs']);
  const r = pairRoots('export function save() { return 1; }', 'export function save() { return 1; }');
  try {
    await assert.rejects(isolatedPair({ beforeRoot: r.beforeRoot, afterRoot: r.afterRoot, before: { file: 'src/unit.ts', fn: 'save' }, after: { file: 'src/unit.ts', fn: 'save' }, sandbox: /** @type {any} */ ('node') }), /unknown sandbox node/);
  } finally {
    fs.rmSync(r.top, { recursive: true, force: true });
  }
});

test('quickjs: the same LayerResult as the vm child on equal, divergent, hook and coverage pairs', async () => {
  for (const [b, a, fn, file] of [
    [SAVE('POST'), SAVE('POST')], [SAVE('POST'), SAVE('PUT')],
    ['export function save(a: number, b: number) { return a + b; }', 'export function save(a: number, b: number) { return a - b; }'],
    [HOOK(1), HOOK(2), 'useCart', 'src/unit.tsx'],
    ['export function save(id: string) { if (id) { localStorage.setItem(id, "1"); return 1; } return 0; }', 'export function save(id: string) { if (id) { localStorage.setItem(id, "1"); return 1; } return 0; }'],
  ]) {
    const r = await both(b, a, fn, file);
    assert.deepEqual(r.quickjs, r.vm, `${fn ?? 'save'}: ${r.vm.outcome}`);
  }
});

test('quickjs: the fakes are sliced from isolatedChild.cjs, not copied', () => {
  const src = guestBootstrap();
  const child = fs.readFileSync(new URL('../packages/engine/line/logicVerify/isolatedChild.cjs', import.meta.url), 'utf8');
  const fakes = child.slice(child.indexOf('function createFakes'), child.indexOf('const SPY_EFFECTS'));
  assert.ok(src.includes(fakes.trim()), 'createFakes is the vm child\'s own text');
  assert.doesNotMatch(src, /require\(['"]node:/, 'no node module in the guest');
});

test('quickjs: every escape attempt is blocked and nothing leaks into the host or the next run', async () => {
  const root = makeTempDir('lv-quickjs-esc-');
  const marker = path.join(root, 'MARKER');
  const run = async (src) => { fs.writeFileSync(path.join(root, 'unit.ts'), src); return isolatedRun({ root, unit: { file: 'unit.ts', fn: 'save' }, cases: [[]], sandbox: 'quickjs', timeoutMs: 3000 }); };
  try {
    for (const e of ESCAPES(marker)) {
      const r = await run(e.src);
      const got = r.error ? 'error' : r.runs[0].notFaked.length ? 'notFaked' : `thrown:${r.runs[0].thrown ?? 'none'}`;
      assert.equal(got, e.expect, `${e.id}: ${r.error ?? JSON.stringify(r.runs)}`);
      if (e.valueExpect) assert.equal(r.runs[0].value, e.valueExpect, e.id);
      if (e.after) assert.equal((await run(e.after)).runs[0].value, e.afterExpect, `${e.id}: the next run is clean`);
      assert.equal(fs.existsSync(marker), false, `${e.id}: the host file was never written`);
      assert.equal(/** @type {any} */ ({}).polluted, undefined, `${e.id}: the host prototypes are untouched`);
    }
    // the runtime still works after the time limit and the memory limit
    assert.equal((await run('export function save() { return 6 * 7; }')).runs[0].value, 42);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('quickjs: 20 runs of the same request give one result', async () => {
  const r = pairRoots(SAVE('POST'), SAVE('PUT'));
  try {
    const seen = new Set();
    for (let i = 0; i < 20; i++) {
      const { ms, ...rest } = await isolatedPair({ beforeRoot: r.beforeRoot, afterRoot: r.afterRoot, before: { file: 'src/unit.ts', fn: 'save' }, after: { file: 'src/unit.ts', fn: 'save' }, sandbox: 'quickjs' });
      seen.add(JSON.stringify(rest));
    }
    assert.equal(seen.size, 1);
  } finally {
    fs.rmSync(r.top, { recursive: true, force: true });
  }
});

test('quickjs: a unit that never settles reads as "never settled", as on the vm path', async () => {
  const side = { entry: 'u.js', fn: 'save', modules: { 'u.js': 'exports.__lineUnit = function save() { return new Promise(() => {}); };' }, resolved: { 'u.js': {} }, missing: { 'u.js': [] }, blocks: 0, runAs: 'function' };
  const out = await runQuickjsRequest({ env: { now: '2026-01-15T10:00:00.000Z', seed: 42, locale: 'en-US', timeZone: 'UTC' }, cases: [[]], before: side, after: side }, 1000);
  assert.deepEqual(out, { timedOut: false, code: 0, stdout: '', stderr: '' });
});

test('quickjs: evalGuest runs a bare script with no host globals and awaits a promise', async () => {
  const r = await evalGuest('[typeof process, typeof require, typeof fetch, typeof setTimeout, typeof console].join()');
  assert.deepEqual(r.value, 'undefined,undefined,undefined,undefined,undefined');
  assert.equal((await evalGuest('Promise.resolve(1).then((x) => ({ x: x + 1 }))')).value.x, 2);
  const loop = await evalGuest('for (;;) {}', { timeoutMs: 200 });
  assert.equal(loop.timedOut, true);
});
