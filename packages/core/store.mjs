// #630 (part of epic #616) -- the client-state store: shared state a screen needs (a selection, a cart, a draft) is DECLARED and TRACKED, not a bag of flags. A deterministic
// block with no model: fixed templates, the same request writes the same bytes, and running it twice changes nothing.
//
//   construct create store Cart --feature shop --shape list [--entity CartItem] [--fields id:string,name:string,price:number]
//
//   storeArgIssue(args)               first reason a `create.store` request is invalid (pure; plan.mjs uses it), or null
//   storeContext(root, request)       the names, the fields and the shape of a request (throws a usage error for a bad one)
//   storeFiles(root, request)         pure: the files the store writes, `{ path, content, layer }` (absolute paths)
//   storeTouches(root, request)       the same as a plan step's `touches.files`, plus `types.ts` and the barrel it updates and its proof
//   generateStore(root, request)      write it: the types, the reducer, the hook and the locked proof; idempotent; refuses, with the reason, and writes nothing
//   stateNounsOf(card)                the state nouns of a card that call for a store (not a session, not a role), with the rules default shape
//   stateOffer(target, request)       the closed question `q-state` (store-value | store-list | store-keyed | skip), the rules default first
//
// The three shapes (a closed choice), each with a status union on ONE `status` field (STATE-001 stays silent: no `isLoading`, no `isError`, no flags that can contradict):
//   value   one value       { status: 'empty' } | { status: 'set'; value }                                      actions set, clear
//   list    a list with a selection { status: 'empty' } | { status: 'ready'; items; selectedId }               actions add, remove, select, clear
//   keyed   a map by id     { status: 'empty' } | { status: 'ready'; byId }                                     actions set, remove, clear
// What it writes: `types.ts` gains the entity, `<Name>State` and `<Name>Action` (a discriminated union of typed actions); `domain/<Name>Store.domain.ts` is the pure reducer
// (`reduce<Name>`, `defineDomain`: state and action in, the next state out, the state it is given never changed); `hooks/use<Name>State.state.ts` is the hook (`useTrackedState`
// under the name of the store, and one function per action that goes through the reducer: HOOK-001 holds, there is no logic in the hook); `<Name>Store.proof.test.ts` (locked) drives
// the reducer AND the real hook (one action per render pass) and fails naming the action: `The action "remove" ...: the "ready: b" state is wrong, it reaches empty.`
import path from 'node:path';
import { loadConfig } from './config.mjs';
import { ConstructError, EXIT_CODES } from './diagnostics.mjs';
import { pascalCase, selfCheck } from './generators.mjs';
import { write } from './fs.mjs';
import { syncPublicApi } from './api-composer.mjs';
import { assertFeature, entityFieldsIn, featureDirOf, withDeclarations, writeOwned } from './block-kit.mjs';
import { STORE_SHAPES, storeArgIssue } from './block-args.mjs';
import { EXPECT_LINES, blockProofTouches, proofHeader, writeBlockProof } from './block-proof.mjs';
import { FIELD_TYPES, importLine, lines, lowerFirst, sampleRows, tsLiteral, words } from './shape-kit.mjs';
import { DEFAULT_FIELDS, parseFields, singularOf } from './shapes.mjs';
import { lit } from '../engine/testSpecRender.mjs';

const usage = (message) => new ConstructError(message, { exitCode: EXIT_CODES.USAGE_ERROR });
const rel = (root, abs) => path.relative(root, abs).split(path.sep).join('/');

export { STORE_SHAPES, storeArgIssue };

/** The id of the closed question about a client-state store (chooser summary shape, like `q-route`); several state nouns get `q-state-<kebab-name>`. */
export const STATE_QUESTION_ID = 'q-state';

/** The actions each shape offers, in the order the hook exposes them. */
export const STORE_ACTIONS = Object.freeze({ value: ['set', 'clear'], list: ['add', 'remove', 'select', 'clear'], keyed: ['set', 'remove', 'clear'] });

/**
 * Everything a store's templates need, worked out from a request: the names of every generated identifier, the entity, its fields and the shape. Throws a usage error for a bad request,
 * before anything is written.
 *
 * @param {string} root Project root (its architecture.yml decides the framework and the folders).
 * @param {{ name: string, feature: string, shape: string, entity?: string, fields?: string }} request The store.
 * @returns {{ Name: string, shape: string, entity: string, fields: { name: string, type: string }[], names: object, useClient: boolean, label: string }} The resolved context.
 * @throws {Error} A usage error naming the problem.
 *
 * @example
 * storeContext(root, { name: 'Cart', feature: 'shop', shape: 'list' }).names.hook; // => 'useCartState'
 */
