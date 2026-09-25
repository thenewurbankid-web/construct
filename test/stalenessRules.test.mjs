// CONTROLLER-003 (#667), HOOK-003 (#668), ROUTE-003 (#669), the Controller, Hook and Route rows of
// docs/staleness-by-layer.md (part of #577). All off by default, opt in like SERVICE-003.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_RULES } from '../packages/core/config.mjs';
import { detectLayerViolations, validateArchitecture } from '../packages/core/architecture-enforcer.mjs';
import { parseToAst } from '../packages/ast/index.mjs';
import { collectControllerStateCalls, collectUncleanedSubscriptions, collectParamsReads } from '../packages/ast/staleness.mjs';
import { makeTempDir } from '../test-utils/tmpdir.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'staleness');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const C_BAD = read('features', 'bad', 'controllers', 'OrderController.tsx');
const C_GOOD = read('features', 'good', 'controllers', 'OrderController.tsx');
const H_BAD = read('features', 'bad', 'hooks', 'useViewport.ts');
const H_GOOD = read('features', 'good', 'hooks', 'useViewport.ts');
const R_BAD = read('app', 'bad', 'orders', '[id]', 'page.tsx');
const R_GOOD = read('app', 'good', 'orders', '[id]', 'page.tsx');

const FLAGS = { controllerNoState: true, hookEffectCleanup: true, routeForwardParams: true };
const on = (layer, source, rule) => detectLayerViolations(layer, source, FLAGS).filter((v) => v.rule === rule);
const off = (layer, source) => detectLayerViolations(layer, source).map((v) => v.rule);

test('all three rules are registered off by default and report nothing unless opted in', () => {
  for (const r of ['CONTROLLER-003', 'HOOK-003', 'ROUTE-003']) assert.equal(DEFAULT_RULES[r].severity, 'off', r);
  assert.ok(!off('controller', C_BAD).includes('CONTROLLER-003'));
  assert.ok(!off('hook', H_BAD).includes('HOOK-003'));
  assert.ok(!off('route', R_BAD).includes('ROUTE-003'));
});

test('CONTROLLER-003: fires on the bad fixture with file:line and a suggestedFix, silent on the binder output', () => {
  const v = on('controller', C_BAD, 'CONTROLLER-003');
  assert.equal(v.length, 1);
  assert.equal(v[0].line, 9);
  assert.match(v[0].message, /useState/);
  assert.match(v[0].suggestedFix, /useOrder\(\)/);
  assert.deepEqual(on('controller', C_GOOD, 'CONTROLLER-003'), []);
});

test('CONTROLLER-003: every state, ref, effect and memo hook counts, also as React.useX; a hook read does not', () => {
  const src = "import React from 'react';\nexport function C() {\n  const a = React.useRef(1);\n  const b = useMemo(() => 1, []);\n  useEffect(() => {}, []);\n  const { x } = useThing();\n  return null;\n}\n";
  assert.deepEqual(collectControllerStateCalls(parseToAst(src)).map((h) => h.name), ['useRef', 'useMemo', 'useEffect']);
});

test('HOOK-003: fires on the bad fixture (listener never removed) with file:line and a cleanup suggestedFix, silent on the good one', () => {
  const v = on('hook', H_BAD, 'HOOK-003');
  assert.equal(v.length, 1);
  assert.equal(v[0].line, 9);
  assert.match(v[0].message, /addEventListener/);
  assert.match(v[0].suggestedFix, /return \(\) => controller\.abort\(\)/);
  assert.deepEqual(on('hook', H_GOOD, 'HOOK-003'), []);
});

