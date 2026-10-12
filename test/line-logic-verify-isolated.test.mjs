// Line logic verification step 4: the isolated effect runner (logicVerify/isolatedRun.mjs, isolatedChild.cjs) behind
// verifyPair's RUNNERS.isolated. Each pair runs in a child-process sandbox under the recording fakes.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeTempDir } from '../test-utils/tmpdir.mjs';
import { fileURLToPath } from 'node:url';
import { isolatedPair, isolatedCases, runAsOf } from '../packages/engine/line/logicVerify/isolatedRun.mjs';
import { RUNNERS } from '../packages/engine/line/logicVerify/verifyPair.mjs';
import { assertLayerResult } from '../packages/engine/line/logicVerify/contract.mjs';
import { instrumentUnit, branchCoverage, coverageLevel } from '../packages/engine/line/logicVerify/instrument.mjs';
import { ts } from '@construct/ast/lazy';

/** Two app roots holding one file each; removed by the caller. */
function pairRoots(beforeSrc, afterSrc, file = 'src/unit.ts') {
  const top = makeTempDir('lv-isolated-test-');
  for (const [side, src] of [['before', beforeSrc], ['after', afterSrc]]) {
    fs.mkdirSync(path.join(top, side, path.dirname(file)), { recursive: true });
    fs.writeFileSync(path.join(top, side, file), src);
  }
  return { top, beforeRoot: path.join(top, 'before'), afterRoot: path.join(top, 'after'), unit: { file, fn: 'save' } };
}

async function verify(beforeSrc, afterSrc, opts = {}) {
  const r = pairRoots(beforeSrc, afterSrc);
  try {
    const result = await isolatedPair({ beforeRoot: r.beforeRoot, afterRoot: r.afterRoot, before: r.unit, after: r.unit, ...opts });
    assertLayerResult(result);
    return result;
  } finally {
    fs.rmSync(r.top, { recursive: true, force: true });
  }
}

const SAVE = (method, extra = '') => `
import { useRouter } from 'next/navigation';
import { formatKey } from './key';
export async function save(id: string, n: number): Promise<number> {
  localStorage.setItem(formatKey('cart'), id);
  const res = await fetch(\`/api/items/\${n}?q=\${id}\`, { method: '${method}', body: JSON.stringify({ id }) });
  setTimeout(() => console.log('saved', id), 100);
  ${extra}
  return res.status + n * 2;
}
`;
const KEY = "export const formatKey = (k: string) => `app.${k}`;\n";

test('isolated: an equal pair is same-behaviour (effects recorded, relative import loaded)', async () => {
  const r = pairRoots(SAVE('POST'), SAVE('POST'));
  fs.writeFileSync(path.join(r.beforeRoot, 'src/key.ts'), KEY);
  fs.writeFileSync(path.join(r.afterRoot, 'src/key.ts'), KEY);
  try {
    const result = await isolatedPair({ beforeRoot: r.beforeRoot, afterRoot: r.afterRoot, before: r.unit, after: r.unit });
    assert.equal(result.outcome, 'same-behaviour', result.reason);
    assert.equal(result.layer, 'isolated');
  } finally {
    fs.rmSync(r.top, { recursive: true, force: true });
  }
});

test('isolated: a divergent pair is changed, with the recorded difference, the input and a location', async () => {
  const r = pairRoots(SAVE('POST'), SAVE('PUT'));
  fs.writeFileSync(path.join(r.beforeRoot, 'src/key.ts'), KEY);
  fs.writeFileSync(path.join(r.afterRoot, 'src/key.ts'), KEY);
  try {
    const result = await isolatedPair({ beforeRoot: r.beforeRoot, afterRoot: r.afterRoot, before: r.unit, after: r.unit });
    assert.equal(result.outcome, 'changed');
    assert.match(String(result.reason), /^effect 2 was fetch POST \/api\/items\/:id\?q=\(string\) before and fetch PUT \/api\/items\/:id\?q=\(string\) after$/);
    assert.deepEqual(result.input, ['__line_0000002a_0__', 0], 'the generated input of the first diverging case');
    assert.equal(result.location?.file, 'src/unit.ts');
  } finally {
    fs.rmSync(r.top, { recursive: true, force: true });
  }
});

