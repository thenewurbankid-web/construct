// G2, Line's runtime call graph (packages/engine/line/graph/runtime/): a recorder that instruments the files under test
// at load time and records caller -> callee with argument and return SHAPES (never values), fetch calls by URL pattern
// and state writes by key; mergeRuntime turns the records into CALLED_AT_RUNTIME edges with the test as evidence and
// flags the logic-map units no test reached. Two mechanisms: jest (a transform wrapper + setupFilesAfterEnv, through
// withRuntimeRecorder) and plain node (module.registerHooks, register.mjs). The jest part needs a node_modules with jest,
// ts-jest, jsdom and React (test-utils/jestHome.mjs) and is skipped, with the reason, without one.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeTempDir } from '../test-utils/tmpdir.mjs';
import { jestHome, linkJestHome, NO_JEST_HOME } from '../test-utils/jestHome.mjs';
import { buildLogicMap } from '../packages/engine/line/logicMap.mjs';
import {
  shapeOf, urlPattern, mergeRuntime, runtimeCoverage, withRuntimeRecorder, readRuntimeRecords, resolveRef, unitNodeId,
  REGISTER_PATH, RUNTIME_LAYER,
} from '../packages/engine/line/graph/runtime/index.mjs';
import { createRecorder } from '../packages/engine/line/graph/runtime/recorder.cjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CHAR_APP = path.join(HERE, 'fixtures/line-char-app');
const NODE_APP = path.join(HERE, 'fixtures/line-graph-runtime-node');

/** A logic-map unit by file, kind and a detail substring. */
function unitOf(map, file, kind, detail) {
  const u = map.units.find((x) => x.file === file && x.kind === kind && x.detail.includes(detail));
  assert.ok(u, `no ${kind} unit "${detail}" in ${file}: ${map.units.filter((x) => x.file === file).map((x) => `${x.kind} ${x.detail}`).join(' | ')}`);
  return u;
}
const id = (u) => unitNodeId(u);
/** The graph nodes G1 would hold for a map's units (mirror of graph/contract.mjs: unit:<fingerprint>). */
const graphOf = (map) => ({ nodes: map.units.map((u) => ({ id: id(u), kind: 'unit', label: `${u.kind} in ${u.fn}`, file: u.file, line: u.line, hash: `sha256:${u.fingerprint}`, attrs: { unitKind: u.kind } })), edges: [] });
const pairs = (edges) => [...new Set(edges.map((e) => `${e.from} -> ${e.to}`))].sort();

// ---------------------------------------------------------------------------------------------------------------
// Pure parts

test('shapeOf: type tags and keys, never values', () => {
  assert.equal(shapeOf('Zebra Lamp'), 'string');
  assert.equal(shapeOf(1234), 'number');
  assert.equal(shapeOf(null), 'null');
  assert.equal(shapeOf(undefined), 'undefined');
  assert.equal(shapeOf(() => 1), 'fn');
  assert.equal(shapeOf(Promise.resolve(1)), 'promise');
  assert.equal(shapeOf({ name: 'Zebra Lamp', price: 1234, tags: ['a', 'b'] }), '{name:string,price:number,tags:string[]}');
  assert.equal(shapeOf([{ id: 'zq9' }, { id: 'zq8', extra: true }]), '({id:string}|{extra:boolean,id:string})[]');
  assert.equal(shapeOf([]), 'never[]');
  // keys that look like data (ids) collapse to a record, so a map keyed by ids leaks no id
  assert.equal(shapeOf({ zq9_4711: 1, ab12_99: 2 }), '{[key]:number}');
  const deep = shapeOf({ a: { b: { c: { d: { e: 1 } } } } });
  assert.equal(deep, '{a:{b:{c:{d:object}}}}');
});

test('urlPattern: ids and query values replaced, the path kept', () => {
  assert.equal(urlPattern('/api/items/4711?tier=pro'), '/api/items/:id?tier=');
  assert.equal(urlPattern('https://shop.example/api/carts/cart-8842/checkout?coupon=GLOBEX77'), 'https://shop.example/api/carts/:id/checkout?coupon=');
  assert.equal(urlPattern('/u/3f2c9a1e-0b7d-4c1e-9f00-123456789abc/profile'), '/u/:id/profile');
  assert.equal(urlPattern({ url: '/api/items/7' }), '/api/items/:id');
});

