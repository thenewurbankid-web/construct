// #630 -- the whole chain for the CLIENT-STATE STORE, run for real: the sentence "A user wants to see a list of products with the selected items" goes through
// parseRequirement (the state noun "selected items"), placeCard, planFromBlocks (the requirement card is handed over, so the closed question `q-state` is raised: the rules
// default is a list with a selection, the noun is plural and a selection) and the plan's own commands (planToCommand, run through the CLI) in a fresh `construct init`
// project with the typed-contracts phase 1 rules ON, STATE-001 (no bag of flags) among them. Then: every file that changed is a file the plan declared,
// `construct validate` reports no error and no warning, `tsc --noEmit` passes, the proof RUNS green (every action through the reducer AND the real hook) and a deliberately
// broken store makes it FAIL naming the action, and a second run in a fresh project writes the same bytes. Same guard as test/list-shape-chain.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { planTouches } from '../packages/core/plan.mjs';
import { NEEDS_RUNTIME, execute, featureFiles, initProject, planFor, projectFiles, run, typeCheck, validateJson } from '../test-utils/shapeChain.mjs';

const SENTENCE = 'A user wants to see a list of products with the selected items';
const FEATURE = 'features/products';
const plan = (dir, answers = {}) => planFor(dir, SENTENCE, 'products', 'list', 'endpoint', { card: true, answers });
const proofRun = (dir) => run(['test', 'proof', 'products', '--format', 'json', '--name', 'SelectedItemsStore.proof.test.ts'], dir);
const violations = (dir) => validateJson(dir).violations.map((v) => `${v.severity} ${v.rule} ${v.file}`);