test('isolated: a different return value under the same effects is changed', async () => {
  const src = (op) => `export function save(a: number, b: number) { return a ${op} b; }`;
  const result = await verify(src('+'), src('-'));
  assert.equal(result.outcome, 'changed');
  assert.match(String(result.reason), /^the output (value )?was /);
});

test('isolated: an unfaked effect is reported and never executed', async () => {
  const marker = path.join(os.tmpdir(), `construct-lv-isolated-marker-${process.pid}`);
  fs.rmSync(marker, { force: true });
  const viaImport = `import fs from 'node:fs';\nexport function save(x: string) { fs.writeFileSync(${JSON.stringify(marker)}, x); return 1; }`;
  const viaGlobal = `export function save(x: string) { const ws = new WebSocket('ws://example.invalid'); ws.send(x); return 1; }`;
  const viaProcess = `export function save(x: string) { return (process as any).mainModule.require('node:fs').writeFileSync(${JSON.stringify(marker)}, x); }`;
  for (const [src, what] of [[viaImport, 'import node:fs'], [viaGlobal, 'WebSocket'], [viaProcess, 'process']]) {
    const result = await verify(src, src);
    assert.equal(result.outcome, 'cant-tell', what);
    assert.match(String(result.reason), new RegExp(`not faked, so not executed: .*${what}`));
  }
  assert.equal(fs.existsSync(marker), false, 'the unfaked write never ran');
});

test('isolated: a hanging unit is killed by the time limit', async () => {
  const src = 'export function save(n: number) { while (true) { n++; } }';
  const t0 = Date.now();
  const result = await verify(src, src, { timeoutMs: 800 });
  assert.equal(result.outcome, 'cant-tell');
  assert.match(String(result.reason), /killed at the 800 ms time limit/);
  assert.ok(Date.now() - t0 < 5000);
});