export function storeContext(root, request) {
  const issue = storeArgIssue(request);
  if (issue) throw usage(issue.message);
  const Name = pascalCase(request.name, 'Store');
  const entity = request.entity ?? (request.shape === 'value' ? Name : singularOf(Name));
  const fields = parseFields(request.fields ?? DEFAULT_FIELDS);
  if (fields.find((f) => f.name === 'id').type === 'boolean') throw usage('The "id" field must be a string or a number.');
  const names = { Name, entity, state: `${Name}State`, action: `${Name}Action`, reduce: `reduce${Name}`, hook: `use${Name}State`, domainBase: `${Name}Store` };
  const clashes = [names.entity, names.state, names.action].filter((n, i, all) => all.indexOf(n) !== i);
  if (clashes.length || entity === names.state || entity === names.action) throw usage(`The store name "${Name}" and the entity "${entity}" produce clashing names; give the entity a different name with --entity.`);
  return { Name, shape: request.shape, entity, fields, names, useClient: (loadConfig(root).project?.framework ?? 'nextjs') !== 'react-spa', label: words(Name).join(' ').toLowerCase() };
}

// -------------------------------------------------------------------------------------------------------------- templates

/** The declarations a store adds to the feature's `types.ts`: the entity, the state and the actions. */
function typeBlocks(ctx) {
  const { names, fields, shape, label } = ctx;
  const E = names.entity;
  const id = `${E}['id']`;
  const entity = { declares: E, text: lines(`/** One ${words(E).join(' ').toLowerCase()}, as the ${label} store holds it. */`, `export interface ${E} {`, fields.map((f) => `  ${f.name}: ${FIELD_TYPES[f.type]};`), '}') };
  const state = {
    value: [`  | { status: 'empty' }`, `  | { status: 'set'; value: ${E} };`],
    list: [`  | { status: 'empty' }`, `  | { status: 'ready'; items: ${E}[]; selectedId: ${id} | null };`],
    keyed: [`  | { status: 'empty' }`, `  | { status: 'ready'; byId: Record<string, ${E}> };`],
  }[shape];
  const actions = {
    value: [`  | { type: 'set'; value: ${E} }`, `  | { type: 'clear' };`],
    list: [`  | { type: 'add'; item: ${E} }`, `  | { type: 'remove'; id: ${id} }`, `  | { type: 'select'; id: ${id} | null }`, `  | { type: 'clear' };`],
    keyed: [`  | { type: 'set'; item: ${E} }`, `  | { type: 'remove'; id: ${id} }`, `  | { type: 'clear' };`],
  }[shape];
  const what = { value: 'one value or nothing', list: 'a list of items with at most one selected', keyed: 'items by their id' }[shape];
  return [
    entity,
    { declares: names.state, marker: "status: 'empty'", text: lines(`/** What the ${label} store holds: ${what}. One \`status\` field says which; a state carries only the fields that exist in it. */`, `export type ${names.state} =`, state) },
    { declares: names.action, marker: "type: 'clear'", text: lines(`/** Every change the ${label} store accepts, one typed action each. */`, `export type ${names.action} =`, actions) },
  ];
}

const REDUCERS = {
  value: () => [
    "    case 'set':", "      return { status: 'set', value: action.value };", "    case 'clear':", "      return { status: 'empty' };",
  ],
  list: () => [
    "    case 'add': {", "      const items = state.status === 'ready' ? state.items : [];",
    '      const next = items.some((item) => item.id === action.item.id) ? items.map((item) => (item.id === action.item.id ? action.item : item)) : [...items, action.item];',
    "      return { status: 'ready', items: next, selectedId: state.status === 'ready' ? state.selectedId : null };", '    }',
    "    case 'remove': {", "      if (state.status === 'empty') return state;", '      const items = state.items.filter((item) => item.id !== action.id);',
    "      if (items.length === 0) return { status: 'empty' };", "      return { status: 'ready', items, selectedId: state.selectedId === action.id ? null : state.selectedId };", '    }',
    "    case 'select': {", "      if (state.status === 'empty') return state;", '      if (action.id !== null && !state.items.some((item) => item.id === action.id)) return state;', '      return { ...state, selectedId: action.id };', '    }',
    "    case 'clear':", "      return { status: 'empty' };",
  ],
  keyed: () => [
    "    case 'set': {", "      const byId = state.status === 'ready' ? state.byId : {};", "      return { status: 'ready', byId: { ...byId, [String(action.item.id)]: action.item } };", '    }',
    "    case 'remove': {", "      if (state.status === 'empty') return state;", '      const rest = Object.fromEntries(Object.entries(state.byId).filter(([key]) => key !== String(action.id)));',
    "      return Object.keys(rest).length === 0 ? { status: 'empty' } : { status: 'ready', byId: rest };", '    }',
    "    case 'clear':", "      return { status: 'empty' };",
  ],
};

