// #630 -- `create.store`: shared client state from a closed list of shapes (value | list | keyed), built on the tracked-state factory, as a deterministic block with a CLI verb
// (`construct create store`), a PLAN_FLOWS entry, derived touches, a closed question (`q-state`) with a rules default read off the requirement card, and refusals that say why
// and write nothing. The whole chain (sentence to plan to run to validate, tsc and the proof) is test/store-chain.test.mjs; this file is the block itself: arguments, files,
// every shape type-checked and proven, the reference model, the question and the refusals.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { STORE_ACTIONS, STORE_SHAPES, referenceReduce, stateNounsOf, stateOffer, storeArgIssue, storeContext, storeFiles, storeTouches } from '../packages/core/store.mjs';
import { PLAN_FLOWS, planToCommand, validatePlan } from '../packages/core/plan.mjs';
import { expectedFiles } from '../packages/core/plan-touches.mjs';
import { flowBlock, flowScopeKind } from '../packages/core/block-flows.mjs';
import { placeCard, planFromBlocks } from '../packages/core/placement.mjs';
import { wiringChooserId } from '../packages/core/decision-trace-adapters.mjs';
import { suggest } from '../packages/core/decision-provider.mjs';
import { NEEDS_RUNTIME, cardOf, featureTree, initProject, run, shapeProject, typeCheck } from '../test-utils/shapeChain.mjs';

const store = (dir, ...more) => run(['create', 'store', 'Cart', '--feature', 'shop', ...more], dir);
const featureViolations = (dir) => JSON.parse(run(['validate', '--format', 'json'], dir).stdout).violations.filter((v) => v.file.startsWith('features/')).map((v) => `${v.severity} ${v.rule} ${v.file}`);

test('the request is checked by named reasons: the shape is closed, names and fields are plain', () => {
  const ok = { name: 'Cart', feature: 'shop', shape: 'list' };
  assert.equal(storeArgIssue(ok), null);
  assert.deepEqual(STORE_SHAPES, ['value', 'list', 'keyed']);
  const arg = (extra) => storeArgIssue({ ...ok, ...extra })?.arg;
  assert.equal(arg({ name: 'cart' }), 'name');
  assert.equal(arg({ feature: 'a b' }), 'feature');
  assert.equal(arg({ shape: 'bag' }), 'shape');
  assert.equal(arg({ shape: undefined }), 'shape');
  assert.equal(arg({ entity: 'item' }), 'entity');
  assert.equal(arg({ fields: 'name:string' }), 'fields', 'an id is required');
  assert.equal(arg({ fields: 'id:string,price:money' }), 'fields');
  assert.equal(arg({ entity: 'Item', fields: 'id:string,price:number' }), undefined);
});

test('the flow is in the registry, derived, and a plan step means exactly the CLI command', () => {
  const flow = PLAN_FLOWS['create.store'];
  assert.equal(flowScopeKind('create.store'), 'derived');
  assert.deepEqual(Object.keys(flow.args), ['name', 'feature', 'shape', 'entity', 'fields', 'dir']);
  assert.deepEqual(flow.args.shape.enum, ['value', 'list', 'keyed']);
  const args = { name: 'Cart', feature: 'shop', shape: 'list', entity: 'CartItem', fields: 'id:string,name:string' };
  assert.deepEqual(planToCommand({ flow: 'create.store', args }).argv, ['create', 'store', 'Cart', '--feature', 'shop', '--shape', 'list', '--entity', 'CartItem', '--fields', 'id:string,name:string']);
  const check = (a, executor = 'deterministic') => validatePlan({ version: 1, ticket: { source: 'text', title: 't' }, steps: [{ id: 's1', title: 't', flow: 'create.store', executor, args: a, touches: { features: [], files: [] } }] });
  assert.equal(check(args).valid, true);
  assert.equal(check({ ...args, shape: 'bag' }).errors[0].code, 'STEP_ARG_ENUM');
  assert.equal(check({ name: 'Cart', feature: 'shop' }).errors[0].code, 'STEP_ARG_MISSING');
  assert.equal(check({ ...args, name: 'cart' }).errors[0].code, 'STEP_ARG_TYPE');
  assert.equal(check({ ...args, fields: 'name:string' }).errors[0].code, 'STEP_ARG_TYPE');
  assert.equal(check(args, 'local-model').errors[0].code, 'STEP_EXECUTOR_NOT_ALLOWED', 'a fixed template: no model');
});