test('recorder (in process): caller -> callee by module identity, shapes only, async callers kept across await', async () => {
  const rec = createRecorder({ test: () => 'in-process' });
  const lib = rec.instrumentExports({ total: (xs) => xs.length, label: (n) => `${n} items` }, { file: 'src/lib.ts' });
  const app = rec.instrumentExports({
    run: async (xs) => { const n = lib.total(xs); await Promise.resolve(); return lib.label(n); },
  }, { file: 'src/app.ts' });
  assert.equal(await app.run(['Zebra Lamp']), '1 items');
  const calls = rec.records().filter((r) => r.kind === 'call');
  const edges = calls.filter((r) => r.from).map((r) => `${r.from.file}#${r.from.name} -> ${r.to.file}#${r.to.name}`).sort();
  assert.deepEqual(edges, ['src/app.ts#run -> src/lib.ts#label', 'src/app.ts#run -> src/lib.ts#total']);
  const total = calls.find((r) => r.to.name === 'total');
  assert.deepEqual(total.args, ['string[]']);
  assert.equal(total.ret, 'number');
  assert.ok(!JSON.stringify(rec.records()).includes('Zebra'), 'no argument value in the records');
});

test('overhead: cost of one recorded call (reported, loosely bounded)', (t) => {
  const rec = createRecorder({ test: () => 'bench' });
  const plain = { f: (o) => o.a + 1 };
  const lib = rec.instrumentExports({ f: (o) => o.a + 1 }, { file: 'src/bench.ts' });
  const arg = { a: 1, b: 'x' };
  const N = 50_000;
  const time = (fn) => { const t0 = process.hrtime.bigint(); for (let i = 0; i < N; i++) fn(arg); return Number(process.hrtime.bigint() - t0) / N; };
  time(plain.f); time(lib.f);
  const p = time(plain.f);
  const w = time(lib.f);
  t.diagnostic(`per call: ${p.toFixed(0)} ns plain, ${w.toFixed(0)} ns recorded (+${(w - p).toFixed(0)} ns)`);
  assert.equal(rec.records().filter((r) => r.kind === 'call').length, 1, 'repeated identical calls aggregate into one record');
  assert.ok(w < 50_000, `a recorded call costs ${w} ns`);
});

// ---------------------------------------------------------------------------------------------------------------
// Plain node: node:test fixture through module.registerHooks

test('node (registerHooks): edges, fetch pattern, shapes without values, unreached unit', (t) => {
  const dir = makeTempDir('construct-line-graph-node-');
  const recDir = path.join(dir, 'records');
  const run = (withHooks) => {
    const t0 = process.hrtime.bigint();
    const r = spawnSync(process.execPath, [...(withHooks ? ['--import', REGISTER_PATH] : []), 'app.spec.mjs'], {
      cwd: NODE_APP, encoding: 'utf8',
      env: { ...process.env, LINE_RUNTIME_DIR: recDir, LINE_RUNTIME_ROOT: NODE_APP, LINE_RUNTIME_FILES: 'lib.mjs,app.mjs' },
    });
    return { ...r, ms: Number(process.hrtime.bigint() - t0) / 1e6 };
  };
  const base = run(false);
  assert.equal(base.status, 0, base.stderr + base.stdout);
  const withRec = run(true);
  assert.equal(withRec.status, 0, withRec.stderr + withRec.stdout);
  t.diagnostic(`node overhead: ${base.ms.toFixed(0)} ms without, ${withRec.ms.toFixed(0)} ms with the recorder`);

  const records = readRuntimeRecords(recDir);
  const raw = JSON.stringify(records);
  for (const v of ['cart-8842', 'GLOBEX77', 'Quartz Kettle', '58.50', '19.5']) assert.ok(!raw.includes(v), `the value ${v} leaked into the records`);

  const map = buildLogicMap(NODE_APP, ['lib.mjs', 'app.mjs']);
  const checkout = unitOf(map, 'app.mjs', 'export', 'checkout');
  const total = unitOf(map, 'lib.mjs', 'export', 'total');
  const formatTotal = unitOf(map, 'lib.mjs', 'export', 'formatTotal');
  const neverCalled = unitOf(map, 'lib.mjs', 'export', 'neverCalled');

  const merged = mergeRuntime(graphOf(map), records, { map });
  assert.deepEqual(pairs(merged.edges), [`${id(checkout)} -> ${id(formatTotal)}`, `${id(checkout)} -> ${id(total)}`].sort());
  for (const e of merged.edges) {
    assert.deepEqual(Object.keys(e).sort(), ['evidence', 'from', 'layer', 'to', 'type']);
    assert.equal(e.type, 'CALLED_AT_RUNTIME');
    assert.equal(e.layer, RUNTIME_LAYER);
    assert.equal(e.evidence.test, 'checkout sums, labels and posts the cart');
  }
  const totalShapes = merged.shapes[`${id(checkout)} -> ${id(total)}`];
  assert.deepEqual(totalShapes, { args: ['{price:number,qty:number,sku:string}[]'], ret: ['number'] });
  assert.deepEqual(merged.io.map((x) => [x.from, x.method, x.url]), [[id(checkout), 'POST', 'https://shop.example/api/carts/:id/checkout?coupon=']]);
  assert.ok(merged.unreached.some((u) => u.fingerprint === neverCalled.fingerprint), 'neverCalled is flagged unreached');
  assert.ok(!merged.unreached.some((u) => u.fingerprint === total.fingerprint));
  assert.ok(merged.graph.edges.length === merged.edges.length);
});