function domainText(ctx) {
  const { names, shape, label } = ctx;
  return lines(
    importLine('defineDomain'), `import type { ${names.action}, ${names.state} } from '../types';`, '',
    `/** The next state of the ${label} store for one action: pure, the state it is given is never changed, and every action has its own case. */`,
    `export const ${names.reduce} = defineDomain<{ state: ${names.state}; action: ${names.action} }, ${names.state}>('${names.reduce}', ({ state, action }) => {`,
    '  switch (action.type) {', REDUCERS[shape](), '  }', '});',
  );
}

const HOOK_METHODS = (ctx) => {
  const E = ctx.names.entity;
  const id = `${E}['id']`;
  return {
    value: [`    set: (value: ${E}): void => dispatch({ type: 'set', value }),`, "    clear: (): void => dispatch({ type: 'clear' }),"],
    list: [`    add: (item: ${E}): void => dispatch({ type: 'add', item }),`, `    remove: (id: ${id}): void => dispatch({ type: 'remove', id }),`, `    select: (id: ${id} | null): void => dispatch({ type: 'select', id }),`, "    clear: (): void => dispatch({ type: 'clear' }),"],
    keyed: [`    set: (item: ${E}): void => dispatch({ type: 'set', item }),`, `    remove: (id: ${id}): void => dispatch({ type: 'remove', id }),`, "    clear: (): void => dispatch({ type: 'clear' }),"],
  }[ctx.shape];
};

function hookText(ctx) {
  const { names, label, useClient } = ctx;
  return lines(
    useClient ? ["'use client';", ''] : [],
    importLine('useTrackedState'), `import { ${names.reduce} } from '../domain/${names.domainBase}.domain';`, `import type { ${names.action}, ${names.entity}, ${names.state} } from '../types';`, '',
    `/** The ${label} store: one tracked state and one function per action; every change goes through the pure reducer, so the hook holds no logic of its own. */`,
    `export function ${names.hook}() {`,
    `  const [state, setState] = useTrackedState<${names.state}>('${lowerFirst(names.Name)}', { status: 'empty' });`,
    `  const dispatch = (action: ${names.action}): void => setState((current) => ${names.reduce}({ state: current, action }));`,
    '  return {', '    state,', HOOK_METHODS(ctx), '  };', '}',
  );
}

// ------------------------------------------------------------------------------------------------------------------ files

/**
 * The files a store writes, without touching the disk: `{ path (absolute), content, layer }` (the reducer and the hook; `types.ts` and the proof are separate). Throws a usage error for an invalid request.
 *
 * @param {string} root Project root.
 * @param {{ name: string, feature: string, shape: string, entity?: string, fields?: string }} request The store.
 * @returns {{ path: string, content: string, layer: string }[]} The files, in write order.
 * @throws {Error} A usage error naming the problem.
 *
 * @example
 * storeFiles(root, { name: 'Cart', feature: 'shop', shape: 'list' }).map((f) => path.basename(f.path)); // => ['CartStore.domain.ts', 'useCartState.state.ts']
 */
export function storeFiles(root, request) {
  const ctx = storeContext(root, request);
  const dir = featureDirOf(root, request.feature);
  return [
    { path: path.join(dir, 'domain', `${ctx.names.domainBase}.domain.ts`), content: domainText(ctx), layer: 'domain' },
    { path: path.join(dir, 'hooks', `${ctx.names.hook}.state.ts`), content: hookText(ctx), layer: 'hook' },
  ];
}

/**
 * The file name of the proof of a store: `<Name>Store.proof.test.ts`, which `construct test proof <feature>` and a plan's `test.proof` step run.
 *
 * @param {string} name The store name, PascalCase.
 * @returns {string} The proof's file name.
 *
 * @example
 * storeProofName('Cart'); // => 'CartStore.proof.test.ts'
 */
