// STATE-001 (#573/#581): workflow/hook state must not be a bag of co-occurring status flags
// (off by default, opt-in like DOMAIN-002/WORKFLOW-004). Detection: packages/ast/stateShape.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_RULES } from '../packages/core/config.mjs';
import { detectLayerViolations, validateArchitecture } from '../packages/core/architecture-enforcer.mjs';
import { collectBagOfFlagsStates, classifyStateFields } from '../packages/ast/index.mjs';
import { parseToAst } from '../packages/ast/index.mjs';
import { makeTempDir } from '../test-utils/tmpdir.mjs';

const on = (layer, source) => detectLayerViolations(layer, source, { stateUnion: true }).filter((v) => v.rule === 'STATE-001');
const shapes = (source) => collectBagOfFlagsStates(parseToAst(source), source);

// ---- failing fixtures (the bag of flags, in each position the rule reads) ----
const TWO_FLAGS_INTERFACE = `export interface FetchState {\n  isLoading: boolean;\n  isError: boolean;\n  data?: User[];\n}\n`;
const FLAG_ERROR_DATA_ALIAS = `export type State = { loading: boolean; error: string | null; data: Item[] | null };\n`;
const USE_STATE_OBJECT = `import { useState } from 'react';\nexport function useThing() {\n  const [s, set] = useState({ loading: false, error: null, data: null });\n  return s;\n}\n`;
const USE_STATE_INLINE_TYPE = `import { useState } from 'react';\nexport function useThing() {\n  const [s] = useState<{ pending: boolean; failed: boolean; result: number | null }>({ pending: false, failed: false, result: null });\n  return s;\n}\n`;
const USE_REDUCER_CONST = `const empty = { pending: false, failed: false, result: null };\nfunction r(s, a) { return s; }\nexport function useThing() { const [s] = useReducer(r, empty); return s; }\n`;
const INITIAL_CONST_FOREIGN_TYPE = `import type { ListState } from '../types';\nexport const initialList: ListState = { loaded: false, error: null, errorCode: null, data: null, order: 'risk' };\n`;
const XSTATE_CONTEXT = `import { createMachine } from 'xstate';\nexport const m = createMachine({\n  context: { loading: false, error: null, data: null },\n  initial: 'a', states: { a: {} },\n});\n`;
const XSTATE_SETUP_AS = `import { setup } from 'xstate';\nexport const m = setup({ types: { context: {} as { ready: boolean; loaded: boolean } } }).createMachine({ initial: 'a', states: { a: {} } });\n`;

// ---- passing fixtures (the recommended form, and the allowed near-misses) ----
const UNION_STATE = `export type State =\n  | { status: 'idle' }\n  | { status: 'loading' }\n  | { status: 'error'; error: string }\n  | { status: 'success'; data: Item[] };\nexport function useThing() { const [s] = useState<State>({ status: 'idle' }); return s; }\n`;
const SINGLE_FLAG_DATA = `export type State = { loading: boolean; data: Item[] | null };\n`;
const SINGLE_FLAG_ERROR = `export type State = { loading: boolean; error: string | null };\n`;
const STATUS_FIELD_NOT_UNION = `type State = { status: 'loading' | 'error' | 'ready'; pages: string[]; error: string };\nconst LOADING: State = { status: 'loading', pages: [], error: '' };\n`;
const NON_BOOLEAN_FLAG_NAMES = `type State = { ready: Promise<void>; loading: 'yes' | 'no'; success: Payload; data: T };\n`;
const NULL_PAYLOAD_SLOTS = `import type { S } from '../types';\nexport const initialS: S = { loaded: null, pending: null, error: null, editBusy: false };\n`;
const OPTIONS_PARAM_NOT_STATE = `export function useX(opts: { loading: boolean; ready: boolean }) { return opts; }\n`;
const RETURNED_OBJECT_NOT_STATE = `export function useX() { const [s] = useState<State>({ status: 'idle' }); return { loading: s.status === 'loading', error: s.status === 'error' ? s.error : null, data: s.status === 'success' ? s.data : null }; }\ntype State = { status: 'idle' } | { status: 'loading' } | { status: 'error'; error: string } | { status: 'success'; data: number };\n`;

