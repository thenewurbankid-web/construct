// #597 -- PAGE-001, COMPONENT-001 and PURE-001 were registered (error/error/warning) with no
// detector anywhere, the same dead-rule bug as SERVICE-001 (#589). Each now has a narrow detector
// for the clause no other rule covered (see the block above PAGE_001_STATE_HOOKS in
// packages/core/architecture-enforcer.mjs for the per-rule evidence):
//   PAGE-001       a page owns state or an effect (useState/useReducer/useEffect/...)
//   COMPONENT-001  a component owns an application state machine (useMachine/useActor/createMachine)
//   PURE-001       domain code calls a nondeterministic source (Math.random, Date.now, new Date(), ...)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_RULES } from '../packages/core/config.mjs';
import { detectLayerViolations, validateArchitecture } from '../packages/core/architecture-enforcer.mjs';
import { makeTempDir } from '../test-utils/tmpdir.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rulesOf = (layer, source) => detectLayerViolations(layer, source).map((v) => v.rule);
const only = (rule, layer, source) => detectLayerViolations(layer, source).filter((v) => v.rule === rule);

test('#597: the three rules stay registered; PAGE-001/COMPONENT-001 default to warning (non-additive), PURE-001 stays warning', () => {
  assert.equal(DEFAULT_RULES['PAGE-001'].severity, 'warning');
  assert.equal(DEFAULT_RULES['COMPONENT-001'].severity, 'warning');
  assert.equal(DEFAULT_RULES['PURE-001'].severity, 'warning');
});

// ---- PAGE-001 ----------------------------------------------------------------------------

test('PAGE-001: a page calling useState/useReducer/useEffect/useLayoutEffect/useSyncExternalStore is flagged, bare or as React.<hook>', () => {
  for (const hook of ['useState', 'useReducer', 'useEffect', 'useLayoutEffect', 'useSyncExternalStore']) {
    const bare = only('PAGE-001', 'page', `export function P(){ ${hook}(0); return <div/>; }`);
    assert.equal(bare.length, 1, hook);
    assert.match(bare[0].message, new RegExp(hook));
    assert.deepEqual(bare[0].expected, ['controller', 'hook', 'component']);
    assert.match(bare[0].suggestedFix, /hook|controller/);
    assert.equal(only('PAGE-001', 'page', `import React from 'react';\nexport function P(){ React.${hook}(0); return <div/>; }`).length, 1, `React.${hook}`);
  }
});

test('PAGE-001: reports the line of the first state/effect call', () => {
  const v = only('PAGE-001', 'page', `import { useState } from 'react';\n\nexport function P(){\n  const [a] = useState(0);\n  return <div>{a}</div>;\n}\n`);
  assert.equal(v[0].line, 4);
});

test('PAGE-001: a presentation-only page (props in, components out, refs/memo allowed) is clean', () => {
  const clean = `import { Card } from '../components/Card';\nexport function P({ title }: { title: string }){ return <Card title={title} />; }\n`;
  assert.deepEqual(only('PAGE-001', 'page', clean), []);
  assert.deepEqual(only('PAGE-001', 'page', `export function P(){ const r = useRef(null); return <div ref={r}/>; }`), []);
  // a same-spelled property or a local name that is not the hook call
  assert.deepEqual(only('PAGE-001', 'page', `export function P({ api }){ api.useState(0); const useEffectLabel = 1; return <div>{useEffectLabel}</div>; }`), []);
});

test('PAGE-001: does not double-report what PAGE-006 already owns (useMachine/useActor/createMachine)', () => {
  assert.deepEqual(rulesOf('page', `export function P(){ useMachine(); return <div/>; }`), ['PAGE-006']);
});

test('PAGE-001: components, hooks and controllers may hold state and effects (only the page layer is presentation-only)', () => {
  const src = `export function X(){ const [a] = useState(0); useEffect(() => {}, []); return a; }`;
  for (const layer of ['component', 'hook', 'controller']) assert.deepEqual(only('PAGE-001', layer, src), [], layer);
});

// ---- COMPONENT-001 -----------------------------------------------------------------------