test('isolated: the sandbox leaves no temp dir behind and time and random are fixed', async () => {
  // A private TMPDIR (os.tmpdir() reads it per call): other test files running isolated pairs at the same time
  // create their own construct-lv-isolated-* dirs in the shared temp dir, which this check must not see.
  const own = makeTempDir('construct-lv-isolated-test-');
  const saved = process.env.TMPDIR;
  process.env.TMPDIR = own;
  try {
    const src = 'export function save() { return `${new Date().toISOString()} ${Math.random()}`; }';
    assert.equal((await verify(src, src)).outcome, 'same-behaviour');
    assert.deepEqual(fs.readdirSync(own), []);
  } finally {
    if (saved === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = saved;
    fs.rmSync(own, { recursive: true, force: true });
  }
});

test('isolated: cases are deterministic and carry sentinels', () => {
  assert.deepEqual(isolatedCases([]), [[]]);
  const a = isolatedCases(['id', 'n'], { byParam: { n: [7] } });
  assert.deepEqual(a, isolatedCases(['id', 'n'], { byParam: { n: [7] } }));
  assert.ok(a.some((c) => c[1] === 7), 'a mined literal is used');
  assert.match(String(a[0][0]), /^__line_0000002a_0__$/);
});

test('isolated: the planted dropped-effect fixture gives the expected isolated layer result (app imports are spies)', async () => {
  const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/logic-verify');
  const c = JSON.parse(fs.readFileSync(path.join(FIX, 'cases.json'), 'utf8')).find((x) => x.name === 'dropped-effect');
  const { ms, reason, runAs, coverage, ...got } = await isolatedPair({ beforeRoot: path.join(FIX, c.name, 'before'), afterRoot: path.join(FIX, c.name, 'after'), before: c.before, after: c.before });
  assert.ok(typeof ms === 'number' && ms >= 0);
  assert.equal(runAs, 'function');
  assert.ok(coverage?.before && coverage.after, 'both sides of the planted fixture are measured');
  assert.deepEqual(got, c.layerResults.find((r) => r.layer === 'isolated'));
  assert.equal(reason, 'effect 2 was toast.success(string) before and nothing after');
});

test('isolated: verifyPair RUNNERS.isolated runs the effect runner for a non-layout unit', async () => {
  const r = pairRoots('export function save(k: string) { sessionStorage.setItem(k, "1"); }', 'export function save(k: string) { sessionStorage.removeItem(k); }');
  try {
    const result = await RUNNERS.isolated?.({
      beforeRoot: r.beforeRoot, afterRoot: r.afterRoot, unit: /** @type {any} */ (r.unit), before: r.unit, after: r.unit,
      beforeSource: null, afterSource: null, transforms: null, extracted: false, results: [],
    });
    assert.equal(result?.outcome, 'changed', result?.reason);
    assert.match(String(result?.reason), /storage\.setItem .* before and storage\.removeItem/);
  } finally {
    fs.rmSync(r.top, { recursive: true, force: true });
  }
});

// #877: hooks under the headless hook harness, handlers with a generated event (branch coverage: #883)

/** isolatedPair on one before/after source pair for the unit `fn`. */
async function verifyFn(fn, beforeSrc, afterSrc) {
  const r = pairRoots(beforeSrc, afterSrc, 'src/unit.tsx');
  try {
    const unit = { file: 'src/unit.tsx', fn };
    const result = await isolatedPair({ beforeRoot: r.beforeRoot, afterRoot: r.afterRoot, before: unit, after: unit });
    assertLayerResult(result);
    return result;
  } finally {
    fs.rmSync(r.top, { recursive: true, force: true });
  }
}

const HOOK = (step, effect = "localStorage.setItem('cart', id);") => `
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
export function useCart(id: string) {
  const [count, setCount] = useState(0);
  const renders = useRef(0);
  renders.current += 1;
  useEffect(() => { ${effect} return () => localStorage.removeItem('cart'); }, [id]);
  const label = useMemo(() => \`\${id}:\${count}\`, [id, count]);
  const add = useCallback(() => setCount((c) => c + ${step}), []);
  return { count, label, add };
}
`;

test('isolated hook: an equal useX pair runs under the hook harness and is same-behaviour', async () => {
  const result = await verifyFn('useCart', HOOK(1), HOOK(1));
  assert.equal(result.runAs, 'hook');
  assert.equal(result.outcome, 'same-behaviour', result.reason);
});

test('isolated hook: a divergent state update is changed, with the hook result that differs', async () => {
  const result = await verifyFn('useCart', HOOK(1), HOOK(2));
  assert.equal(result.runAs, 'hook');
  assert.equal(result.outcome, 'changed');
  assert.match(String(result.reason), /^the output value was \{"count":1,.*"add":"fn"\} before and \{"count":2,.*"add":"fn"\} after$/);
  assert.equal(result.location?.file, 'src/unit.tsx');
});

test('isolated hook: a dropped effect inside useEffect is changed, named by the recorded effect', async () => {
  const result = await verifyFn('useCart', HOOK(1), HOOK(1, ''));
  assert.equal(result.outcome, 'changed');
  assert.match(String(result.reason), /^effect 1 was storage\.setItem cart\(string\) before and storage\.removeItem cart after$/);
});

const HANDLER = (body) => `
import type React from 'react';
export function handleKey(e: React.KeyboardEvent<HTMLInputElement>) {
  ${body}
  if (e.key === 'Enter') sessionStorage.setItem('q', e.target.value);
}
`;

test('isolated handler: an equal handler pair runs with a generated event and is same-behaviour', async () => {
  const result = await verifyFn('handleKey', HANDLER('e.preventDefault();'), HANDLER('e.preventDefault();'));
  assert.equal(result.runAs, 'handler');
  assert.equal(result.outcome, 'same-behaviour', result.reason);
});

test('isolated handler: a dropped preventDefault is changed, with the generated event as the input', async () => {
  const result = await verifyFn('handleKey', HANDLER('e.preventDefault();'), HANDLER(''));
  assert.equal(result.runAs, 'handler');
  assert.equal(result.outcome, 'changed');
  assert.deepEqual(result.input, [{ __lineEvent: 'keydown', variant: 0 }]);
  assert.match(String(result.reason), /^effect 1 was event\.preventDefault before and storage\.setItem q\(string\) after$/);
});

test('isolated: runAsOf classifies hooks, handlers and plain functions', () => {
  const fn = (params) => ({ params });
  const ev = { type: 'Identifier', name: 'e', typeAnnotation: { typeAnnotation: { type: 'TSTypeReference', typeName: { type: 'TSQualifiedName', right: { name: 'ChangeEvent' } } } } };
  assert.equal(runAsOf('useCart', fn([])), 'hook');
  assert.equal(runAsOf('onSubmit', fn([{ type: 'Identifier', name: 'e' }])), 'handler');
  assert.equal(runAsOf('apply', fn([ev])), 'handler');
  assert.equal(runAsOf('handleClick', fn([])), 'function');
  assert.equal(runAsOf('total', fn([{ type: 'Identifier', name: 'n' }])), 'function');
});

test('isolated: the sandboxed child keeps the hook runner\'s flags and env: no --allow-inspector, no fs writes, no NODE_V8_COVERAGE (#883)', () => {
  const src = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../packages/engine/line/logicVerify/isolatedRun.mjs'), 'utf8');
  const at = src.indexOf('spawn(process.execPath');
  const spawnCall = src.slice(at, src.indexOf("stdio: ['ignore', 'pipe', 'pipe'] })", at));
  const spawnArgs = spawnCall.slice(0, spawnCall.indexOf('], {'));
  assert.ok(spawnArgs.includes("'--permission'"), 'the spawn arguments were found');
  assert.ok(!spawnArgs.includes('allow-inspector'), spawnArgs);
  // the hook runner's flags (#877), unchanged
  assert.equal(spawnArgs.replace(/\s+/g, ' ').trim(), "spawn(process.execPath, [ '--permission', `--allow-fs-read=${CHILD}`, `--allow-fs-read=${RECORDER}`, `--allow-fs-read=${dir}`, '--disallow-code-generation-from-strings', '--max-old-space-size=256', CHILD,");
  const env = spawnCall.slice(spawnCall.indexOf('env: {'));
  assert.equal(env.slice(0, env.indexOf('}') + 1), "env: { HOME: dir, TMPDIR: dir, TZ: FAKE_ENV.timeZone, LANG: 'C' }");
});

/** Instrument `src` for `fn` and return the emitted code and the block count. */
function instrumented(src, fn) {
  const cov = instrumentUnit(fn);
  const code = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }, transformers: { before: [cov.transformer] } }).outputText;
  return { code, blocks: cov.blocks() };
}