test('STATE-001 is registered off by default and reports nothing unless opted in', () => {
  assert.equal(DEFAULT_RULES['STATE-001'].severity, 'off');
  assert.deepEqual(detectLayerViolations('hook', TWO_FLAGS_INTERFACE).map((v) => v.rule), []);
  assert.deepEqual(detectLayerViolations('workflow', XSTATE_CONTEXT).map((v) => v.rule).filter((r) => r === 'STATE-001'), []);
});

test('STATE-001 only reads the layers that own state (workflow, hook)', () => {
  for (const layer of ['domain', 'service', 'component', 'page', 'controller']) {
    assert.deepEqual(detectLayerViolations(layer, TWO_FLAGS_INTERFACE, { stateUnion: true }).filter((v) => v.rule === 'STATE-001'), [], layer);
  }
  assert.equal(on('hook', TWO_FLAGS_INTERFACE).length, 1);
  assert.equal(on('workflow', TWO_FLAGS_INTERFACE).length, 1);
});

test('STATE-001: two co-occurring flags -- interface, alias, useState (object and inline type), useReducer, initial const, XState context', () => {
  const cases = [
    ['interface', TWO_FLAGS_INTERFACE, 1, /interface "FetchState" is a bag of flags: isLoading, isError, data/],
    ['alias', FLAG_ERROR_DATA_ALIAS, 1, /type "State" is a bag of flags: loading, error, data \(`loading`, `error` and `data` can all be set at once\)/],
    ['useState object', USE_STATE_OBJECT, 3, /useState state is a bag of flags: loading, error, data/],
    ['useState inline type', USE_STATE_INLINE_TYPE, 3, /useState state is a bag of flags: pending, failed, result/],
    ['useReducer const', USE_REDUCER_CONST, 1, /initial state "empty" is a bag of flags: pending, failed, result/],
    ['initial const, foreign type', INITIAL_CONST_FOREIGN_TYPE, 2, /initial state "initialList" is a bag of flags: loaded, error, data/],
    ['xstate context', XSTATE_CONTEXT, 3, /context state is a bag of flags: loading, error, data/],
    ['xstate setup as', XSTATE_SETUP_AS, 2, /context state is a bag of flags: ready, loaded \(`ready` and `loaded` can both be true at once\)/],
  ];
  for (const [label, src, line, re] of cases) {
    const v = on('hook', src);
    assert.equal(v.length, 1, `${label}: one violation`);
    assert.equal(v[0].line, line, `${label}: line`);
    assert.match(v[0].message, re, label);
    assert.deepEqual(v[0].expected, ['a discriminated union on one `status` field']);
    assert.match(v[0].why, /cannot happen/);
  }
});

