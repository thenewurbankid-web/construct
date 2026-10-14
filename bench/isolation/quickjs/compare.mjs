#!/usr/bin/env node
// QuickJS spike, part 2: the QuickJS backend against the vm child (isolatedRun.mjs `sandbox`), on
//   A. the logicVerify isolated tests' cases (test/line-logic-verify-isolated.test.mjs, as pairs), and
//   B. the isolation tasks' logic units: the services and the picks store (bench/isolation/tasks/_shared), the t06
//      reference store, and every task's reference page (plus the _r2 start pages), run as units and as start->reference
//      pairs.
// Per case: results equal (the LayerResult without `ms` for a pair; the runs for a unit), warm latency (median of
// --reps), determinism (the same call 20 times gives one result), then the escape set
// (test/fixtures/logic-verify/quickjs-escapes.mjs) on both. Cold latency comes from fresh node processes (--cold).
// Writes results/q-compare.json; prints the tables q-run.mjs puts into q-r1.md.
//
//   node bench/isolation/quickjs/compare.mjs            # everything (about a minute: the vm side spawns a child per call)
//   node bench/isolation/quickjs/compare.mjs --cold vm  # internal: one cold call, prints its ms
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..', '..');
const TASKS = path.join(REPO, 'bench/isolation/tasks');
const RESULTS = path.join(REPO, 'bench/isolation/results');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };

// ---------------------------------------------------------------- cold mode: one call in a fresh process
if (opt('cold')) {
  const t0 = performance.now();
  const { isolatedPair } = await import('../../../packages/engine/line/logicVerify/isolatedRun.mjs');
  const top = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-q-cold-'));
  fs.writeFileSync(path.join(top, 'u.ts'), 'export function save(a: number, b: number) { return a + b; }');
  const t1 = performance.now();
  const r = await isolatedPair({ beforeRoot: top, afterRoot: top, before: { file: 'u.ts', fn: 'save' }, after: { file: 'u.ts', fn: 'save' }, sandbox: opt('cold') });
  const t2 = performance.now();
  fs.rmSync(top, { recursive: true, force: true });
  process.stdout.write(JSON.stringify({ outcome: r.outcome, importMs: t1 - t0, callMs: t2 - t1 }) + '\n');
  process.exit(0);
}

const { isolatedPair, isolatedRun } = await import('../../../packages/engine/line/logicVerify/isolatedRun.mjs');
const { ESCAPES } = await import('../../../test/fixtures/logic-verify/quickjs-escapes.mjs');
const { QUICKJS_PACKAGE, warmQuickjs } = await import('../../../packages/engine/line/logicVerify/quickjs/quickjsRun.mjs');
const REPS = Number(opt('reps', 10));
const DET = Number(opt('det', 20));
const TOP = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-q-compare-'));
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };
const strip = (r) => { const { ms, ...rest } = r; return rest; };

