// Line logic verification step 4: the isolated effect runner (logicVerify/isolatedRun.mjs, isolatedChild.cjs) behind
// verifyPair's RUNNERS.isolated. Each pair runs in a child-process sandbox under the recording fakes.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeTempDir } from '../test-utils/tmpdir.mjs';
import { fileURLToPath } from 'node:url';
import { isolatedPair, isolatedCases, runAsOf, COVERAGE_SUPPORTED } from '../packages/engine/line/logicVerify/isolatedRun.mjs';
import { RUNNERS } from '../packages/engine/line/logicVerify/verifyPair.mjs';
import { assertLayerResult } from '../packages/engine/line/logicVerify/contract.mjs';

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
  assert.ok(coverage, 'the result carries branch coverage');
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

// #877: hooks under the headless hook harness, handlers with a generated event, V8 branch coverage per side

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

test('isolated coverage: each side carries V8 branch coverage, and low coverage is reported in the reason', async (t) => {
  if (!COVERAGE_SUPPORTED) { t.skip('this node has no --allow-inspector'); return; }
  const full = 'export function save(n: number) { if (n > 0) { return 1; } return 2; }';
  const r1 = await verifyFn('save', full, full);
  assert.equal(r1.outcome, 'same-behaviour');
  assert.equal(r1.coverage?.level, 'full', JSON.stringify(r1.coverage));
  assert.ok((r1.coverage?.before?.total ?? 0) > 0);
  assert.deepEqual(r1.coverage?.before, r1.coverage?.after);
  assert.equal(r1.reason, undefined);
  const low = 'export function save(n: number) { if (n === 123457) { return 1; } if (n === 98765) { return 2; } if (n === 31337) { return 3; } return 0; }';
  const r2 = await verifyFn('save', low, low);
  assert.equal(r2.outcome, 'same-behaviour');
  assert.equal(r2.coverage?.level, 'low');
  assert.ok((r2.coverage?.before?.covered ?? 0) < (r2.coverage?.before?.total ?? 0));
  assert.match(String(r2.reason), /^low branch coverage \(before \d+ of \d+ blocks, after \d+ of \d+\)$/);
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