test('STATE-001: the suggested fix is a concrete, compiling union rewrite that reuses the real field names and types', () => {
  const [iface] = on('hook', TWO_FLAGS_INTERFACE);
  assert.equal(iface.suggestedFix, "replace the fields with a discriminated union: type FetchState = { status: 'idle' } | { status: 'loading' } | { status: 'error'; error: Error } | { status: 'success'; data: User[] }");
  const [alias] = on('hook', FLAG_ERROR_DATA_ALIAS);
  assert.equal(alias.suggestedFix, "replace the fields with a discriminated union: type State = { status: 'idle' } | { status: 'loading' } | { status: 'error'; error: string } | { status: 'success'; data: Item[] }");
  const [hook] = on('hook', USE_STATE_OBJECT);
  assert.equal(hook.suggestedFix, "replace the fields with a discriminated union: type State = { status: 'idle' } | { status: 'loading' } | { status: 'error'; error: Error } | { status: 'success'; data: T }, then useState<State>({ status: 'idle' })");
  const [reducer] = on('hook', USE_REDUCER_CONST);
  assert.match(reducer.suggestedFix, /\{ status: 'success'; result: T \}$/);
  const [initial] = on('workflow', INITIAL_CONST_FOREIGN_TYPE);
  assert.match(initial.suggestedFix, /^replace the fields with a discriminated union: type ListState = /);
  const [ctx] = on('workflow', XSTATE_CONTEXT);
  assert.match(ctx.suggestedFix, /type Context = .*, and type the machine's context as Context$/);
  // a shape with no error/success payload still gets idle + loading + the arms its flags imply
  const [setupAs] = on('workflow', XSTATE_SETUP_AS);
  assert.equal(setupAs.suggestedFix, "replace the fields with a discriminated union: type Context = { status: 'idle' } | { status: 'loading' } | { status: 'success'; data: T }, and type the machine's context as Context");
});

test('STATE-001 negative fixtures: union state, a single flag (with data, or with error), a status field, non-boolean flag names, null payload slots, params/returns', () => {
  for (const [label, src] of Object.entries({ UNION_STATE, SINGLE_FLAG_DATA, SINGLE_FLAG_ERROR, STATUS_FIELD_NOT_UNION, NON_BOOLEAN_FLAG_NAMES, NULL_PAYLOAD_SLOTS, OPTIONS_PARAM_NOT_STATE, RETURNED_OBJECT_NOT_STATE })) {
    assert.deepEqual(on('hook', src), [], label);
    assert.deepEqual(on('workflow', src), [], label);
  }
});

test('STATE-001: a same-file declared type is reported once, never again for the object typed with it', () => {
  const src = `interface S { pending: boolean; failed: boolean }\nconst initial: S = { pending: false, failed: false };\nfunction r(s: S, a: any) { return s; }\nexport function useThing() { const [s] = useReducer(r, initial); const [t] = useState<S>({ pending: false, failed: false }); return [s, t]; }\n`;
  const v = on('hook', src);
  assert.equal(v.length, 1);
  assert.match(v[0].message, /interface "S"/);
  assert.deepEqual(shapes(src).map((s) => s.kind), ['interface']);
});

test('classifyStateFields: the exact boundary of the heuristic', () => {
  const m = (name, shape = 'boolean', typeText = null) => ({ name, shape, typeText });
  assert.equal(classifyStateFields([m('loading'), m('data', 'other')]), null, 'one flag + data is allowed');
  assert.equal(classifyStateFields([m('loading'), m('error', 'other')]), null, 'one flag + error is allowed');
  assert.deepEqual(classifyStateFields([m('loading'), m('error', 'other', 'E'), m('data', 'other', 'T')]).flags, ['loading'], 'one flag + error + data is not');
  assert.deepEqual(classifyStateFields([m('isLoading'), m('isSuccess')]).flags, ['isLoading', 'isSuccess'], 'two flags are not');
  assert.deepEqual(classifyStateFields([m('loading'), m('error')]).flags, ['loading', 'error'], 'a boolean `error` is a flag');
  assert.deepEqual(classifyStateFields([m('loading'), m('hasError')]).flags, ['loading', 'hasError'], 'a prefixed error is a flag');
  assert.equal(classifyStateFields([m('loading', 'other'), m('ready', 'other')]), null, 'non-boolean flag names are not flags');
  assert.equal(classifyStateFields([m('loaded', 'unknown'), m('pending', 'unknown'), m('error', 'unknown')]), null, 'null-initialised slots are payloads, not flags');
});

test('STATE-001: validateArchitecture (the source of `--format json`) has the same fields as other rules and honours the architecture.yml opt-in', () => {
  const dir = makeTempDir('construct-state001-');
  const yml = (rules) => `version: 1\npreset: strict-nextjs\nfeatures:\n  root: features\n${rules}`;
  fs.writeFileSync(path.join(dir, 'architecture.yml'), yml(''));
  fs.mkdirSync(path.join(dir, 'features/shop/hooks'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'features/shop/workflows'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'features/shop/hooks/useCart.tsx'), USE_STATE_OBJECT);
  fs.writeFileSync(path.join(dir, 'features/shop/workflows/Checkout.ts'), `import { createMachine } from 'xstate';\nexport const m = createMachine({ initial: 'a', states: { a: { on: { GO: 'b' } }, b: {} } });\n`);
  const all = () => validateArchitecture(dir).violations;
  assert.deepEqual(all().filter((v) => v.rule === 'STATE-001'), []);
  fs.writeFileSync(path.join(dir, 'architecture.yml'), yml('rules:\n  STATE-001: warning\n'));
  const hits = all().filter((x) => x.rule === 'STATE-001');
  const other = all().find((x) => x.rule === 'WORKFLOW-003');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].severity, 'warning');
  assert.equal(hits[0].file, 'features/shop/hooks/useCart.tsx');
  assert.equal(hits[0].line, 3);
  assert.match(hits[0].suggestedFix, /^replace the fields with a discriminated union: type State = /);
  assert.deepEqual(Object.keys(hits[0]).sort(), Object.keys(other).sort());
  // the union rewrite the fix suggests passes clean
  fs.writeFileSync(path.join(dir, 'features/shop/hooks/useCart.tsx'), UNION_STATE);
  assert.deepEqual(all().filter((x) => x.rule === 'STATE-001'), []);
});