test('coverage: the instrumenter counts the unit\'s blocks only and keeps its values', () => {
  const src = `export function other(x: number) { return x ? 1 : 2; }
export const save = (n: number, s?: string) => {
  if (n > 1) { return (s ?? 'd') + [n].map((v) => v * 2).join(); }
  switch (n) { case 0: return 'zero'; default: break; }
  try { return n || 'none'; } catch { return 'e'; }
};`;
  const { code, blocks } = instrumented(src, 'save');
  // body, then, implicit else, ??, arrow, case, default, ||, catch
  assert.equal(blocks, 9);
  assert.ok(!/__lineCov/.test(code.slice(code.indexOf('function other'), code.indexOf('const save'))), 'other is not instrumented');
  const mod = { exports: {} };
  new Function('exports', 'module', code)(mod.exports, mod);
  const save = mod.exports.save;
  assert.deepEqual([save(2), save(2, 'x'), save(0), save(1)], ['d4', 'x4', 'zero', 1]);
  assert.equal(mod.exports.__lineCov.length, blocks);
  const hits = mod.exports.__lineCov.map((c) => (c > 0 ? 1 : 0));
  assert.deepEqual(branchCoverage([hits], blocks), { covered: blocks - 2, total: blocks }, 'the || fallback and the catch never ran');
  assert.equal(instrumented(src, 'missing').blocks, 0);
  assert.equal(branchCoverage([[1]], 0), null);
  assert.equal(coverageLevel({ covered: 4, total: 4 }, { covered: 2, total: 2 }), 'full');
  assert.equal(coverageLevel({ covered: 3, total: 4 }, { covered: 2, total: 2 }), 'partial');
  assert.equal(coverageLevel({ covered: 1, total: 4 }, { covered: 2, total: 2 }), 'low');
  assert.equal(coverageLevel(null, { covered: 2, total: 2 }), 'unavailable');
});