test('the touches are derived: the reducer and the hook, the types and barrel, the proof; an invalid request derives nothing', () => {
  const dir = shapeProject();
  const touched = (args) => (expectedFiles(dir, 'create.store', args) ?? []).map((f) => `${f.change} ${f.path}`);
  assert.deepEqual(touched({ name: 'Cart', feature: 'shop', shape: 'list' }), [
    'create features/shop/domain/CartStore.domain.ts', 'create features/shop/hooks/useCartState.state.ts', 'modify features/shop/types.ts', 'modify features/shop/index.ts', 'create features/shop/tests/generated/CartStore.proof.test.ts', 'modify architecture.yml',
  ]);
  assert.equal(expectedFiles(dir, 'create.store', { name: 'cart', feature: 'shop', shape: 'list' }), null);
  assert.equal(expectedFiles(dir, 'create.store', { name: 'Cart', feature: 'shop', shape: 'bag' }), null);
  assert.deepEqual(flowBlock('create.store').declaredScope({ name: 'Cart', feature: 'shop', shape: 'value' }, { root: dir }).features, ['shop']);
  assert.deepEqual(storeTouches(dir, { name: 'Cart', feature: 'shop', shape: 'keyed' }).map((f) => f.layer), ['domain', 'hook', 'domain', undefined, undefined, undefined]);
  const names = storeContext(dir, { name: 'SelectedItems', feature: 'shop', shape: 'list' });
  assert.deepEqual([names.names.hook, names.names.reduce, names.names.state, names.names.action, names.entity], ['useSelectedItemsState', 'reduceSelectedItems', 'SelectedItemsState', 'SelectedItemsAction', 'SelectedItem'], 'the entity is the singular of a list');
  assert.equal(storeContext(dir, { name: 'Draft', feature: 'shop', shape: 'value' }).entity, 'Draft', 'one value: the entity is the name');
});