export function storeProofName(name) {
  return `${name}Store.proof.test.ts`;
}

/**
 * The files a `create.store` step declares as its `touches.files`: the reducer and the hook (`create`), the feature's `types.ts` and barrel (`modify`), the proof (`create`) and
 * `architecture.yml` (`modify`, the test regions). Read-only and never throws: an invalid request answers `null`.
 *
 * @param {string} root Project root.
 * @param {{ name: string, feature: string, shape: string, entity?: string, fields?: string }} request The step's arguments.
 * @returns {{ path: string, change: 'create'|'modify', layer?: string }[] | null} The files, or `null`.
 *
 * @example
 * storeTouches(root, { name: 'Cart', feature: 'shop', shape: 'list' }).map((f) => `${f.change} ${f.path}`); // => ['create features/shop/domain/CartStore.domain.ts', ...]
 */
export function storeTouches(root, request) {
  try {
    const files = storeFiles(root, request);
    const feature = featureDirOf(root, request.feature);
    return [
      ...files.map((f) => ({ path: rel(root, f.path), change: 'create', layer: f.layer })),
      { path: rel(root, path.join(feature, 'types.ts')), change: 'modify', layer: 'domain' },
      { path: rel(root, path.join(feature, 'index.ts')), change: 'modify' },
      ...blockProofTouches(root, request.feature, storeProofName(request.name)),
    ];
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------------------------------------------- proof

/**
 * The reference model of a store, written independently of the generated reducer so the proof compares two accounts of the behaviour. A state is in words, not rows:
 * `{ status: 'empty' }`, `{ status: 'set', value }`, `{ status: 'ready', ids, selected? }`; an action is `{ type, id }` (`id` is `a`, `b`, `zz` or `null`). Pure.
 *
 * @param {string} shape `value`, `list` or `keyed`.
 * @param {{ status: string, ids?: string[], selected?: string | null, value?: string }} state The state.
 * @param {{ type: string, id?: string | null }} action The action.
 * @returns {{ status: string, ids?: string[], selected?: string | null, value?: string }} The next state.
 *
 * @example
 * referenceReduce('list', { status: 'empty' }, { type: 'add', id: 'a' }); // => { status: 'ready', ids: ['a'], selected: null }
 */
export function referenceReduce(shape, state, action) {
  const empty = { status: 'empty' };
  if (action.type === 'clear') return empty;
  if (shape === 'value') return { status: 'set', value: action.id };
  const ids = state.status === 'ready' ? state.ids : [];
  if (shape === 'keyed') {
    if (action.type === 'set') return { status: 'ready', ids: ids.includes(action.id) ? ids : [...ids, action.id] };
    if (state.status === 'empty') return state;
    const rest = ids.filter((id) => id !== action.id);
    return rest.length === 0 ? empty : { status: 'ready', ids: rest };
  }
  const selected = state.status === 'ready' ? state.selected : null;
  if (action.type === 'add') return { status: 'ready', ids: ids.includes(action.id) ? ids : [...ids, action.id], selected };
  if (state.status === 'empty') return state;
  if (action.type === 'select') return action.id === null || ids.includes(action.id) ? { ...state, selected: action.id } : state;
  const rest = ids.filter((id) => id !== action.id);
  return rest.length === 0 ? empty : { status: 'ready', ids: rest, selected: selected === action.id ? null : selected };
}

/** The scenarios of a shape: `{ action, when, script }`, the script in words (`add a`, `select b`, `select null`, `clear`). */
function scenariosOf(shape) {
  const S = (type, id) => ({ type, ...(id === undefined ? {} : { id }) });
  const row = (action, when, script) => ({ action, when, script });
  if (shape === 'value') {
    return [row('set', 'on an empty store', [S('set', 'a')]), row('set', 'a second time replaces the value', [S('set', 'a'), S('set', 'b')]), row('clear', 'after a value was set', [S('set', 'a'), S('clear')]), row('clear', 'on an empty store', [S('clear')])];
  }
  if (shape === 'keyed') {
    return [
      row('set', 'on an empty store', [S('set', 'a')]), row('set', 'of a second item', [S('set', 'a'), S('set', 'b')]), row('set', 'of an item that is already there replaces it, it does not repeat it', [S('set', 'a'), S('set', 'a')]),
      row('remove', 'of an item', [S('set', 'a'), S('set', 'b'), S('remove', 'a')]), row('remove', 'of the last item leaves the store empty', [S('set', 'a'), S('remove', 'a')]),
      row('remove', 'on an empty store', [S('remove', 'a')]), row('remove', 'of an item that is not there', [S('set', 'a'), S('remove', 'zz')]),
      row('clear', 'after items were set', [S('set', 'a'), S('set', 'b'), S('clear')]), row('clear', 'on an empty store', [S('clear')]),
    ];
  }
  return [
    row('add', 'on an empty store', [S('add', 'a')]), row('add', 'of a second item', [S('add', 'a'), S('add', 'b')]), row('add', 'of an item that is already there replaces it, it does not repeat it', [S('add', 'a'), S('add', 'a')]),
    row('select', 'of an item', [S('add', 'a'), S('add', 'b'), S('select', 'b')]), row('select', 'of an item that is not there changes nothing', [S('add', 'a'), S('add', 'b'), S('select', 'zz')]),
    row('select', 'with no item clears the selection', [S('add', 'a'), S('select', 'a'), S('select', null)]), row('select', 'on an empty store changes nothing', [S('select', 'a')]),
    row('remove', 'of the selected item leaves nothing selected', [S('add', 'a'), S('add', 'b'), S('select', 'a'), S('remove', 'a')]), row('remove', 'of another item keeps the selection', [S('add', 'a'), S('add', 'b'), S('select', 'a'), S('remove', 'b')]),
    row('remove', 'of the last item leaves the store empty', [S('add', 'a'), S('remove', 'a')]), row('remove', 'on an empty store', [S('remove', 'a')]), row('remove', 'of an item that is not there', [S('add', 'a'), S('add', 'b'), S('remove', 'zz')]),
    row('clear', 'after items were added and one selected', [S('add', 'a'), S('add', 'b'), S('select', 'a'), S('clear')]), row('clear', 'on an empty store', [S('clear')]),
  ];
}

/** The proof's `describe` function, in TypeScript: what a person would say the store holds. */
const DESCRIBE_TS = {
  value: ["  if (state.status === 'empty') return 'empty';", "  return 'set: ' + String(state.value.id);"],
  list: ["  if (state.status === 'empty') return 'empty';", "  const shown = 'ready: ' + state.items.map((item) => String(item.id)).join(', ');", "  return state.selectedId === null ? shown : shown + ' (selected ' + String(state.selectedId) + ')';"],
  keyed: ["  if (state.status === 'empty') return 'empty';", "  return 'ready: ' + Object.keys(state.byId).join(', ');"],
};

/** The step factories of the proof, in TypeScript: one per action the hook and the reducer share. */
const stepFactories = (E) => ({
  value: [`  set: (value: ${E}): Step => ({ action: { type: 'set', value }, call: (store) => store.set(value) }),`],
  list: [`  add: (item: ${E}): Step => ({ action: { type: 'add', item }, call: (store) => store.add(item) }),`, `  remove: (id: ${E}['id']): Step => ({ action: { type: 'remove', id }, call: (store) => store.remove(id) }),`, `  select: (id: ${E}['id'] | null): Step => ({ action: { type: 'select', id }, call: (store) => store.select(id) }),`],
  keyed: [`  set: (item: ${E}): Step => ({ action: { type: 'set', item }, call: (store) => store.set(item) }),`, `  remove: (id: ${E}['id']): Step => ({ action: { type: 'remove', id }, call: (store) => store.remove(id) }),`],
});

function proofText(root, request) {
  const ctx = storeContext(root, request);
  const { names, shape, fields, label } = ctx;
  const E = names.entity;
  const numeric = fields.find((f) => f.name === 'id').type === 'number';
  const [rowA, rowB] = sampleRows(E, fields);
  const idText = { a: String(rowA.id), b: String(rowB.id), zz: numeric ? '999' : 'unknown-id' };
  const describe = (state) => (state.status === 'empty' ? 'empty' : shape === 'value' ? `set: ${idText[state.value]}` : `ready: ${state.ids.map((id) => idText[id]).join(', ')}${shape === 'list' && state.selected ? ` (selected ${idText[state.selected]})` : ''}`);
  const model = (script) => script.reduce((state, s) => referenceReduce(shape, state, s), { status: 'empty' });
  const itemStep = (s) => (shape === 'list' ? s.type === 'add' : s.type === 'set'); // a step that takes a whole item (else an id)
  const arg = (s) => (s.id === undefined ? '' : itemStep(s) ? s.id.toUpperCase() : s.id === null ? 'null' : s.id === 'zz' ? 'ID_ZZ' : `${s.id.toUpperCase()}.id`);
  const call = (s) => `steps.${s.type}(${arg(s)})`;
  const rowLit = (row) => `{ ${Object.entries(row).map(([k, v]) => `${k}: ${typeof v === 'string' ? tsLiteral(v) : v}`).join(', ')} }`;
  const other = fields.find((f) => f.name !== 'id');
  const changed = other ? (other.type === 'string' ? tsLiteral('changed') : other.type === 'number' ? '99' : `!A.${other.name}`) : null;
  const scenarios = scenariosOf(shape);
  const actionNames = STORE_ACTIONS[shape];
  const setter = shape === 'list' ? 'add' : 'set';
  const replaced = { value: "state.status === 'set' ? state.value : null", list: "state.status === 'ready' ? state.items[0] : null", keyed: "state.status === 'ready' ? Object.values(state.byId)[0] : null" }[shape];
  const command = `construct create store ${names.Name} --feature ${request.feature} --shape ${shape} --entity ${E} --fields ${fields.map((f) => `${f.name}:${f.type}`).join(',')}`;
  const relPath = `features/${request.feature}/tests/generated/${storeProofName(names.Name)}`;
  const scripts = [...new Set(scenarios.map((s) => JSON.stringify(s.script)))].map((json) => JSON.parse(json));
  return `${[
    ...proofHeader({ command, feature: request.feature, subject: `${names.Name} store (shape ${shape})` }),
    `// run: construct test proof ${request.feature}   (on its own: npx tsx --test ${relPath})`,
    '//',
    `// Proves the ${label} store with no browser and no server: every action (${actionNames.join(', ')}) through the pure reducer AND through the real hook (React runs it, one action per render pass),`,
    '// against a second account of the behaviour written independently of the store. A failure names the action and the state it reached, for example:',
    `// The action "remove" of the last item leaves the store empty: the empty state is wrong, it reaches ready: ${idText.a}.`,
    '',
    "import { test } from 'node:test';", "import assert from 'node:assert/strict';", "import { createElement } from 'react';", "import { renderToString } from 'react-dom/server';",
    `import { ${names.reduce} } from '../../domain/${names.domainBase}.domain';`, `import { ${names.hook} } from '../../hooks/${names.hook}.state';`, `import type { ${names.action}, ${E}, ${names.state} } from '../../types';`, '',
    `const A: ${E} = ${rowLit(rowA)};`, `const B: ${E} = ${rowLit(rowB)};`, `const ID_ZZ: ${E}['id'] = ${numeric ? '999' : "'unknown-id'"}; // an id that is not in any store`,
    ...(changed ? [`const A2: ${E} = { ...A, ${other.name}: ${changed} }; // the same id with other content`] : []),
    `const EMPTY: ${names.state} = { status: 'empty' };`, '',
    ...EXPECT_LINES, '',
    '/** The state in words a failure can quote: what a person would say the store holds. */',
    `function describe(state: ${names.state}): string {`, ...DESCRIBE_TS[shape], '}', '',
    `type Store = ReturnType<typeof ${names.hook}>;`,
    `type Step = { action: ${names.action}; call: (store: Store) => void };`,
    'const steps = {', ...stepFactories(E)[shape], "  clear: (): Step => ({ action: { type: 'clear' }, call: (store) => store.clear() }),", '};', '',
    '/** The state after the steps, through the pure reducer. */',
    `const viaReducer = (script: Step[]): ${names.state} => script.reduce<${names.state}>((state, step) => ${names.reduce}({ state, action: step.action }), EMPTY);`, '',
    '/** The state after the steps, through the real hook: React renders a probe, and a change made while rendering re-renders it, so each pass runs one step. */',
    `function viaHook(script: Step[]): ${names.state} {`, '  let next = 0;', `  let last: ${names.state} = EMPTY;`, '  function Probe(): null {', `    const store = ${names.hook}();`, '    last = store.state;', '    if (next < script.length) script[next++].call(store);', '    return null;', '  }',
    '  renderToString(createElement(Probe));', '  return last;', '}', '',
    '/** What the hook returns: its state and its functions, by name. */',
    'function exposed(): string {', "  let keys = '';", '  function Probe(): null {', `    keys = Object.keys(${names.hook}()).join(', ');`, '    return null;', '  }', '  renderToString(createElement(Probe));', '  return keys;', '}', '',
    '/** Every script the proof runs, for the check that no action changes the state it is given. */',
    'const SCRIPTS: Step[][] = [', ...scripts.map((script) => `  [${script.map(call).join(', ')}],`), '];', '',
    'function check(action: string, when: string, script: Step[], want: string): void {',
    '  expectState(\'The action "\' + action + \'" \' + when, want, describe(viaReducer(script)));',
    '  expectState(\'The action "\' + action + \'" \' + when + \', through the hook\', want, describe(viaHook(script)));', '}', '',
    `test(${lit(`${names.Name} store: the hook starts empty, and exposes its state and one function per action`)}, () => {`,
    "  expectState('The store before any action', 'empty', describe(viaHook([])));",
    `  expectState('The hook', ${lit(['state', ...actionNames].join(', '))}, exposed());`, '});', '',
    ...actionNames.flatMap((action) => [
      `test(${lit(`${names.Name} store: the action ${action}`)}, () => {`,
      ...scenarios.filter((s) => s.action === action).map((s) => `  check(${lit(action)}, ${lit(s.when)}, [${s.script.map(call).join(', ')}], ${lit(describe(model(s.script)))});`),
      '});', '',
    ]),
    ...(changed ? [
      `test(${lit(`${names.Name} store: ${setter} of an item that is already there keeps the new content`)}, () => {`,
      `  const state = viaReducer([steps.${setter}(A), steps.${setter}(A2)]);`, `  const kept = ${replaced};`,
      `  expectState('The action "${setter}" of an item that is already there', 'the new content', kept !== null && kept.${other.name} === A2.${other.name} ? 'the new content' : 'the old content');`, '});', '',
    ] : []),
    `test(${lit(`${names.Name} store: no action changes the state it is given`)}, () => {`,
    '  for (const script of SCRIPTS) {', '    const last = script[script.length - 1];', '    const before = viaReducer(script.slice(0, -1));', '    const was = describe(before);', '    const shown = JSON.stringify(before);',
    `    ${names.reduce}({ state: before, action: last.action });`,
    "    expectState('The action \"' + last.action.type + '\" given ' + was, 'unchanged', JSON.stringify(before) === shown ? 'unchanged' : 'changed');", '  }', '});',
  ].join('\n')}\n`;
}

// ------------------------------------------------------------------------------------------------------------------ write

/**
 * Write a store into the project: the types, the reducer, the hook and the locked proof. Everything that can refuse is checked before the first byte is written (an existing file with
 * other content, an entity or a state type declared for something else), so a refusal changes nothing. Idempotent: a second run reports `changed: false`.
 *
 * @param {string} root Project root.
 * @param {{ name: string, feature: string, shape: string, entity?: string, fields?: string }} request The store.
 * @returns {{ changed: boolean, files: string[], hook: string, shape: string }} The project-relative files changed and the hook's name.
 * @throws {Error} A usage error naming why nothing was written.
 *
 * @example
 * generateStore(root, { name: 'Cart', feature: 'shop', shape: 'list' }).hook; // => 'useCartState'
 */
export function generateStore(root, request) {
  const ctx = storeContext(root, request);
  assertFeature(root, request.feature);
  const units = storeFiles(root, request);
  const declared = withDeclarations(root, request.feature, typeBlocks(ctx));
  if (declared.conflicts.length) throw usage(`types.ts of "${request.feature}" already declares ${declared.conflicts.join(' and ')} for something else, so the store cannot build on it. Rename that type, or give the store another name. Nothing was written.`);
  const sameEntity = entityFieldsIn(declared.current, ctx.names.entity);
  const wanted = ctx.fields.map((f) => `${f.name}:${f.type}`).join(',');
  if (sameEntity !== null && sameEntity !== wanted) throw usage(`types.ts of "${request.feature}" already declares ${ctx.names.entity} with the fields ${sameEntity}, not ${wanted}. Use --entity with another name, or the same --fields. Nothing was written.`);
  const proof = proofText(root, request);
  const written = writeOwned(root, units);
  const changed = [...written.written];
  if (declared.changed) {
    const types = path.join(featureDirOf(root, request.feature), 'types.ts');
    write(types, declared.text);
    changed.push(rel(root, types));
  }
  const api = syncPublicApi(root, request.feature);
  if (api.changed) changed.push(api.path);
  const wrote = writeBlockProof(root, request.feature, storeProofName(ctx.names.Name), proof);
  if (wrote.changed) changed.push(wrote.file);
  if (wrote.regions.length) changed.push('architecture.yml');
  selfCheck(root, units.map((u) => u.path));
  return { changed: changed.length > 0, files: changed, hook: ctx.names.hook, shape: ctx.shape };
}

// ---------------------------------------------------------------------------------------------------------------- the question

const answerOf = (answer) => (typeof answer === 'string' ? { option: answer } : answer && typeof answer === 'object' ? answer : null);
const pluralWord = (text) => /s$/i.test(text) && !/(?:ss|us|is)$/i.test(text);

/** The option ids of `q-state`: a store of each shape, or none. Prefixed `store-` so no id is also the id of a screen shape (`list`) in the Cockpit's word table. */
export const STATE_OPTIONS = Object.freeze({ 'store-value': 'value', 'store-list': 'list', 'store-keyed': 'keyed' });

/**
 * The state nouns of a requirement card that call for a client-state store: state nouns that are neither a session nor a role ("selected items", "shopping cart"), each with the
 * PascalCase name a store would get and the rules default shape (`list` when the noun is plural or carries the property `selection` or `store`, else `value`). Pure.
 *
 * @param {{ nouns?: { kind: string, text: string, properties?: string[] }[] } | null | undefined} card The requirement card.
 * @returns {{ noun: string, name: string, shape: string }[]} The nouns, in card order, at most three.
 *
 * @example
 * stateNounsOf(cardOf('A user wants to select items in the shopping cart')); // => [{ noun: 'shopping cart', name: 'ShoppingCart', shape: 'list' }]
 */
export function stateNounsOf(card) {
  const found = (card?.nouns ?? []).filter((n) => n.kind === 'state' && !(n.properties ?? []).some((p) => p === 'session' || p === 'role'));
  return found.slice(0, 3).map((n) => {
    const name = words(n.text).map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join('');
    const list = pluralWord(n.text) || (n.properties ?? []).some((p) => p === 'selection' || p === 'store');
    return { noun: n.text, name, shape: list ? 'list' : 'value' };
  }).filter((n) => /^[A-Z][A-Za-z0-9]*$/.test(n.name));
}

/**
 * The closed question about a client-state store (chooser summary shape, id `q-state`, or `q-state-<kebab-name>` when the card has several state nouns): `store-value`, `store-list`,
 * `store-keyed` or `skip`, the rules default FIRST (so the built-in provider suggests it): a list when the noun is plural or a selection or a store, else one value. An unanswered
 * question uses its default, so it never holds a plan back; an answer that is not an option is refused, never replaced. Pure.
 *
 * @param {{ noun: string, name: string, shape: string }} target One entry of `stateNounsOf`.
 * @param {{ id: string, answer?: string | { option: string } }} request The question id and an answer.
 * @returns {{ question: object, shape: string | null, refused: string | null }} The question, the shape the plan uses (`null` for skip) and why an answer was refused.
 *
 * @example
 * stateOffer({ noun: 'shopping cart', name: 'ShoppingCart', shape: 'list' }, { id: 'q-state' }).shape; // => 'list'
 */
export function stateOffer(target, request) {
  const all = {
    'store-value': { id: 'store-value', label: 'One value', enabled: true, why: `The ${target.noun} is one value or nothing: set and clear.` },
    'store-list': { id: 'store-list', label: 'A list with a selection', enabled: true, why: `The ${target.noun} is a list of items, with at most one selected: add, remove, select and clear.` },
    'store-keyed': { id: 'store-keyed', label: 'Items by their id', enabled: true, why: `The ${target.noun} is a map by id: set, remove and clear.` },
    skip: { id: 'skip', label: 'No store', enabled: true, why: 'Leaves state to the screens; add a store later with construct create store.' },
  };
  const first = `store-${target.shape}`;
  const options = [first, ...Object.keys(all).filter((id) => id !== first)].map((id) => all[id]);
  const chosen = answerOf(request.answer)?.option;
  const known = options.find((o) => o.id === chosen);
  const refused = chosen && !known ? `"${chosen}" is not an option of ${request.id}: ${Object.keys(all).join(', ')}.` : null;
  const used = known ? known.id : first;
  const question = { id: request.id, question: `How should the ${target.noun} be kept as client state?`, options, default: first, chosen: known ? known.id : null };
  return { question, shape: used === 'skip' ? null : STATE_OPTIONS[used], refused };
}