test('HOOK-003: an effect with no subscribe-shaped call is never reported; timers, observers and a returned unsubscribe are read correctly', () => {
  const hits = (body) => collectUncleanedSubscriptions(parseToAst(`export function useX() {\n${body}\n}`)).map((h) => h.api);
  assert.deepEqual(hits('useEffect(() => { document.title = "x"; }, []);'), []);
  assert.deepEqual(hits('useEffect(() => { const id = setInterval(tick, 10); }, []);'), ['setInterval']);
  assert.deepEqual(hits('useEffect(() => { const id = setInterval(tick, 10); return () => clearInterval(id); }, []);'), []);
  assert.deepEqual(hits('useEffect(() => store.subscribe(cb), []);'), []);
  assert.deepEqual(hits('useEffect(() => { const off = bus.on("x", cb); return off; }, []);'), []);
  assert.deepEqual(hits('React.useEffect(() => { const ws = new WebSocket(url); }, []);'), ['new WebSocket']);
  assert.deepEqual(hits('useEffect(() => { if (a) { return; } window.addEventListener("x", f); }, []);'), ['addEventListener']);
  assert.deepEqual(hits('useEffect(() => { window.addEventListener("x", f); const r = () => { return 1; }; }, []);'), ['addEventListener']);
  assert.deepEqual(hits('useEffect(() => window.addEventListener("x", f), []);'), ['addEventListener']);
});

test('HOOK-003: only the hook layer is checked', () => {
  assert.deepEqual(on('component', H_BAD, 'HOOK-003'), []);
});

test('ROUTE-003: fires on the bad fixture (params.id read) with file:line and a suggestedFix, silent on the good one', () => {
  const v = on('route', R_BAD, 'ROUTE-003');
  assert.equal(v.length, 1);
  assert.equal(v[0].line, 6);
  assert.match(v[0].message, /params/);
  assert.match(v[0].suggestedFix, /params=\{params\}/);
  assert.deepEqual(on('route', R_GOOD, 'ROUTE-003'), []);
});

test('ROUTE-003: member, computed, awaited, destructured, useParams and parameter-pattern reads are found; forwarding whole is not', () => {
  const hits = (src) => collectParamsReads(parseToAst(src)).map((h) => h.name);
  assert.deepEqual(hits('export default function P({ params }) { return <C id={params["id"]} />; }'), ['params']);
  assert.deepEqual(hits('export default function P({ searchParams }) { return <C q={searchParams.get("q")} />; }'), ['searchParams']);
  assert.deepEqual(hits('export default async function P({ params }) { const { id } = await params; return null; }'), ['params']);
  assert.deepEqual(hits('export default async function P({ params }) { return <C id={(await params).id} />; }'), ['params']);
  assert.deepEqual(hits('export default function P({ params: { id } }) { return null; }'), ['params']);
  assert.deepEqual(hits('export default function P() { const { id } = useParams(); return null; }'), ['useParams()']);
  assert.deepEqual(hits('export default function P({ params, searchParams }) { return <C params={params} searchParams={searchParams} />; }'), []);
});

test('validateArchitecture (the source of `--format json`) honours the architecture.yml opt-in for all three and returns the standard fields', () => {
  const dir = makeTempDir('construct-staleness-rules-');
  const yml = (rules) => `version: 1\npreset: strict-nextjs\nfeatures:\n  root: features\n${rules}`;
  fs.writeFileSync(path.join(dir, 'architecture.yml'), yml(''));
  const put = (rel, text) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };
  put('features/shop/controllers/OrderController.tsx', C_BAD);
  put('features/shop/hooks/useViewport.ts', H_BAD);
  put('app/orders/[id]/page.tsx', R_BAD);
  const found = () => validateArchitecture(dir).violations.filter((v) => ['CONTROLLER-003', 'HOOK-003', 'ROUTE-003'].includes(v.rule));
  assert.deepEqual(found(), []);
  fs.writeFileSync(path.join(dir, 'architecture.yml'), yml('rules:\n  CONTROLLER-003: warning\n  HOOK-003: warning\n  ROUTE-003: error\n'));
  const got = Object.fromEntries(found().map((v) => [v.rule, v]));
  assert.deepEqual(Object.keys(got).sort(), ['CONTROLLER-003', 'HOOK-003', 'ROUTE-003']);
  assert.equal(got['CONTROLLER-003'].severity, 'warning');
  assert.equal(got['ROUTE-003'].severity, 'error');
  assert.equal(got['HOOK-003'].file, 'features/shop/hooks/useViewport.ts');
  assert.deepEqual(Object.keys(got['HOOK-003']).sort(), ['docsUrl', 'expected', 'file', 'line', 'message', 'module', 'rule', 'severity', 'suggestedFix', 'why']);
});