test('every shape: the CLI writes the slice with real, typed code, the actions are the closed list, and the hook has no logic and no flags', () => {
  for (const shape of STORE_SHAPES) {
    const dir = shapeProject();
    const res = store(dir, '--shape', shape, '--fields', 'id:string,name:string,done:boolean');
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, new RegExp(`useCartState\\(\\) returns \\{ state, ${STORE_ACTIONS[shape].join(', ')} \\}\\. Run: construct test proof shop`));
    for (const f of storeFiles(dir, { name: 'Cart', feature: 'shop', shape, fields: 'id:string,name:string,done:boolean' })) assert.equal(fs.readFileSync(f.path, 'utf8'), f.content, path.basename(f.path));
    const hook = fs.readFileSync(path.join(dir, 'features/shop/hooks/useCartState.state.ts'), 'utf8');
    assert.match(hook, /useTrackedState<CartState>\('cart', \{ status: 'empty' \}\)/);
    assert.deepEqual([...hook.matchAll(/^ {4}(\w+): /gm)].map((m) => m[1]), STORE_ACTIONS[shape], 'one function per action');
    assert.doesNotMatch(hook, /\b(if|switch|for|while|useEffect|fetch)\b/, 'HOOK-001: nothing but the tracked state and its coupled functions');
    assert.doesNotMatch(hook, /\b(isLoading|isError|loading)\b/, 'no bag of flags');
    const types = fs.readFileSync(path.join(dir, 'features/shop/types.ts'), 'utf8');
    assert.match(types, new RegExp(`export interface ${shape === 'value' ? 'Cart' : 'CartItem'} \\{\\n {2}id: string;\\n {2}name: string;\\n {2}done: boolean;\\n\\}`));
    assert.match(types, /export type CartState =\n {2}\| \{ status: 'empty' \}\n/);
    assert.equal((types.match(/status: '/g) ?? []).length, 2, 'a status union: empty and one more');
    assert.deepEqual(featureViolations(dir), [], `${shape}: the written slice passes every rule, STATE-001 and the phase 1 rules among them, once switched on`);
  }
});

test('the phase 1 rules are ON and the slice still validates: STATE-001 (no bag of flags) stays silent on every shape, and the entity may carry a boolean field', () => {
  const dir = shapeProject();
  const yml = path.join(dir, 'architecture.yml');
  let text = fs.readFileSync(yml, 'utf8');
  for (const rule of ['DOMAIN-002', 'READ-004', 'SERVICE-003', 'STATE-001']) text = text.replace(new RegExp(`^  ${rule}: off$`, 'm'), `  ${rule}: error`);
  fs.writeFileSync(yml, text);
  for (const [name, shape] of [['Cart', 'list'], ['Draft', 'value'], ['Catalog', 'keyed']]) assert.equal(run(['create', 'store', name, '--feature', 'shop', '--shape', shape, '--fields', 'id:string,active:boolean'], dir).status, 0);
  assert.deepEqual(featureViolations(dir), []);
  // ... and STATE-001 is live: a bag of flags in a hook of this feature IS reported.
  fs.writeFileSync(path.join(dir, 'features/shop/hooks/useBag.state.ts'), "import { useTrackedState } from '@line/construct-core/typed-contracts';\n\n/** A bag of flags. */\nexport interface BagState {\n  isLoading: boolean;\n  isError: boolean;\n}\n\n/** The bag. */\nexport function useBagState() {\n  const [state] = useTrackedState<BagState>('bag', { isLoading: false, isError: false });\n  return state;\n}\n");
  assert.ok(featureViolations(dir).some((v) => v.includes('STATE-001')), 'the rule is on, so its silence above means something');
});

test('every shape type-checks and is proven, with three stores in one feature', NEEDS_RUNTIME, () => {
  const dir = initProject('react-spa', 'stores');
  assert.equal(run(['create', 'feature', 'shop'], dir).status, 0);
  for (const [name, shape, fields] of [['Cart', 'list', 'id:string,name:string,price:number'], ['Draft', 'value', 'id:number,title:string'], ['Catalog', 'keyed', 'id:string,active:boolean']]) {
    const res = run(['create', 'store', name, '--feature', 'shop', '--shape', shape, '--fields', fields], dir);
    assert.equal(res.status, 0, res.stderr);
  }
  const tsc = typeCheck(dir, []);
  assert.equal(tsc.status, 0, tsc.output);
  const proof = run(['test', 'proof', 'shop', '--format', 'json'], dir);
  assert.equal(proof.status, 0, `${proof.stdout}${proof.stderr}`);
  const result = JSON.parse(proof.stdout);
  assert.deepEqual([result.counts.failed, result.counts.total], [0, 18]);
  for (const name of ['Cart', 'Draft', 'Catalog']) assert.ok(result.tests.some((t) => t.title === `${name} store: the hook starts empty, and exposes its state and one function per action`), name);
  const json = JSON.parse(run(['create', 'store', 'Cart', '--feature', 'shop', '--shape', 'list', '--fields', 'id:string,name:string,price:number', '--format', 'json'], dir).stdout);
  assert.deepEqual([json.ok, json.kind, json.shape, json.hook, json.files], [true, 'store', 'list', 'useCartState', []], 'the JSON form of a repeated run: nothing changed');
});

test('running it twice changes nothing: the same bytes, and the CLI says so', () => {
  const dir = shapeProject();
  assert.equal(store(dir, '--shape', 'keyed').status, 0);
  const snapshot = featureTree(dir);
  const arch = fs.readFileSync(path.join(dir, 'architecture.yml'), 'utf8');
  const again = store(dir, '--shape', 'keyed');
  assert.equal(again.status, 0);
  assert.match(again.stdout, /^Unchanged: the Cart store already exists \(keyed\)\./);
  assert.deepEqual(featureTree(dir), snapshot);
  assert.equal(fs.readFileSync(path.join(dir, 'architecture.yml'), 'utf8'), arch);
});

test('refusals say why and write nothing: a file with other content, an entity with other fields, a type that means something else, a missing feature, bad flags', () => {
  const dir = shapeProject();
  assert.equal(store(dir, '--shape', 'list').status, 0);
  const tree = featureTree(dir);
  const other = store(dir, '--shape', 'keyed');
  assert.equal(other.status, 2);
  assert.match(other.stderr, /features\/shop\/domain\/CartStore\.domain\.ts, features\/shop\/hooks\/useCartState\.state\.ts already exist with other content, so nothing was written/);
  assert.deepEqual(featureTree(dir), tree, 'nothing was written');

  const fresh = shapeProject();
  assert.equal(run(['create', 'store', 'Draft', '--feature', 'shop', '--shape', 'value', '--entity', 'Item', '--fields', 'id:string,name:string'], fresh).status, 0);
  const mismatch = run(['create', 'store', 'Note', '--feature', 'shop', '--shape', 'list', '--entity', 'Item', '--fields', 'id:string,title:string'], fresh);
  assert.equal(mismatch.status, 2);
  assert.match(mismatch.stderr, /already declares Item with the fields id:string,name:string, not id:string,title:string/);
  assert.equal(fs.existsSync(path.join(fresh, 'features/shop/domain/NoteStore.domain.ts')), false);

  const clash = shapeProject();
  fs.appendFileSync(path.join(clash, 'features/shop/types.ts'), '\nexport type CartState = string;\n');
  assert.match(store(clash, '--shape', 'list').stderr, /already declares CartState for something else/);
  assert.equal(fs.existsSync(path.join(clash, 'features/shop/hooks/useCartState.state.ts')), false);

  assert.match(run(['create', 'store', 'Cart', '--feature', 'ghost', '--shape', 'list'], dir).stderr, /Feature "ghost" not found/);
  assert.match(run(['create', 'store', 'Cart', '--feature', 'shop'], dir).stderr, /Usage: construct create store/);
  assert.match(store(dir, '--shape', 'bag').stderr, /The shape of a store is one of: value, list, keyed/);
  assert.match(store(dir, '--shape', 'list', '--llm', 'claude').stderr, /no model/);
  assert.match(store(dir, '--shape', 'list', '--fields', 'name:string').stderr, /Fields are name:type pairs/);
  assert.match(run(['create', 'store', 'Cart', '--feature', 'shop', '--shape', 'list', '--entity', 'CartState'], dir).stderr, /produce clashing names/);
});

test('the reference model is the second account the proof compares with: it agrees with the reducer on every scenario of every shape', async () => {
  const dir = shapeProject();
  // The reference model is words (ids a, b, zz), the reducer works on rows: compare through the generated proof's own scenarios by running the proof green (it does), and pin the model on the edges.
  assert.deepEqual(referenceReduce('list', { status: 'empty' }, { type: 'add', id: 'a' }), { status: 'ready', ids: ['a'], selected: null });
  assert.deepEqual(referenceReduce('list', { status: 'ready', ids: ['a', 'b'], selected: 'a' }, { type: 'remove', id: 'a' }), { status: 'ready', ids: ['b'], selected: null });
  assert.deepEqual(referenceReduce('list', { status: 'ready', ids: ['a'], selected: 'a' }, { type: 'remove', id: 'a' }), { status: 'empty' });
  assert.deepEqual(referenceReduce('list', { status: 'ready', ids: ['a'], selected: null }, { type: 'select', id: 'zz' }), { status: 'ready', ids: ['a'], selected: null });
  assert.deepEqual(referenceReduce('keyed', { status: 'ready', ids: ['a'] }, { type: 'set', id: 'a' }), { status: 'ready', ids: ['a'] });
  assert.deepEqual(referenceReduce('value', { status: 'set', value: 'a' }, { type: 'set', id: 'b' }), { status: 'set', value: 'b' });
  assert.equal(store(dir, '--shape', 'list').status, 0);
  const proof = fs.readFileSync(path.join(dir, 'features/shop/tests/generated/CartStore.proof.test.ts'), 'utf8');
  assert.ok(proof.startsWith('// @construct-generated tests v1 - LOCKED, do not edit (#348)\n'));
  assert.match(proof, /check\("remove", "of the selected item leaves nothing selected", \[steps\.add\(A\), steps\.add\(B\), steps\.select\(A\.id\), steps\.remove\(A\.id\)\], "ready: cart-item-2"\);/);
  assert.match(proof, /check\("select", "with no item clears the selection", \[steps\.add\(A\), steps\.select\(A\.id\), steps\.select\(null\)\], "ready: cart-item-1"\);/);
});

test('q-state: a state noun that is not a session or a role is a closed question, the rules default FIRST (a list for a plural, a selection or a store, else one value)', async () => {
  const of = (text) => stateNounsOf(cardOf(text));
  assert.deepEqual(of('A user wants to see a list of products with the selected items'), [{ noun: 'selected items', name: 'SelectedItems', shape: 'list' }]);
  assert.deepEqual(of('A user wants to add products to the shopping cart'), [{ noun: 'shopping cart', name: 'ShoppingCart', shape: 'list' }]);
  assert.deepEqual(of('A user wants to see the selected item'), [{ noun: 'selected item', name: 'SelectedItem', shape: 'list' }], 'a selection is a list of at most one selected');
  assert.deepEqual(of('A logged-in user wants to see a list of products'), [], 'a session is not client state');
  assert.deepEqual(of('An admin wants to see a list of products'), [], 'a role is not client state');
  assert.deepEqual(of('A user wants to see a list of products'), []);
  const offer = stateOffer({ noun: 'selected items', name: 'SelectedItems', shape: 'list' }, { id: 'q-state' });
  assert.deepEqual([offer.question.id, offer.shape, offer.question.default, offer.question.options.map((o) => o.id), offer.question.chosen], ['q-state', 'list', 'store-list', ['store-list', 'store-value', 'store-keyed', 'skip'], null]);
  for (const o of offer.question.options) assert.ok(o.label.length <= 60 && o.why.length <= 120, `${o.id} fits the fixed size`);
  const value = stateOffer({ noun: 'draft', name: 'Draft', shape: 'value' }, { id: 'q-state' });
  assert.deepEqual([value.shape, value.question.options[0].id], ['value', 'store-value']);
  const chosen = stateOffer({ noun: 'selected items', name: 'SelectedItems', shape: 'list' }, { id: 'q-state', answer: { option: 'store-keyed', by: 'person' } });
  assert.deepEqual([chosen.shape, chosen.question.chosen, chosen.refused], ['keyed', 'store-keyed', null]);
  assert.equal(stateOffer({ noun: 'selected items', name: 'SelectedItems', shape: 'list' }, { id: 'q-state', answer: 'skip' }).shape, null);
  assert.match(stateOffer({ noun: 'selected items', name: 'SelectedItems', shape: 'list' }, { id: 'q-state', answer: 'list' }).refused, /not an option of q-state/, 'a screen shape id is not a store option: refused, not replaced');
  const s = await suggest({ id: offer.question.id, question: offer.question.question, options: offer.question.options });
  assert.deepEqual([s.option, s.provider], ['store-list', 'rules']);
  assert.equal(wiringChooserId('q-state'), 'requirement.plan.state');
  assert.equal(wiringChooserId('q-state-selected-items'), 'requirement.plan.state');
});

test('planFromBlocks: q-state is raised only when the card is handed over, an answer is a recorded decision, and a refused answer is a typed error', () => {
  const dir = shapeProject();
  const card = cardOf('A user wants to see a list of products with the selected items');
  const placed = placeCard(card, { framework: 'react-spa', answers: { 'q-shape': { option: 'list', by: 'person' } } });
  const noCard = planFromBlocks(placed.blocks, { feature: 'items', root: dir, decisions: placed.decisions });
  assert.equal(noCard.offers.some((o) => o.id === 'q-state'), false, 'no card, no question: existing plans are as they were');
  const withCard = planFromBlocks(placed.blocks, { feature: 'items', root: dir, decisions: placed.decisions, card });
  assert.equal(withCard.ok, true, JSON.stringify(withCard.errors));
  assert.equal(withCard.offers.find((o) => o.id === 'q-state').default, 'store-list');
  const answered = planFromBlocks(placed.blocks, { feature: 'items', root: dir, decisions: placed.decisions, card, answers: { 'q-state': { option: 'store-value', by: 'llm', provider: 'claude' } } });
  assert.equal(answered.plan.steps.find((s) => s.flow === 'create.store').args.shape, 'value');
  assert.deepEqual(answered.decisions.filter((d) => d.question === 'q-state'), [{ question: 'q-state', option: 'store-value', by: 'llm', provider: 'claude' }]);
  const refused = planFromBlocks(placed.blocks, { feature: 'items', root: dir, decisions: placed.decisions, card, answers: { 'q-state': 'nonsense' } });
  assert.equal(refused.ok, false);
  assert.equal(refused.errors[0].code, 'PLAN_STATE_UNAVAILABLE');
  assert.equal(planFromBlocks(placed.blocks, { feature: 'items', root: dir, decisions: placed.decisions, card, wire: false }).offers.some((o) => o.id === 'q-state'), false, 'wire: false leaves the wiring and the extras out');
});