// ---------------------------------------------------------------------------------------------------------------
// jest: the characterization runner's mechanism (transform wrapper + setupFilesAfterEnv)

const SHOP_TEST = `import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import ShopPage from './page';
import { useGetItemsQuery, useBuyItemMutation } from '@/lib/api';
import { loadItem } from '@/lib/client';

jest.mock('@/lib/api', () => ({ useGetItemsQuery: jest.fn(), useBuyItemMutation: jest.fn() }));

const ITEMS = { items: [{ id: 'zq9', name: 'Zebra Lamp', price: 1234, tier: 'pro' }], total: 1 };

test('shop: switch tier and buy', async () => {
  (useGetItemsQuery as jest.Mock).mockReturnValue({ data: ITEMS, isLoading: false, isError: false });
  (useBuyItemMutation as jest.Mock).mockReturnValue([() => ({ unwrap: () => Promise.resolve({ ok: true }) }), { isLoading: false }]);
  render(<ShopPage />);
  fireEvent.click(screen.getByText('Switch tier'));
  await act(async () => { fireEvent.click(screen.getByLabelText('buy zq9')); });
  expect(screen.getByText(/Zebra Lamp/)).toBeTruthy();
});

test('client: load one item', async () => {
  (globalThis as any).fetch = jest.fn(() => Promise.resolve({ json: () => Promise.resolve({ id: 'zq9', name: 'Zebra Lamp' }) }));
  const item = await loadItem('4711', 'pro');
  expect(item.name).toBe('Zebra Lamp');
});
`;

const CLIENT = `export async function loadItem(id: string, tier: string): Promise<{ id: string; name: string }> {
  const res = await fetch(\`/api/items/\${id}?tier=\${tier}\`);
  return res.json();
}

export function neverCalled(): number {
  return 1;
}
`;

const FILES = ['src/app/shop/page.tsx', 'src/app/shop/Shop.tsx', 'src/lib/price.ts', 'src/lib/api.ts', 'src/lib/toast.ts', 'src/lib/client.ts'];

