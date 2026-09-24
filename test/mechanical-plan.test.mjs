import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { readSignals, classify, planMechanically } from '../packages/core/mechanical-plan.mjs';
import { validatePlanShape } from '../packages/core/import.mjs';
import { makeTempDir } from '../test-utils/tmpdir.mjs';

const layersOf = (src, opts, name = 'f.tsx') => classify(readSignals(src, name), opts).layers;

test('JSX with no state is a component', () => {
  assert.deepEqual(layersOf('export function Card({t}){ return <div>{t}</div>; }'), ['component']);
});

test('a component that keeps its own state moves that logic to a hook', () => {
  assert.deepEqual(layersOf("import {useState} from 'react'; export function Counter(){ const [n,setN]=useState(0); return <button onClick={()=>setN(n+1)}>{n}</button>; }"), ['hook', 'component']);
});

test('calling another feature hook is not owning state', () => {
  assert.deepEqual(layersOf("import {useCart} from './useCart'; export function CartBadge(){ const c = useCart(); return <b>{c.n}</b>; }"), ['component']);
});

test('a hook file is a hook, and a fetch inside adds a service', () => {
  assert.deepEqual(layersOf("import {useEffect,useState} from 'react'; export function useUsers(){ const [u,setU]=useState([]); useEffect(()=>{ fetch('/api/u').then(r=>r.json()).then(setU); },[]); return u; }", {}, 'useUsers.ts'), ['service', 'hook']);
});

test('plain functions are domain; a types-only file and a barrel are skipped with a reason', () => {
  assert.deepEqual(layersOf('export const add = (a: number, b: number) => a + b;', {}, 'math.ts'), ['domain']);
  assert.match(classify(readSignals('export interface A { x: number }', 't.ts')).skip, /types only/);
  assert.match(classify(readSignals("export * from './a'; export { b } from './b';", 'index.ts')).skip, /barrel/);
});

test('a reducer with switch on action.type is a workflow', () => {
  const src = "export function cartReducer(state: number, action: {type: string}) { switch (action.type) { case 'add': return state + 1; default: return state; } }";
  assert.deepEqual(layersOf(src, {}, 'cartReducer.ts'), ['workflow']);
});

test('the route entry is page + controller, and always gets a reason per layer', () => {
  const r = classify(readSignals('export default function Page(){ return <Home/>; }', 'page.tsx'), { isEntry: true });
  assert.deepEqual(r.layers, ['page', 'controller']);
  assert.ok(r.reasons.page && r.reasons.controller);
});

test('planMechanically produces a valid plan in build order with unique names and skipped files reported', () => {
  const dir = makeTempDir('mech-plan-');
  const w = (rel, src) => {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, src);
    return abs;
  };
  const entry = w('app/orders/page.tsx', "import {OrderList} from './OrderList'; export default function Page(){ return <OrderList/>; }");
  const list = w('app/orders/OrderList.tsx', "import {sum} from './lib/sum'; export function OrderList(){ return <ul>{[1].map(n=><li key={n}>{sum(n,1)}</li>)}</ul>; }");
  const sum = w('app/orders/lib/sum.ts', 'export const sum = (a: number, b: number) => a + b;');
  const types = w('app/orders/types.ts', 'export type Order = { id: string };');
  const dupe = w('app/orders/lib/OrderList.ts', 'export const x = 1;');

  const plan = planMechanically([entry, list, sum, types, dupe], 'orders', { entryFiles: [entry] });
  validatePlanShape(plan, 'mechanical');
  assert.deepEqual(plan.units.map((u) => u.name), ['Sum', 'LibOrderList', 'OrderList', 'Orders']);
  assert.equal(plan.units.at(-1).from, entry, 'the route entry unit is built last');
  assert.deepEqual(plan.units.at(-1).layers, ['page', 'controller']);
  assert.equal(new Set(plan.units.map((u) => u.name)).size, plan.units.length);
  assert.deepEqual(plan.skipped.map((s) => path.basename(s.file)), ['types.ts']);
  for (const u of plan.units) assert.ok(path.isAbsolute(u.from));
});