test('COMPONENT-001: a component owning an application state machine (useMachine/useActor/createMachine) is flagged', () => {
  for (const name of ['useMachine', 'useActor', 'createMachine']) {
    const v = only('COMPONENT-001', 'component', `import { ${name} } from 'xstate';\nexport function C(){ ${name}(); return <div/>; }`);
    assert.equal(v.length, 1, name);
    assert.match(v[0].message, new RegExp(name));
    assert.deepEqual(v[0].expected, ['props', 'workflow']);
    assert.match(v[0].suggestedFix, /workflows\//);
  }
});

test('COMPONENT-001: a component with ordinary local UI state/effects (useState, useEffect, useRef) is clean', () => {
  const src = `import { useState, useEffect, useRef } from 'react';\nexport function C(){ const [a, setA] = useState(0); const r = useRef(null); useEffect(() => { r.current?.focus(); }, []); return <button ref={r} onClick={() => setA(a + 1)}>{a}</button>; }`;
  assert.deepEqual(rulesOf('component', src).filter((r) => r === 'COMPONENT-001'), []);
});

test('COMPONENT-001: only the component layer is checked (a workflow/hook may own a machine)', () => {
  const src = `import { createMachine } from 'xstate';\nexport const m = createMachine({});`;
  assert.deepEqual(only('COMPONENT-001', 'workflow', src), []);
  assert.deepEqual(only('COMPONENT-001', 'hook', src), []);
});

// ---- PURE-001 ----------------------------------------------------------------------------

test('PURE-001: Math.random(), Date.now(), new Date(), Date(), performance.now(), crypto.randomUUID()/getRandomValues() in domain code are flagged', () => {
  const cases = [
    ['Math.random()', `export const f = () => Math.random();`],
    ['Date.now()', `export const f = () => Date.now();`],
    ['new Date()', `export const f = () => new Date().toISOString();`],
    ['Date()', `export const f = () => Date();`],
    ['performance.now()', `export const f = () => performance.now();`],
    ['crypto.randomUUID()', `export const f = () => crypto.randomUUID();`],
    ['crypto.getRandomValues()', `export const f = () => crypto.getRandomValues(new Uint8Array(4));`],
  ];
  for (const [name, src] of cases) {
    const v = only('PURE-001', 'domain', src);
    assert.equal(v.length, 1, name);
    assert.ok(v[0].message.includes(name), `${name}: ${v[0].message}`);
    assert.deepEqual(v[0].expected, ['pure function']);
    assert.match(v[0].suggestedFix, /parameter/);
  }
});

test('PURE-001: deterministic uses of the same names are clean -- new Date(x), Date.parse/UTC, Math.floor, a parameter that shadows the global', () => {
  const clean = [
    `export const f = (iso: string) => new Date(iso).getTime();`,
    `export const f = (y: number) => Date.UTC(y, 0, 1) + Date.parse('2020-01-01');`,
    `export const f = (x: number) => Math.floor(x) + Math.max(1, 2);`,
    `export const f = (crypto: { randomUUID(): string }) => crypto.randomUUID();`,
    `export const f = (now: number) => new Date(now);`,
  ];
  for (const src of clean) assert.deepEqual(only('PURE-001', 'domain', src), [], src);
});

test('PURE-001: reports the line, and only the domain layer is checked (a service may read the clock)', () => {
  assert.equal(only('PURE-001', 'domain', `export function f() {\n  return 1;\n}\nexport const g = () => Date.now();\n`)[0].line, 4);
  assert.deepEqual(only('PURE-001', 'service', `export const g = () => Date.now();`), []);
  assert.deepEqual(only('PURE-001', 'hook', `export const g = () => Math.random();`), []);
});

test('PURE-001: does not double-report what DOMAIN-001 already owns (fetch/window/document/storage/navigator)', () => {
  assert.deepEqual(rulesOf('domain', `export const f = () => fetch('/x');`), ['DOMAIN-001']);
});

// ---- end to end (validateArchitecture, the source of `--format json`) --------------------

test('the three rules fire through validateArchitecture with the shared diagnostic fields, at their default (warning) severity, and never fail validation on their own', () => {
  const dir = makeTempDir('construct-597-');
  fs.writeFileSync(path.join(dir, 'architecture.yml'), 'version: 1\npreset: strict-nextjs\nfeatures:\n  root: features\n');
  const put = (rel, body) => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), body);
  };
  put('features/shop/pages/Cart.tsx', `import { useState } from 'react';\nexport function Cart(){ const [n] = useState(0); return <div>{n}</div>; }\n`);
  put('features/shop/components/Pane.tsx', `import { useMachine } from '@xstate/react';\nexport function Pane(){ useMachine(); return <div/>; }\n`);
  put('features/shop/domain/stamp.ts', `export const stamp = () => Date.now();\n`);
  const res = validateArchitecture(dir);
  for (const [rule, file] of [['PAGE-001', 'features/shop/pages/Cart.tsx'], ['COMPONENT-001', 'features/shop/components/Pane.tsx'], ['PURE-001', 'features/shop/domain/stamp.ts']]) {
    const found = res.violations.filter((v) => v.rule === rule);
    assert.equal(found.length, 1, rule);
    assert.equal(found[0].file, file);
    assert.equal(found[0].severity, 'warning');
    assert.ok(found[0].line >= 1 && found[0].suggestedFix, rule);
  }
});

test('a project that lists PAGE-001/COMPONENT-001: error (as every generated architecture.yml does) gets error severity', () => {
  const dir = makeTempDir('construct-597-err-');
  fs.writeFileSync(path.join(dir, 'architecture.yml'), 'version: 1\npreset: strict-nextjs\nfeatures:\n  root: features\nrules:\n  PAGE-001: error\n  COMPONENT-001: error\n  PURE-001: off\n');
  fs.mkdirSync(path.join(dir, 'features/shop/pages'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'features/shop/domain'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'features/shop/pages/Cart.tsx'), `import { useState } from 'react';\nexport function Cart(){ useState(0); return <div/>; }\n`);
  fs.writeFileSync(path.join(dir, 'features/shop/domain/stamp.ts'), `export const stamp = () => Date.now();\n`);
  const res = validateArchitecture(dir);
  assert.equal(res.violations.find((v) => v.rule === 'PAGE-001').severity, 'error');
  assert.equal(res.violations.some((v) => v.rule === 'PURE-001'), false, 'off silences it');
  assert.equal(res.ok, false);
});

test('the shipped architecture-invalid fixture has one file per new rule (manifest checked exactly by architecture-enforcer.test.mjs)', () => {
  const dir = path.join(REPO_ROOT, 'fixtures', 'architecture-invalid');
  const res = validateArchitecture(dir);
  for (const [rule, file] of [['PAGE-001', 'features/bad/pages/Page001.tsx'], ['COMPONENT-001', 'features/bad/components/Component001.tsx'], ['PURE-001', 'features/bad/domain/Pure001.ts']]) {
    assert.deepEqual(res.violations.filter((v) => v.file === file).map((v) => v.rule), [rule], file);
  }
});