test('jest (withRuntimeRecorder): a known flow gives the expected edges, a fetch pattern, a state write, an unreached unit', { skip: jestHome() ? false : NO_JEST_HOME }, (t) => {
  const app = makeTempDir('construct-line-graph-jest-');
  fs.cpSync(CHAR_APP, app, { recursive: true });
  linkJestHome(app, /** @type {string} */ (jestHome()));
  fs.writeFileSync(path.join(app, 'src/lib/client.ts'), CLIENT);
  fs.writeFileSync(path.join(app, 'src/app/shop/Shop.test.tsx'), SHOP_TEST);
  const workDir = makeTempDir('construct-line-graph-jest-work-');

  const jestRun = (args, env = {}) => {
    const t0 = Date.now();
    const r = spawnSync(process.execPath, [path.join(app, 'node_modules/jest/bin/jest.js'), ...args, '--ci', '--watchman=false', '--maxWorkers=1', '--no-cache'], {
      cwd: app, encoding: 'utf8', env: { ...process.env, CI: '1', ...env },
    });
    return { ...r, ms: Date.now() - t0 };
  };
  const covArgs = (tag) => ['--coverage', '--coverageReporters=json', `--coverageDirectory=${path.join(workDir, tag)}`, ...FILES.map((f) => `--collectCoverageFrom=${f}`)];
  const coverageOf = (tag) => JSON.parse(fs.readFileSync(path.join(workDir, tag, 'coverage-final.json'), 'utf8'));
  const base = jestRun(['--runTestsByPath', 'src/app/shop/Shop.test.tsx', ...covArgs('cov-base')]);
  assert.equal(base.status, 0, base.stderr.slice(-4000));

  const rr = withRuntimeRecorder(['--runTestsByPath', 'src/app/shop/Shop.test.tsx', ...covArgs('cov-rec')], { appRoot: app, files: FILES, workDir });
  const r = jestRun(rr.args, rr.env);
  assert.equal(r.status, 0, r.stderr.slice(-4000));
  // istanbul's numbers are the same with the recorder in (its injections add no line), so characterize can run both
  const strip = (c) => Object.fromEntries(Object.entries(c).map(([f, v]) => [path.relative(app, f), { s: v.s, b: v.b, f: v.f, statementMap: v.statementMap }]));
  assert.deepEqual(strip(coverageOf('cov-rec')), strip(coverageOf('cov-base')));
  t.diagnostic(`jest overhead: ${base.ms} ms without, ${r.ms} ms with the recorder (both --no-cache, one worker)`);

  const records = rr.read();
  const raw = JSON.stringify(records);
  for (const v of ['Zebra Lamp', 'zq9', '1234', '4711']) assert.ok(!raw.includes(v), `the value ${v} leaked into the records`);

  const map = buildLogicMap(app, FILES);
  const u = {
    page: unitOf(map, 'src/app/shop/page.tsx', 'export', 'ShopPage'),
    shop: unitOf(map, 'src/app/shop/Shop.tsx', 'export', 'Shop'),
    itemsHook: unitOf(map, 'src/lib/api.ts', 'export', 'useGetItemsQuery'),
    buyHook: unitOf(map, 'src/lib/api.ts', 'export', 'useBuyItemMutation'),
    seats: unitOf(map, 'src/lib/price.ts', 'export', 'seatsFor'),
    price: unitOf(map, 'src/lib/price.ts', 'export', 'priceLabel'),
    toast: unitOf(map, 'src/lib/toast.ts', 'export', 'toast'),
    switchTier: unitOf(map, 'src/app/shop/Shop.tsx', 'handler', 'setTier'),
    buy: unitOf(map, 'src/app/shop/Shop.tsx', 'handler', 'onBuy'),
    tier: unitOf(map, 'src/app/shop/Shop.tsx', 'state', 'tier'),
    loadItem: unitOf(map, 'src/lib/client.ts', 'export', 'loadItem'),
    neverCalled: unitOf(map, 'src/lib/client.ts', 'export', 'neverCalled'),
  };
  const expected = [
    [u.page, u.shop], // render
    [u.shop, u.itemsHook], [u.shop, u.buyHook], // hooks (mocked by the test; recorded by module identity)
    [u.shop, u.seats], [u.shop, u.price], // calls during render
    [u.shop, u.switchTier], [u.shop, u.buy], // JSX on* handlers the test fired
    [u.switchTier, u.tier], // state write setTier
    [u.buy, u.toast], // toast.show after an await
  ].map(([a, b]) => `${id(a)} -> ${id(b)}`).sort();

  const merged = mergeRuntime(graphOf(map), records, { map });
  const actual = pairs(merged.edges);
  const name = new Map(map.units.map((x) => [id(x), `${x.file}#${x.fn}:${x.kind}(${x.detail.slice(0, 30)})`]));
  const readable = (list) => list.map((p) => p.split(' -> ').map((x) => name.get(x) ?? x).join(' -> '));
  assert.deepEqual(readable(actual), readable(expected));

  for (const e of merged.edges) assert.match(e.evidence.test, /^Shop\.test\.tsx > shop: switch tier and buy$/);
  assert.deepEqual(merged.io.map((x) => [x.from, x.method, x.url]), [[id(u.loadItem), 'GET', '/api/items/:id?tier=']]);
  assert.deepEqual(merged.writes.map((w) => [w.from, w.kind, w.key, w.to]), [[id(u.switchTier), 'state', 'tier', id(u.tier)]]);
  assert.ok(merged.unreached.some((x) => x.fingerprint === u.neverCalled.fingerprint), 'neverCalled is flagged unreached');
  assert.ok(!merged.unreached.some((x) => x.fingerprint === u.price.fingerprint));
  const hookShapes = merged.shapes[`${id(u.shop)} -> ${id(u.itemsHook)}`];
  assert.deepEqual(hookShapes.args, ['{tier:string}']);
  assert.deepEqual(hookShapes.ret, ['{data:{items:{id:string,name:string,price:number,tier:string}[],total:number},isError:boolean,isLoading:boolean}']);
  // a mocked callee says so (Fix 2: mocks follow moves by module identity)
  const mockedCall = records.find((x) => x.kind === 'call' && x.to?.name === 'useGetItemsQuery');
  assert.equal(mockedCall.mocked, true);

  const cov = runtimeCoverage(map, records);
  assert.equal(cov.total, map.units.length);
  assert.ok(cov.reached.includes(u.price.fingerprint) && cov.unreached.includes(u.neverCalled.fingerprint));
  assert.equal(cov.reached.length + cov.unreached.length, cov.total);
});

test('resolveRef: a callee that moved file is still found by its export name (mocks follow moves)', () => {
  const map = { units: [{ id: 'src/new/price.ts#priceLabel:export:1', fingerprint: 'aaaaaaaaaaaaaaaa', kind: 'export', file: 'src/new/price.ts', fn: 'priceLabel', line: 1, detail: 'function priceLabel' }] };
  assert.equal(resolveRef({ kind: 'export', file: 'src/lib/price.ts', name: 'priceLabel' }, map)?.fingerprint, 'aaaaaaaaaaaaaaaa');
});