// ---------------------------------------------------------------- A. the isolated tests' cases
let n = 0;
function roots(beforeSrc, afterSrc, file = 'src/unit.ts', extra = {}) {
  const top = path.join(TOP, `a${n++}`);
  for (const [side, src] of [['before', beforeSrc], ['after', afterSrc]]) {
    fs.mkdirSync(path.join(top, side, path.dirname(file)), { recursive: true });
    fs.writeFileSync(path.join(top, side, file), src);
    for (const [f, s] of Object.entries(extra)) fs.writeFileSync(path.join(top, side, f), s);
  }
  return { beforeRoot: path.join(top, 'before'), afterRoot: path.join(top, 'after') };
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
const KEY = { 'src/key.ts': "export const formatKey = (k: string) => `app.${k}`;\n" };
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
const HANDLER = (body) => `
import type React from 'react';
export function handleKey(e: React.KeyboardEvent<HTMLInputElement>) {
  ${body}
  if (e.key === 'Enter') sessionStorage.setItem('q', e.target.value);
}
`;
const SWITCH = `export function save(n: number) {
  switch (n) { case 7: return 'a'; case 8: return 'b'; case 9: return 'c'; case 10: return 'd'; case 11: return 'e'; case 12: return 'f'; }
  return 'z';
}`;
const FIX = path.join(REPO, 'test/fixtures/logic-verify');
const dropped = JSON.parse(fs.readFileSync(path.join(FIX, 'cases.json'), 'utf8')).find((x) => x.name === 'dropped-effect');
const unitOf = (fn, file = 'src/unit.ts') => ({ file, fn });
const pairCases = [
  ['equal pair, relative import', () => ({ ...roots(SAVE('POST'), SAVE('POST'), undefined, KEY), u: unitOf('save') })],
  ['POST vs PUT', () => ({ ...roots(SAVE('POST'), SAVE('PUT'), undefined, KEY), u: unitOf('save') })],
  ['a + b vs a - b', () => ({ ...roots('export function save(a: number, b: number) { return a + b; }', 'export function save(a: number, b: number) { return a - b; }'), u: unitOf('save') })],
  ['unfaked import node:fs', () => { const s = "import fs from 'node:fs';\nexport function save(x: string) { fs.writeFileSync('/dev/null', x); return 1; }"; return { ...roots(s, s), u: unitOf('save') }; }],
  ['unfaked WebSocket', () => { const s = "export function save(x: string) { const ws = new WebSocket('ws://example.invalid'); ws.send(x); return 1; }"; return { ...roots(s, s), u: unitOf('save') }; }],
  ['unfaked process', () => { const s = "export function save(x: string) { return (process as any).mainModule.require('node:fs').writeFileSync('/dev/null', x); }"; return { ...roots(s, s), u: unitOf('save') }; }],
  ['hanging unit (800 ms limit)', () => { const s = 'export function save(n: number) { while (true) { n++; } }'; return { ...roots(s, s), u: unitOf('save'), timeoutMs: 800, slow: true }; }],
  ['fixed time and random', () => { const s = 'export function save() { return `${new Date().toISOString()} ${Math.random()}`; }'; return { ...roots(s, s), u: unitOf('save') }; }],
  ['planted dropped-effect', () => ({ beforeRoot: path.join(FIX, 'dropped-effect/before'), afterRoot: path.join(FIX, 'dropped-effect/after'), u: dropped.before })],
  ['setItem vs removeItem', () => ({ ...roots('export function save(k: string) { sessionStorage.setItem(k, "1"); }', 'export function save(k: string) { sessionStorage.removeItem(k); }'), u: unitOf('save') })],
  ['hook equal', () => ({ ...roots(HOOK(1), HOOK(1), 'src/unit.tsx'), u: unitOf('useCart', 'src/unit.tsx') })],
  ['hook state step 1 vs 2', () => ({ ...roots(HOOK(1), HOOK(2), 'src/unit.tsx'), u: unitOf('useCart', 'src/unit.tsx') })],
  ['hook dropped effect', () => ({ ...roots(HOOK(1), HOOK(1, ''), 'src/unit.tsx'), u: unitOf('useCart', 'src/unit.tsx') })],
  ['handler equal', () => ({ ...roots(HANDLER('e.preventDefault();'), HANDLER('e.preventDefault();'), 'src/unit.tsx'), u: unitOf('handleKey', 'src/unit.tsx') })],
  ['handler dropped preventDefault', () => ({ ...roots(HANDLER('e.preventDefault();'), HANDLER(''), 'src/unit.tsx'), u: unitOf('handleKey', 'src/unit.tsx') })],
  ['coverage full', () => { const s = 'export function save(id: string) { if (id) { localStorage.setItem(id, "1"); return 1; } return 0; }'; return { ...roots(s, s), u: unitOf('save') }; }],
  ['coverage low (switch)', () => ({ ...roots(SWITCH, SWITCH), u: unitOf('save') })],
  ['hook coverage per side', () => ({ ...roots("import { useState } from 'react';\nexport function useCounter() { const [n, setN] = useState(0); return { n, inc: () => setN(n + 1) }; }", "import { useState } from 'react';\nexport function useCounter() { const [n, setN] = useState(0); return { n, inc: () => setN((v) => v + 1) }; }", 'src/unit.tsx'), u: unitOf('useCounter', 'src/unit.tsx') })],
];

// ---------------------------------------------------------------- B. the isolation tasks' logic units
const TC = path.join(REPO, 'packages/core/typed-contracts');
/** One task root: _shared + _r2 + (start) + (reference), with the package imports pointed at files inside it. */
function taskRoot(name, overlays) {
  const root = path.join(TOP, `b-${name}`);
  fs.cpSync(path.join(TASKS, '_shared'), root, { recursive: true });
  fs.cpSync(path.join(TASKS, '_r2'), root, { recursive: true });
  for (const o of overlays) if (fs.existsSync(o)) fs.cpSync(o, root, { recursive: true });
  fs.cpSync(TC, path.join(root, 'typed-contracts'), { recursive: true, filter: (s) => !/\/examples(\/|$)/.test(s) });
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  for (const f of walk(path.join(root, 'features')).concat(walk(path.join(root, 'library')))) {
    if (!/\.tsx?$/.test(f)) continue;
    const rel = (to) => { const r = path.relative(path.dirname(f), path.join(root, to)).replace(/\.tsx?$/, ''); return r.startsWith('.') ? r : `./${r}`; };
    let s = fs.readFileSync(f, 'utf8')
      .replace(/(['"])@line\/construct-core\/typed-contracts\1/g, `'${rel('typed-contracts/index.ts')}'`)
      .replace(/(['"])next\/link\1/g, `'${rel('shims/next-link.tsx')}'`);
    // the runner compiles JSX as React.createElement (the classic runtime): give a .tsx file its React binding
    if (f.endsWith('.tsx') && !/import \* as React from 'react'/.test(s)) s = s.replace(/^((?:'use client';\s*)?)/, "$1import * as React from 'react';\n");
    fs.writeFileSync(f, s);
  }
  return root;
}
const taskIds = fs.readdirSync(TASKS).filter((d) => /^t\d\d-/.test(d)).sort();
const loadTask = (id) => JSON.parse(fs.readFileSync(path.join(TASKS, id, 'task.json'), 'utf8'));
const shared = taskRoot('shared', []);
const t06ref = taskRoot('t06-ref', [path.join(TASKS, 't06-picks-store/reference')]);
const unitCases = [
  ['service findBook', { root: shared, unit: { file: 'features/book/services/findBook.ts', fn: 'findBook' }, cases: [[{ id: 'winter-ferry' }], [{ id: 'no-such-book' }]] }],
  ['service listBooks', { root: shared, unit: { file: 'features/browse/services/listBooks.ts', fn: 'listBooks' }, cases: [[{}]] }],
  ['service pickedBooks', { root: shared, unit: { file: 'features/picks/services/pickedBooks.ts', fn: 'pickedBooks' }, cases: [[{ ids: ['copper-roads', 'nope', 'salt-and-lanterns'] }], [{ ids: [] }]] }],
  ...['listPicks', 'addPick', 'removePick'].flatMap((fn) => [
    [`store ${fn} (shared)`, { root: shared, unit: { file: 'features/picks/store/picksStore.ts', fn }, cases: [['a'], ['b'], []] }],
    [`store ${fn} (t06 reference)`, { root: t06ref, unit: { file: 'features/picks/store/picksStore.ts', fn }, cases: [['a'], ['b'], []] }],
  ]),
];
const pairB = [];
for (const id of taskIds) {
  const task = loadTask(id);
  const ref = path.join(TASKS, id, 'reference');
  const before = taskRoot(`${id}-start`, [path.join(TASKS, id, 'start')]);
  const after = taskRoot(`${id}-ref`, [path.join(TASKS, id, 'start'), ref]);
  const fn = path.basename(task.target).replace(/\.tsx?$/, '');
  if (task.kind === 'store') {
    for (const f of ['listPicks', 'addPick', 'removePick']) pairB.push([`${id} ${f}: shared store -> reference`, () => ({ beforeRoot: shared, afterRoot: after, u: { file: task.target, fn: f } })]);
    continue;
  }
  const props = /BookPage/.test(fn) ? [[{ params: { id: 'salt-and-lanterns' } }], [{ params: { id: 'winter-ferry' } }], [{ params: { id: 'no-such-book' } }]] : [[{}]];
  unitCases.push([`${id} reference ${fn}`, { root: after, unit: { file: task.target, fn }, cases: props }]);
  pairB.push([`${id} ${fn}: _r2 start -> reference`, () => ({ beforeRoot: before, afterRoot: after, u: { file: task.target, fn } })]);
}

// ---------------------------------------------------------------- run both sandboxes
async function timePair(c, sandbox) {
  const t0 = performance.now();
  const r = await isolatedPair({ beforeRoot: c.beforeRoot, afterRoot: c.afterRoot, before: c.u, after: c.u, sandbox, ...(c.timeoutMs ? { timeoutMs: c.timeoutMs } : {}) });
  return { r: strip(r), ms: performance.now() - t0 };
}
async function timeUnit(c, sandbox) {
  const t0 = performance.now();
  const r = await isolatedRun({ ...c, sandbox });
  const { ms, ...rest } = r;
  return { r: rest, ms: performance.now() - t0 };
}
await warmQuickjs();
const rows = [];
async function measure(group, name, call, runsPerCall) {
  const out = { group, name, runsPerCall };
  for (const sandbox of ['vm', 'quickjs']) {
    const first = await call(sandbox);
    const reps = first.slow ? 1 : REPS;
    const ms = [first.ms];
    const seen = new Set([JSON.stringify(first.r)]);
    const det = first.slow ? 2 : DET;
    for (let i = 1; i < Math.max(reps, det); i++) { const x = await call(sandbox); if (i < reps) ms.push(x.ms); seen.add(JSON.stringify(x.r)); }
    out[sandbox] = { result: first.r, warmMs: median(ms.slice(1).length ? ms.slice(1) : ms), distinct: seen.size, runs: det };
  }
  out.equal = JSON.stringify(out.vm.result) === JSON.stringify(out.quickjs.result);
  rows.push(out);
  process.stderr.write(`${out.equal ? 'same' : 'DIFF'} ${group} ${name}: vm ${out.vm.warmMs.toFixed(1)} ms, quickjs ${out.quickjs.warmMs.toFixed(1)} ms\n`);
}
const casesOf = (c) => c.cases?.length ?? 0;
for (const [name, mk] of pairCases) { const c = mk(); await measure('A tests', name, async (s) => ({ ...(await timePair(c, s)), slow: c.slow }), null); }
for (const [name, mk] of pairB) { const c = mk(); await measure('B tasks (pair)', name, (s) => timePair(c, s), null); }
for (const [name, c] of unitCases) await measure('B tasks (unit)', name, (s) => timeUnit(c, s), casesOf(c) * 2);

// ---------------------------------------------------------------- escapes
const escRoot = path.join(TOP, 'esc');
fs.mkdirSync(escRoot, { recursive: true });
const marker = path.join(escRoot, 'MARKER');
const runEsc = async (src, sandbox) => { fs.writeFileSync(path.join(escRoot, 'unit.ts'), src); return isolatedRun({ root: escRoot, unit: { file: 'unit.ts', fn: 'save' }, cases: [[]], sandbox, timeoutMs: 3000 }); };
const verdict = (r) => (r.error ? 'error' : r.runs[0].notFaked.length ? 'notFaked' : `thrown:${r.runs[0].thrown ?? 'none'}`);
const escapes = [];
for (const e of ESCAPES(marker)) {
  const row = { id: e.id, what: e.what, expect: e.expect };
  for (const sandbox of ['vm', 'quickjs']) {
    fs.rmSync(marker, { force: true });
    const r = await runEsc(e.src, sandbox);
    const a = e.after ? await runEsc(e.after, sandbox) : null;
    const got = verdict(r);
    const hostClean = !fs.existsSync(marker) && ({}).polluted === undefined && [1].map((x) => x + 1)[0] === 2;
    const afterOk = !e.after || a?.runs?.[0]?.value === e.afterExpect;
    const valueOk = !e.valueExpect || r.runs?.[0]?.value === e.valueExpect;
    const blocked = hostClean && afterOk && valueOk && (got === e.expect || (e.expect === 'notFaked' && got.startsWith('thrown:') && r.runs[0].notFaked.length > 0));
    row[sandbox] = { got, reason: r.error ?? null, notFaked: r.runs?.[0]?.notFaked ?? [], hostClean, afterOk, valueOk, blocked, ms: Math.round(r.ms) };
  }
  escapes.push(row);
  process.stderr.write(`escape ${e.id}: vm ${row.vm.got}${row.vm.blocked ? '' : ' (NOT as expected)'}, quickjs ${row.quickjs.got}${row.quickjs.blocked ? '' : ' (NOT as expected)'}\n`);
}

// ---------------------------------------------------------------- cold
const cold = {};
for (const sandbox of ['vm', 'quickjs']) {
  const xs = [];
  for (let i = 0; i < 3; i++) {
    const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--cold', sandbox], { encoding: 'utf8', cwd: REPO });
    xs.push(JSON.parse(r.stdout.trim().split('\n').pop()));
  }
  cold[sandbox] = { importMs: median(xs.map((x) => x.importMs)), callMs: median(xs.map((x) => x.callMs)) };
}
fs.rmSync(TOP, { recursive: true, force: true });

// ---------------------------------------------------------------- tables
const fmt = (x) => (x < 10 ? x.toFixed(1) : Math.round(x).toString());
const groups = [...new Set(rows.map((r) => r.group))];
const table = [
  '| group | cases | results equal | vm warm (median per call) | quickjs warm | speed-up | deterministic (vm / quickjs, 20 runs each) |',
  '| --- | --- | --- | --- | --- | --- | --- |',
  ...groups.map((g) => {
    const rs = rows.filter((r) => r.group === g);
    const vm = median(rs.map((r) => r.vm.warmMs)); const q = median(rs.map((r) => r.quickjs.warmMs));
    return `| ${g} | ${rs.length} | ${rs.filter((r) => r.equal).length}/${rs.length} | ${fmt(vm)} ms | ${fmt(q)} ms | ${(vm / q).toFixed(1)}x | ${rs.filter((r) => r.vm.distinct === 1).length}/${rs.length} / ${rs.filter((r) => r.quickjs.distinct === 1).length}/${rs.length} |`;
  }),
];
const perCase = [
  '| group | case | equal | vm ms | quickjs ms | vm outcome | quickjs outcome |', '| --- | --- | --- | --- | --- | --- | --- |',
  ...rows.map((r) => {
    const o = (x) => x.result.outcome ?? (x.result.error ? 'error' : (x.result.runs ?? []).map((y) => y.thrown ?? (y.notFaked.length ? 'notFaked' : 'ok')).join(','));
    return `| ${r.group} | ${r.name} | ${r.equal ? 'yes' : '**no**'} | ${fmt(r.vm.warmMs)} | ${fmt(r.quickjs.warmMs)} | ${o(r.vm)} | ${o(r.quickjs)} |`;
  }),
];
const diffs = rows.filter((r) => !r.equal).map((r) => ({ group: r.group, name: r.name, vm: r.vm.result, quickjs: r.quickjs.result }));
const escTable = [
  '| attempt | expected | vm | quickjs |', '| --- | --- | --- | --- |',
  ...escapes.map((e) => `| ${e.what} | ${e.expect} | ${e.vm.got}${e.vm.blocked ? ', blocked' : ', **not as expected**'} | ${e.quickjs.got}${e.quickjs.blocked ? ', blocked' : ', **not as expected**'} |`),
];
const out = { at: new Date().toISOString(), quickjs: QUICKJS_PACKAGE, node: process.version, reps: REPS, det: DET, cold, rows, escapes, diffs, table, perCase, escTable };
fs.writeFileSync(path.join(RESULTS, 'q-compare.json'), JSON.stringify(out, null, 2));
console.log([...table, '', `cold (fresh process, median of 3): vm import ${fmt(cold.vm.importMs)} ms + first call ${fmt(cold.vm.callMs)} ms; quickjs import ${fmt(cold.quickjs.importMs)} ms + first call ${fmt(cold.quickjs.callMs)} ms`, '', ...escTable].join('\n'));