test('coverage: a unit pair whose branches all run reports full coverage per side', async () => {
  const unit = 'export function save(id: string) { if (id) { localStorage.setItem(id, "1"); return 1; } return 0; }';
  const r = await verify(unit, unit);
  assert.equal(r.outcome, 'same-behaviour');
  assert.deepEqual(r.coverage, { before: { covered: 3, total: 3 }, after: { covered: 3, total: 3 }, level: 'full' });
  assert.equal(r.reason, undefined);
});

test('coverage: a same-behaviour verdict over branches that never ran says low coverage in its reason', async () => {
  const unit = `export function save(n: number) {
  switch (n) { case 7: return 'a'; case 8: return 'b'; case 9: return 'c'; case 10: return 'd'; case 11: return 'e'; case 12: return 'f'; }
  return 'z';
}`;
  const r = await verify(unit, unit);
  assert.equal(r.outcome, 'same-behaviour');
  assert.equal(r.coverage?.level, 'low');
  assert.deepEqual(r.coverage?.before, { covered: 1, total: 7 });
  assert.equal(r.reason, 'low branch coverage (before 1 of 7 blocks ran, after 1 of 7)');
});

test('coverage: a hook pair is measured under the hook harness, each side counted on its own blocks', async () => {
  const before = "import { useState } from 'react';\nexport function useCounter() { const [n, setN] = useState(0); return { n, inc: () => setN(n + 1) }; }";
  const after = "import { useState } from 'react';\nexport function useCounter() { const [n, setN] = useState(0); return { n, inc: () => setN((v) => v + 1) }; }";
  const r = pairRoots(before, after);
  try {
    const unit = { file: r.unit.file, fn: 'useCounter' };
    const result = await isolatedPair({ beforeRoot: r.beforeRoot, afterRoot: r.afterRoot, before: unit, after: unit });
    assertLayerResult(result);
    assert.equal(result.runAs, 'hook');
    assert.deepEqual(result.coverage, { before: { covered: 2, total: 2 }, after: { covered: 3, total: 3 }, level: 'full' });
  } finally {
    fs.rmSync(r.top, { recursive: true, force: true });
  }
});

test('coverage: assertLayerResult refuses a malformed coverage field', () => {
  assert.throws(() => assertLayerResult({ layer: 'isolated', outcome: 'same-behaviour', coverage: { before: { covered: 3, total: 2 }, after: null, level: 'partial' } }), /before coverage/);
  assert.throws(() => assertLayerResult({ layer: 'isolated', outcome: 'same-behaviour', coverage: { before: null, after: null, level: 'most' } }), /coverage level/);
  assertLayerResult({ layer: 'isolated', outcome: 'same-behaviour', coverage: { before: null, after: null, level: 'unavailable' } });
});