test('the sentence becomes a plan with a store step, runs, and gives typed shared state that validates, type-checks and is PROVEN', NEEDS_RUNTIME, async (t) => {
  const dir = initProject('react-spa', 'store');
  const { planned } = await plan(dir);
  const offer = planned.offers.find((o) => o.id === 'q-state');
  assert.deepEqual([offer.default, offer.options.map((o) => o.id), offer.chosen], ['store-list', ['store-list', 'store-value', 'store-keyed', 'skip'], null], 'the rules default is a list, first');
  const step = planned.plan.steps.find((s) => s.flow === 'create.store');
  assert.deepEqual(step.args, { name: 'SelectedItems', feature: 'products', shape: 'list', entity: 'Product', fields: 'id:string,name:string,price:number' }, 'the store holds the entity of the screen');
  assert.deepEqual(planned.stores, [{ name: 'SelectedItems', noun: 'selected items', shape: 'list', question: 'q-state', step: 's8' }]);
  assert.deepEqual(planned.proof.steps.map((p) => [p.name, p.proofStep, p.verifiedBy]).at(-1), ['SelectedItemsStore', 's8', 's15'], 'the store is part of the chain: its proof must be green too');
  assert.ok(planned.plan.steps.find((s) => s.flow === 'check.types').dependsOn.includes('s8'), 'the type-check waits for the store');

  const before = projectFiles(dir);
  execute(dir, planned.plan);
  const written = featureFiles(dir);
  const declared = planTouches(planned.plan).files.map((f) => f.path).sort();
  const after = projectFiles(dir);
  assert.deepEqual(Object.keys(after).filter((f) => after[f] !== before[f]).sort(), declared, 'every file the commands created or changed is a file the plan declared: nothing was done by hand');

  await t.test('the files it wrote', () => {
    const at = (f) => written[`${FEATURE}/${f}`];
    assert.ok(at('domain/SelectedItemsStore.domain.ts') && at('hooks/useSelectedItemsState.state.ts') && at('tests/generated/SelectedItemsStore.proof.test.ts'));
    assert.match(at('domain/SelectedItemsStore.domain.ts'), /export const reduceSelectedItems = defineDomain<\{ state: SelectedItemsState; action: SelectedItemsAction \}, SelectedItemsState>\('reduceSelectedItems'/);
    assert.match(at('hooks/useSelectedItemsState.state.ts'), /useTrackedState<SelectedItemsState>\('selectedItems', \{ status: 'empty' \}\)/);
    assert.match(at('types.ts'), /export type SelectedItemsState =\n {2}\| \{ status: 'empty' \}\n {2}\| \{ status: 'ready'; items: Product\[\]; selectedId: Product\['id'\] \| null \};/);
    assert.match(at('types.ts'), /export type SelectedItemsAction =\n {2}\| \{ type: 'add'; item: Product \}\n {2}\| \{ type: 'remove'; id: Product\['id'\] \}\n {2}\| \{ type: 'select'; id: Product\['id'\] \| null \}\n {2}\| \{ type: 'clear' \};/);
    assert.equal((at('types.ts').match(/export interface Product\b/g) ?? []).length, 1, 'the entity of the screen is declared once: the store reuses it');
    assert.doesNotMatch(at('hooks/useSelectedItemsState.state.ts'), /\b(isLoading|isError|loading|error)\b/, 'no flags');
    assert.match(at('index.ts'), /useSelectedItemsState/, 'the barrel exports the hook');
    assert.ok(Object.values(written).every((c) => !/\bTODO\b/.test(c)), 'no stub is left to fill');
  });

  await t.test('construct validate: no error and no warning, STATE-001 (no bag of flags) and the other phase 1 rules on', () => {
    assert.deepEqual(violations(dir), []);
    assert.match(fs.readFileSync(path.join(dir, 'architecture.yml'), 'utf8'), /^ {2}STATE-001: error$/m);
  });

  await t.test('tsc --noEmit passes on the features (the proofs included) and the route entry', () => {
    const tsc = typeCheck(dir, ['src/App.tsx']);
    assert.equal(tsc.status, 0, tsc.output);
  });

  await t.test('the proof passes: every action through the reducer and through the real hook, and the chain is complete', () => {
    const res = proofRun(dir);
    assert.equal(res.status, 0, `${res.stdout}${res.stderr}`);
    const result = JSON.parse(res.stdout);
    assert.deepEqual(result.tests.map((x) => x.title), ['SelectedItems store: the hook starts empty, and exposes its state and one function per action', 'SelectedItems store: the action add', 'SelectedItems store: the action remove', 'SelectedItems store: the action select', 'SelectedItems store: the action clear', 'SelectedItems store: add of an item that is already there keeps the new content', 'SelectedItems store: no action changes the state it is given']);
    assert.equal(result.chain.complete, true);
    assert.equal(run(['test', 'proof', 'products', '--format', 'json'], dir).status, 0, 'the screen proof and the store proof run together');
  });

  await t.test('a broken store FAILS the proof, and the message names the action', () => {
    const domain = path.join(dir, 'features', 'products', 'domain', 'SelectedItemsStore.domain.ts');
    const hook = path.join(dir, 'features', 'products', 'hooks', 'useSelectedItemsState.state.ts');
    const cases = [
      // The reducer forgets to clear the selection of a removed item.
      { file: domain, from: 'selectedId: state.selectedId === action.id ? null : state.selectedId', to: 'selectedId: state.selectedId', title: 'SelectedItems store: the action remove', say: 'The action "remove" of the selected item leaves nothing selected: the ready: product-2 state is wrong, it reaches ready: product-2 (selected product-1).', expected: ['ready: product-2', 'ready: product-2 (selected product-1)'] },
      // The hook wires remove to clear: the reducer is right, the hook is not.
      { file: hook, from: "remove: (id: Product['id']): void => dispatch({ type: 'remove', id }),", to: "remove: (id: Product['id']): void => dispatch({ type: 'clear' }),", title: 'SelectedItems store: the action remove', say: 'The action "remove" of the selected item leaves nothing selected, through the hook: the ready: product-2 state is wrong, it reaches empty.', expected: ['ready: product-2', 'empty'] },
      // The reducer changes the state it is given (its output is right).
      { file: domain, from: ': [...items, action.item];', to: ': (items.push(action.item), items);', title: 'SelectedItems store: no action changes the state it is given', say: 'The action "add" given ready: product-1: the unchanged state is wrong, it reaches changed.', expected: ['unchanged', 'changed'] },
      // A selection that is not in the list is accepted.
      { file: domain, from: 'if (action.id !== null && !state.items.some((item) => item.id === action.id)) return state;\n', to: '', title: 'SelectedItems store: the action select', say: 'The action "select" of an item that is not there changes nothing: the ready: product-1, product-2 state is wrong, it reaches ready: product-1, product-2 (selected unknown-id).', expected: ['ready: product-1, product-2', 'ready: product-1, product-2 (selected unknown-id)'] },
    ];
    for (const c of cases) {
      const good = fs.readFileSync(c.file, 'utf8');
      const broken = good.replace(c.from, c.to);
      assert.notEqual(broken, good, `the line was there: ${c.from}`);
      fs.writeFileSync(c.file, broken);
      try {
        const res = proofRun(dir);
        assert.equal(res.status, 1, 'exit 1: the proof ran and failed');
        const result = JSON.parse(res.stdout);
        const own = result.tests.find((x) => x.title === c.title);
        assert.equal(own.status, 'failed', `${c.title} failed: ${result.tests.filter((x) => x.status === 'failed').map((x) => x.title)}`);
        assert.equal(own.failure.kind, 'app', 'the app behaved differently: not a harness problem');
        assert.equal(own.failure.summary, c.say, 'the message names the action and the state');
        assert.deepEqual([own.failure.expected, own.failure.reached], c.expected);
        assert.equal(result.chain.complete, false);
      } finally {
        fs.writeFileSync(c.file, good);
      }
    }
    assert.equal(proofRun(dir).status, 0, 'and the proof is green again once the store is');
  });

  await t.test('the hook runs for real: React holds the state and every function goes through the reducer', async () => {
    const { build } = await import('esbuild');
    fs.mkdirSync(path.join(dir, 'smoke'));
    fs.writeFileSync(path.join(dir, 'smoke', 'entry.tsx'), [
      "import { createElement } from 'react';", "import { renderToString } from 'react-dom/server';",
      "import { useSelectedItemsState } from '../features/products/hooks/useSelectedItemsState.state';",
      "export function run(): string { let out = ''; let i = 0; function P() { const s = useSelectedItemsState(); out = JSON.stringify(s.state); if (i === 0) { i++; s.add({ id: 'x', name: 'n', price: 1 }); } else if (i === 1) { i++; s.select('x'); } return null; } renderToString(createElement(P)); return out; }",
    ].join('\n'));
    const reactDir = fs.realpathSync(path.join(dir, 'node_modules', 'react'));
    await build({ entryPoints: [path.join(dir, 'smoke', 'entry.tsx')], outfile: path.join(dir, 'smoke', 'entry.cjs'), bundle: true, platform: 'node', format: 'cjs', jsx: 'automatic', alias: { react: reactDir }, absWorkingDir: dir, logLevel: 'silent' });
    const { createRequire } = await import('node:module');
    assert.equal(createRequire(import.meta.url)(path.join(dir, 'smoke', 'entry.cjs')).run(), '{"status":"ready","items":[{"id":"x","name":"n","price":1}],"selectedId":"x"}');
  });

  await t.test('a second run in a fresh project writes the same bytes', async () => {
    const other = initProject('react-spa', 'store');
    const again = await plan(other);
    assert.deepEqual(again.planned.plan, planned.plan, 'the same plan');
    execute(other, again.planned.plan);
    assert.deepEqual(featureFiles(other), written, 'the store and its proof included');
    for (const f of ['src/App.tsx', 'architecture.yml']) assert.equal(fs.readFileSync(path.join(other, f), 'utf8'), fs.readFileSync(path.join(dir, f), 'utf8'), `${f} too`);
  });

  await t.test('running the store again changes nothing at all', () => {
    const snapshot = projectFiles(dir);
    const again = run(['create', 'store', 'SelectedItems', '--feature', 'products', '--shape', 'list', '--entity', 'Product', '--fields', 'id:string,name:string,price:number'], dir);
    assert.equal(again.status, 0, again.stderr);
    assert.match(again.stdout, /^Unchanged: the SelectedItems store already exists \(list\)\./);
    assert.deepEqual(projectFiles(dir), snapshot);
  });
});

test('skip: the answer that adds no store. A plan with q-state answered skip has no store step and no proof step of it, and the answer is a recorded decision', NEEDS_RUNTIME, async () => {
  const dir = initProject('react-spa', 'store-skip');
  const { planned } = await plan(dir, { 'q-state': { option: 'skip', by: 'person' } });
  assert.equal(planned.plan.steps.some((s) => s.flow === 'create.store'), false);
  assert.deepEqual(planned.stores, [{ name: 'SelectedItems', noun: 'selected items', shape: null, question: 'q-state', step: null }]);
  assert.deepEqual(planned.decisions.filter((d) => d.question === 'q-state'), [{ question: 'q-state', option: 'skip', by: 'person' }]);
  assert.equal(planned.proof.steps.some((p) => p.name === 'SelectedItemsStore'), false);
});

test('the same store on a Next.js project: the hook is a client file, and everything validates, type-checks and is proven', NEEDS_RUNTIME, async () => {
  const dir = initProject('nextjs', 'store');
  const { planned } = await plan(dir, { 'q-state': { option: 'store-keyed', by: 'person' } });
  assert.equal(planned.plan.steps.find((s) => s.flow === 'create.store').args.shape, 'keyed');
  const before = projectFiles(dir);
  execute(dir, planned.plan);
  const after = projectFiles(dir);
  assert.deepEqual([...Object.keys(after), ...Object.keys(before)].filter((f, i, all) => all.indexOf(f) === i && after[f] !== before[f]).sort(), planTouches(planned.plan).files.map((f) => f.path).sort(), 'no file changed that the plan did not declare');
  assert.ok(featureFiles(dir)[`${FEATURE}/hooks/useSelectedItemsState.state.ts`].startsWith("'use client';"));
  assert.deepEqual(violations(dir), []);
  assert.equal(typeCheck(dir, ['app/products/page.tsx']).status, 0);
  const proof = proofRun(dir);
  assert.equal(proof.status, 0, `${proof.stdout}${proof.stderr}`);
  assert.equal(JSON.parse(proof.stdout).counts.failed, 0);
});
