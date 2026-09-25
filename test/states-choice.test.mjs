// #622 (part of epic #616) -- how a list, detail or dashboard screen shows its loading, empty (or not-found) and error states, as one closed question,
// `q-states`: default | custom | skip-empty | skip-all, stable ids, default `default`. The block and the offer (fixed size, rules-only suggestion), the
// plan (asked beside q-source, carried to every unit and to the proof, a skip warns, an unanswered question changes nothing), the decision trace
// (requirement.plan.states), the generated units of every shape and answer, and the whole chain run for real: the screen validates, type-checks and
// its proof runs green -- a skipped state is PROVEN to show nothing -- and a screen that shows a skipped state fails the proof. Same guard as the
// other chain tests: a lane without react-dom skips those with the reason.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import ts from 'typescript';
import { planFromBlocks } from '../packages/core/placement.mjs';
import { PLAN_FLOWS, PLAN_STATES, planToCommand, planTouches, validatePlan } from '../packages/core/plan.mjs';
import { choicesFromWiring, wiringChooserId } from '../packages/core/decision-trace-adapters.mjs';
import { shapeContext, shapeFiles } from '../packages/core/shapes.mjs';
import { proofFiles } from '../packages/core/proof.mjs';
import { DEFAULT_STATES, STATES_IDS, STATES_QUESTION_ID, STATES_SHAPES, STATES_TABLE, proofViews, readStates, stateNames, statesOffer, viewsOf } from '../packages/core/shape-states.mjs';
import { suggest } from '../packages/core/decision-provider.mjs';
import { runFeatureTests } from '../packages/engine/testRunner.mjs';
import { HAVE_XSTATE, NEEDS_RUNTIME, REPO, execute, featureFiles, initProject, placed, run, shapeProject, typeCheck, validateJson } from '../test-utils/shapeChain.mjs';

const LIST = 'A user wants to see a list of products';
const DETAIL = 'A user wants to see the details of a product';
const DASHBOARD = 'A manager wants an overview of orders with totals';
const WIZARD = 'A user wants a step by step signup';
const FORM = 'A user wants to add a product with a name and a price';

const planOf = (dir, sentence, shape, answers = {}, options = {}) => {
  const blocks = placed(sentence, { answers: { 'q-shape': shape } }).blocks;
  return planFromBlocks(blocks, { feature: 'shop', root: dir, decisions: [], answers: { 'q-source': 'endpoint', ...answers }, ...options });
};
const unitArgs = (planned) => planned.plan.steps.filter((s) => s.flow === 'create.unit').map((s) => s.args.states);
const names = (files) => files.map((f) => path.basename(f.path)).sort();

test('the table is fixed: four ids, the default first and the old behaviour, the same ids as the plan flow and the schema', () => {
  assert.deepEqual(STATES_IDS, ['default', 'custom', 'skip-empty', 'skip-all']);
  assert.deepEqual([...PLAN_STATES], [...STATES_IDS], 'the --states argument of the plan flows');
  assert.deepEqual(PLAN_FLOWS['create.unit'].args.states.enum, [...STATES_IDS]);
  for (const flow of ['create.layer', 'create.unit', 'create.proof']) assert.equal(PLAN_FLOWS[flow].args.states.flag, '--states', flow);
  assert.equal(DEFAULT_STATES, 'default');
  assert.equal(STATES_QUESTION_ID, 'q-states');
  assert.deepEqual([...STATES_SHAPES], ['list', 'detail', 'dashboard']);
  assert.deepEqual(STATES_TABLE.default, { loading: 'notice', empty: 'notice', error: 'notice' });
  assert.deepEqual(viewsOf('skip-empty', 'list'), { loading: 'notice', empty: 'skip', error: 'notice' });
  assert.deepEqual(viewsOf('custom', 'dashboard'), { loading: 'custom', empty: null, error: 'custom' }, 'a dashboard has no empty state');
  assert.deepEqual(proofViews({ views: viewsOf('skip-all', 'list') }), { loading: 'nothing', empty: 'nothing', error: 'nothing' });
  assert.deepEqual(proofViews({ views: viewsOf('custom', 'list') }), { loading: 'shown', empty: 'shown', error: 'shown' }, 'a custom view is still a view');
  const schema = JSON.parse(fs.readFileSync(new URL('../schemas/plan.v1.json', import.meta.url), 'utf8'));
  assert.ok(JSON.stringify(schema).includes('"states"'), 'the schema mirrors the argument');
});

test('readStates: nothing is the default, an unknown one is refused with the choices, a non-default one needs a shape that fetches', () => {
  assert.deepEqual([undefined, '', null].map((v) => readStates(v, 'list')), ['default', 'default', 'default']);
  assert.equal(readStates('skip-all', 'detail'), 'skip-all');
  assert.equal(readStates('default', 'form'), 'default', 'the default is what every shape already is');
  assert.throws(() => readStates('hidden', 'list'), /Unknown states "hidden"\. The states are: default, custom, skip-empty, skip-all\./);
  assert.throws(() => readStates('custom', 'form'), /--states only applies to the list, detail, dashboard shapes/);
  assert.throws(() => readStates('skip-empty', 'dashboard'), /A dashboard screen has no empty state.*default, custom, skip-all/);
  assert.throws(() => readStates('__proto__', 'list'), /Unknown states/);
});

test('statesOffer: the closed question, fixed size, default first, the rules suggest the default, an answer chooses, a bad one is refused', () => {
  const asked = statesOffer({ unit: 'Products', shape: 'list' });
  assert.deepEqual([asked.question.id, asked.question.default, asked.question.chosen, asked.states, asked.warning, asked.refused], ['q-states', 'default', null, 'default', null, null]);
  assert.deepEqual(asked.question.options.map((o) => [o.id, o.enabled]), [['default', true], ['custom', true], ['skip-empty', true], ['skip-all', true]]);
  assert.ok(asked.question.options.every((o) => o.label.length <= 60 && o.why.length > 0 && o.why.length <= 120), 'a fixed size');
  assert.ok(asked.question.question.length <= 160 && asked.question.suggestion.reason.length <= 200);
  assert.deepEqual([asked.question.unit, asked.question.shape, asked.question.suggestion.option, asked.question.suggestion.provider], ['Products', 'list', 'default', 'rules']);
  assert.equal(asked.question.question, 'What should the "Products" screen show while loading, when empty and on an error?');
  assert.equal(statesOffer({ unit: 'Product', shape: 'detail' }).question.question, 'What should the "Product" screen show while loading, when the item is not found and on an error?');
  const dashboard = statesOffer({ unit: 'OrdersDashboard', shape: 'dashboard' });
  assert.deepEqual(dashboard.question.options.map((o) => o.id), ['default', 'custom', 'skip-all'], 'a dashboard has no empty state to skip');
  assert.equal(dashboard.question.question, 'What should the "OrdersDashboard" screen show while loading and on an error?');
  const skip = statesOffer({ unit: 'Products', shape: 'list', answer: { option: 'skip-empty', by: 'person' } });
  assert.deepEqual([skip.states, skip.question.chosen, skip.refused], ['skip-empty', 'skip-empty', null]);
  assert.match(skip.warning, /Products screen has no view for its empty state/);
  assert.match(statesOffer({ unit: 'Products', shape: 'list', answer: 'skip-all' }).warning, /no view for any state.*a failure is silent/);
  assert.equal(statesOffer({ unit: 'Products', shape: 'list', answer: 'custom' }).warning, null, 'a view of your own is not a gap');
  const bad = statesOffer({ unit: 'Products', shape: 'list', answer: 'hidden' });
  assert.deepEqual([bad.states, bad.question.chosen], ['default', null], 'never silently replaced: the default stays and the answer is refused');
  assert.match(bad.refused, /"q-states" has no option "hidden" here\. Options: default, custom, skip-empty, skip-all\./);
  assert.match(statesOffer({ unit: 'OrdersDashboard', shape: 'dashboard', answer: 'skip-empty' }).refused, /Options: default, custom, skip-all\./);
  assert.notEqual(statesOffer({ unit: 'Products', shape: 'list', answer: '__proto__' }).refused, null);
  assert.equal(statesOffer({ unit: 'Signup', shape: 'wizard' }), null, 'a wizard has steps, not a fetch that can be empty');
  assert.equal(statesOffer({ unit: 'AddProduct', shape: 'form' }), null);
  assert.equal(statesOffer({ unit: 'Products', shape: 'list', current: 'custom' }).question.default, 'custom', 'the blocks already ask for custom: that is the default, first');
  assert.equal(statesOffer({ unit: 'OrdersDashboard', shape: 'dashboard', current: 'skip-empty' }).question.default, 'default', 'an option the shape does not have is not a default');
  assert.deepEqual(stateNames('Products', 'list'), { loading: 'ProductsLoading', loadingProps: 'ProductsLoadingProps', empty: 'ProductsEmpty', emptyProps: 'ProductsEmptyProps', error: 'ProductsFailed', errorProps: 'ProductsFailedProps' });
  assert.equal(stateNames('Product', 'detail').empty, 'ProductNotFound');
  assert.equal(stateNames('OrdersDashboard', 'dashboard').empty, null);
});

test('the rules-only decision provider suggests the default, from the summary alone (AI-ready: no paths, a fixed size)', async () => {
  const { question } = statesOffer({ unit: 'Products', shape: 'list' });
  const suggestion = await suggest({ id: question.id, question: question.question, options: question.options });
  assert.equal(suggestion.option, 'default');
  assert.equal(suggestion.provider, 'rules');
  assert.doesNotMatch(JSON.stringify(question), /\/home|\\\\|\.tsx?/, 'no path in the summary');
});

test('a list, detail and dashboard plan ask q-states beside q-source; unanswered it is the default, nobody chose, no argument and no warning; form and wizard are not asked', () => {
  const dir = shapeProject();
  for (const [sentence, shape, ids] of [[LIST, 'list', ['default', 'custom', 'skip-empty', 'skip-all']], [DETAIL, 'detail', ['default', 'custom', 'skip-empty', 'skip-all']], [DASHBOARD, 'dashboard', ['default', 'custom', 'skip-all']]]) {
    const planned = planOf(dir, sentence, shape);
    assert.equal(planned.ok, true, JSON.stringify(planned.errors));
    assert.deepEqual(planned.offers.map((o) => o.id).slice(0, 2), ['q-source', 'q-states'], shape);
    const offer = planned.offers.find((o) => o.id === 'q-states');
    assert.deepEqual([offer.default, offer.chosen, offer.options.map((o) => o.id)], ['default', null, ids], shape);
    assert.equal(planned.plan.steps.some((s) => s.args.states !== undefined), false, `${shape}: a plan that predates the question is unchanged`);
    assert.deepEqual(planned.warnings, [], shape);
    assert.equal(planned.decisions.some((d) => d.question === 'q-states'), false, 'unanswered: nobody chose');
    assert.deepEqual(validatePlan(planned.plan), { valid: true, errors: [] });
  }
  for (const [sentence, shape] of [[WIZARD, 'wizard'], [FORM, 'form']]) assert.equal(planOf(dir, sentence, shape).offers.some((o) => o.id === 'q-states'), false, `${shape} is not asked`);
});

test('answering q-states carries it to every unit and to the proof, deterministically; a skip warns; the plan still validates', () => {
  const dir = shapeProject();
  for (const [sentence, shape, option] of [[LIST, 'list', 'custom'], [LIST, 'list', 'skip-empty'], [DETAIL, 'detail', 'skip-all'], [DASHBOARD, 'dashboard', 'skip-all'], [DASHBOARD, 'dashboard', 'custom']]) {
    const answer = { option, by: 'person' };
    const planned = planOf(dir, sentence, shape, { 'q-states': answer });
    assert.equal(planned.ok, true, JSON.stringify(planned.errors));
    assert.deepEqual([...new Set(unitArgs(planned))], [option], `${shape} ${option}`);
    assert.deepEqual([...new Set(planned.plan.steps.filter((s) => s.flow === 'create.proof').map((s) => s.args.states))], [option], 'the proof carries it');
    assert.deepEqual(planned.decisions.filter((d) => d.question === 'q-states'), [{ question: 'q-states', option, by: 'person' }]);
    assert.equal(planned.offers.find((o) => o.id === 'q-states').chosen, option);
    assert.equal(planned.warnings.length, option.startsWith('skip') ? 1 : 0, 'a skip warns, a view of your own does not');
    assert.deepEqual(validatePlan(planned.plan), { valid: true, errors: [] });
    assert.deepEqual(planOf(dir, sentence, shape, { 'q-states': answer }), planned, 'the same answers make the same plan');
    const cmd = planToCommand(planned.plan.steps.find((s) => s.flow === 'create.unit' && s.args.layer === 'page')).argv;
    assert.equal(cmd[cmd.indexOf('--states') + 1], option, 'the step runs as --states <option>');
  }
  const explicit = planOf(dir, LIST, 'list', { 'q-states': { option: 'default', by: 'person' } });
  assert.equal(explicit.plan.steps.some((s) => s.args.states !== undefined), false, 'an explicit default writes what the default always wrote');
  assert.deepEqual(explicit.decisions.filter((d) => d.question === 'q-states'), [{ question: 'q-states', option: 'default', by: 'person' }], 'but the choice is recorded');
  const attributed = planOf(dir, LIST, 'list', { 'q-states': { option: 'custom', by: 'decision-model', provider: 'rules' } });
  assert.deepEqual(attributed.decisions.at(-1), { question: 'q-states', option: 'custom', by: 'decision-model', provider: 'rules' }, 'who decided is recorded');
});

test('the files a step touches follow the answer: custom adds a component for each state, skip-all drops the notice', () => {
  const dir = shapeProject();
  const touched = (states) => planTouches(planOf(dir, LIST, 'list', { 'q-states': states }).plan).files.map((f) => path.basename(f.path)).filter((f) => /Notice|Loading|Empty|Failed/.test(f)).sort();
  assert.deepEqual(touched('default'), ['ProductsNotice.component.tsx']);
  assert.deepEqual(touched('custom'), ['ProductsEmpty.component.tsx', 'ProductsFailed.component.tsx', 'ProductsLoading.component.tsx']);
  assert.deepEqual(touched('skip-empty'), ['ProductsNotice.component.tsx']);
  assert.deepEqual(touched('skip-all'), []);
});

test('a wrong option is a typed plan error naming the choices, not a silent default', () => {
  const planned = planOf(shapeProject(), LIST, 'list', { 'q-states': 'hidden' });
  assert.equal(planned.ok, false);
  assert.deepEqual(planned.errors.map((e) => [e.code, e.path]), [['PLAN_STATES_UNAVAILABLE', 'answers.q-states']]);
  assert.match(planned.errors[0].message, /Options: default, custom, skip-empty, skip-all/);
});

test('the answer is a decision trace of its own: requirement.plan.states, the question as offered, the attribution', () => {
  assert.deepEqual(['q-states', 'q-states-orders', 'q-statesx'].map(wiringChooserId), ['requirement.plan.states', 'requirement.plan.states', 'requirement.plan.other']);
  const planned = planOf(shapeProject(), LIST, 'list', { 'q-states': { option: 'skip-empty', by: 'person' } });
  const [choice] = choicesFromWiring(planned).filter((c) => c.chooser.id === 'requirement.plan.states');
  assert.deepEqual([choice.chosen, choice.by, choice.summary.id, choice.summary.options.map((o) => o.id), choice.summary.chosen], ['skip-empty', 'person', 'q-states', ['default', 'custom', 'skip-empty', 'skip-all'], null], 'the question as it was offered: chosen is null');
  assert.equal(choicesFromWiring(planOf(shapeProject(), LIST, 'list')).some((c) => c.chooser.id === 'requirement.plan.states'), false, 'an unanswered question records nothing');
});

test('the CLI refuses --states without --shape, for a shape without fetch states, and for a value that is not an option', () => {
  const dir = shapeProject();
  assert.match(run(['create', 'layer', 'Products', '--feature', 'shop', '--layers', 'domain', '--states', 'custom'], dir).stderr, /--states only applies with --shape/);
  const form = run(['create', 'layer', 'AddThing', '--feature', 'shop', '--layers', 'domain,service', '--shape', 'form', '--fields', 'id:string,name:string', '--states', 'skip-all'], dir);
  assert.notEqual(form.status, 0);
  assert.match(form.stderr, /--states only applies to the list, detail, dashboard shapes/);
  const bad = run(['create', 'layer', 'Products', '--feature', 'shop', '--layers', 'domain', '--shape', 'list', '--states', 'hidden'], dir);
  assert.match(bad.stderr, /Unknown states "hidden"/);
});

// ------------------------------------------------------------------------------------------------------------------ the generated units

const request = (shape, states) => ({ shape, name: shape === 'detail' ? 'Product' : shape === 'dashboard' ? 'OrdersDashboard' : 'Products', feature: 'shop', states });
const file = (dir, shape, states, layer, base) => shapeFiles(dir, { ...request(shape, states), layer }).find((f) => path.basename(f.path) === base)?.content;

test('list: the default writes what it always wrote; custom writes a component for each state; a skip removes the view, never the typed state', () => {
  const dir = shapeProject();
  const same = (layer) => shapeFiles(dir, { ...request('list', undefined), layer }).map((f) => [f.path, f.content]);
  for (const layer of ['component', 'page']) assert.deepEqual(shapeFiles(dir, { ...request('list', 'default'), layer }).map((f) => [f.path, f.content]), same(layer), `an explicit default is the unanswered one (${layer})`);
  const ctx = shapeContext(dir, request('list', 'custom'));
  assert.deepEqual([ctx.states, ctx.views, ctx.stateNames.empty], ['custom', { loading: 'custom', empty: 'custom', error: 'custom' }, 'ProductsEmpty']);
  assert.equal(shapeContext(dir, request('list')).request.states, undefined, 'the default is not echoed: the request is what it always was');
  assert.equal(shapeContext(dir, request('list', 'skip-all')).request.states, 'skip-all');

  assert.deepEqual(names(shapeFiles(dir, { ...request('list', 'custom'), layer: 'component' })), ['ProductList.component.tsx', 'ProductRow.component.tsx', 'ProductsEmpty.component.tsx', 'ProductsFailed.component.tsx', 'ProductsLoading.component.tsx']);
  const custom = file(dir, 'list', 'custom', 'page', 'ProductsByStatus.expression.tsx');
  assert.match(custom, /if \(state\.status === 'loading'\) return <ProductsLoading \/>;/);
  assert.match(custom, /if \(state\.status === 'error'\) return <ProductsFailed message=\{state\.message\} \/>;/);
  assert.match(file(dir, 'list', 'custom', 'page', 'ProductsPage.page.tsx'), /<ProductsByStatus state=\{state\}>\n\s+<ProductsEmpty \/>\n\s+<\/ProductsByStatus>/);
  assert.match(file(dir, 'list', 'custom', 'component', 'ProductsFailed.component.tsx'), /role="alert"/);
  assert.match(file(dir, 'list', 'custom', 'component', 'ProductsLoading.component.tsx'), /role="status">Loading products\.\.\./);

  const noEmpty = file(dir, 'list', 'skip-empty', 'page', 'ProductsPage.page.tsx');
  assert.match(noEmpty, /<ProductsByStatus state=\{state\} \/>/);
  assert.doesNotMatch(noEmpty, /Notice|No products yet/, 'the page has no empty view and imports nothing for it');
  assert.match(file(dir, 'list', 'skip-empty', 'page', 'ProductsByStatus.expression.tsx'), /return <ProductsNotice role="status" text="Loading products\.\.\." \/>/, 'loading and error keep their message');
  assert.deepEqual(names(shapeFiles(dir, { ...request('list', 'skip-empty'), layer: 'component' })), ['ProductList.component.tsx', 'ProductRow.component.tsx', 'ProductsNotice.component.tsx']);

  const none = file(dir, 'list', 'skip-all', 'page', 'ProductsByStatus.expression.tsx');
  assert.match(none, /if \(state\.status === 'loading'\) return <><\/>;\n\s+if \(state\.status === 'error'\) return <><\/>;/);
  assert.doesNotMatch(none, /Notice/);
  assert.deepEqual(names(shapeFiles(dir, { ...request('list', 'skip-all'), layer: 'component' })), ['ProductList.component.tsx', 'ProductRow.component.tsx'], 'nothing uses the notice, so it is not written');
  const types = shapeFiles(dir, { ...request('list', 'skip-all'), layer: 'domain' }).find((f) => f.path.endsWith('types.ts')).content;
  assert.match(types, /status: 'loading'/, 'the typed states stay: no illegal state becomes possible');
  assert.match(types, /status: 'error'; message: string/);
});

test('detail: the not-found view is the empty one; dashboard: no empty state, so nothing to skip there', () => {
  const dir = shapeProject();
  assert.deepEqual(names(shapeFiles(dir, { ...request('detail', 'custom'), layer: 'component' })), ['ProductDetailRow.component.tsx', 'ProductDetails.component.tsx', 'ProductFailed.component.tsx', 'ProductLoading.component.tsx', 'ProductNotFound.component.tsx']);
  assert.match(file(dir, 'detail', 'custom', 'page', 'ProductPage.page.tsx'), /<ProductNotFound \/>/);
  assert.match(file(dir, 'detail', 'custom', 'component', 'ProductNotFound.component.tsx'), /role="status">Product not found\./);
  assert.doesNotMatch(file(dir, 'detail', 'skip-empty', 'page', 'ProductPage.page.tsx'), /not found|Notice/);
  assert.match(file(dir, 'detail', 'skip-empty', 'page', 'ProductByStatus.expression.tsx'), /if \(state\.status === 'not-found'\) return <>\{children\}<\/>;/, 'the branch stays: it renders what the page hands it, which is nothing');
  assert.deepEqual(names(shapeFiles(dir, { ...request('dashboard', 'custom'), layer: 'component' })).filter((f) => /Loading|Failed|Empty|Notice/.test(f)), ['OrdersDashboardFailed.component.tsx', 'OrdersDashboardLoading.component.tsx']);
  assert.deepEqual(names(shapeFiles(dir, { ...request('dashboard', 'skip-all'), layer: 'component' })).filter((f) => /Notice/.test(f)), []);
  assert.match(file(dir, 'dashboard', 'skip-all', 'page', 'OrdersDashboardByStatus.expression.tsx'), /if \(state\.status === 'loading'\) return <><\/>;/);
});

test('the proof says what the screen does: a skipped state is asserted to show nothing, and the command line regenerates the same bytes', () => {
  const dir = shapeProject();
  fs.writeFileSync(path.join(dir, 'playwright.config.ts'), 'export default {};\n');
  const proof = (shape, states, kind = 'render') => proofFiles(dir, { name: request(shape).name, feature: 'shop', shape, entity: shape === 'dashboard' ? 'Order' : 'Product', fields: 'id:string,name:string,price:number', states, kind })[0].content;
  assert.equal(proof('list', undefined), proof('list', 'default'), 'an explicit default is the unanswered one');
  const skipped = proof('list', 'skip-all');
  assert.match(skipped, /construct create proof Products .* --states skip-all/);
  assert.match(skipped, /test\("Products screen: the loading state shows nothing \(skipped\)"/);
  assert.match(skipped, /expectState\('The page given status loading', 'nothing'/);
  assert.match(skipped, /expectState\('The page given no rows', 'nothing'/);
  assert.match(skipped, /assert\.equal\(html\.includes\(ERROR_TEXT\), false, 'a skipped error state does not show the message'\)/);
  assert.match(skipped, /expectState\('The controller on its first render', 'nothing'/);
  assert.doesNotMatch(proof('list', 'default'), /--states/);
  const empty = proof('list', 'skip-empty');
  assert.match(empty, /expectState\('The page given status loading', 'loading'/, 'loading is still proven');
  assert.match(empty, /expectState\('The page given no rows', 'nothing'/);
  assert.match(proof('list', 'custom'), /expectState\('The page given no rows', 'empty'/, 'a view of your own shows what the default shows');
  assert.match(proof('detail', 'skip-empty'), /expectState\('The page given status not-found', 'nothing'/);
  assert.match(proof('dashboard', 'skip-all'), /expectState\('The page given an error', 'nothing'/);
  // the browser flow: a skipped state has no flow (a browser cannot tell "not yet" from "nothing"), the others keep theirs
  const browser = proof('list', 'skip-all', 'playwright');
  assert.doesNotMatch(browser, /toBe\('loading'\)|toBe\('empty'\)|toBe\('error'\)/);
  assert.match(browser, /The empty state has no view \(q-states: skipped on purpose\)/);
  assert.match(browser, /screen: the list"/);
  assert.match(proof('list', 'skip-empty', 'playwright'), /toBe\('loading'\)/);
  assert.match(proof('detail', 'skip-empty', 'playwright'), /The not-found state has no view/);
  // every combination is valid TypeScript, render proof and browser flow alike
  const syntaxErrors = (text) => ts.transpileModule(text, { reportDiagnostics: true, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).diagnostics.map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'));
  for (const shape of STATES_SHAPES) {
    for (const states of STATES_IDS.filter((id) => !(id === 'skip-empty' && shape === 'dashboard'))) {
      for (const kind of ['render', 'playwright']) assert.deepEqual(syntaxErrors(proof(shape, states, kind)), [], `${shape} ${states} ${kind}: valid TypeScript`);
    }
  }
});

// ------------------------------------------------------------------------------------------------------------------- the whole chain

const CHAIN = [
  ['list', LIST, 'custom'],
  ['list', LIST, 'skip-empty'],
  ['list', LIST, 'skip-all'],
  ['detail', DETAIL, 'custom'],
  ['detail', DETAIL, 'skip-empty'],
  ['dashboard', DASHBOARD, 'skip-all'],
  ['dashboard', DASHBOARD, 'custom'],
];

for (const [shape, sentence, states] of CHAIN) {
  test(`the ${shape} plan with q-states ${states} runs, and the screen validates, type-checks, renders and is PROVEN`, NEEDS_RUNTIME, async (t) => {
    const dir = initProject('react-spa', `states-${shape}`);
    const blocks = placed(sentence, { answers: { 'q-shape': shape } }).blocks;
    const planned = planFromBlocks(blocks, { feature: 'screen', root: dir, decisions: [], answers: { 'q-source': 'endpoint', 'q-states': { option: states, by: 'person' } } });
    assert.equal(planned.ok, true, JSON.stringify(planned.errors));
    assert.deepEqual(validatePlan(planned.plan), { valid: true, errors: [] });
    execute(dir, planned.plan);
    const written = featureFiles(dir);
    assert.ok(Object.values(written).every((c) => !/\bTODO\b/.test(c)), 'no stub is left to fill');
    const components = Object.keys(written).filter((f) => f.includes('/components/')).map((f) => path.basename(f));
    assert.equal(components.some((f) => /Notice/.test(f)), states !== 'skip-all' && states !== 'custom', 'the notice is written only while a state uses it');
    assert.equal(components.some((f) => /(Loading|Failed)\.component/.test(f)), states === 'custom', 'a component for each state, only for custom');

    await t.test('construct validate: no error and no warning, with the phase 1 rules on', () => {
      assert.deepEqual(validateJson(dir).violations.map((v) => `${v.severity} ${v.rule} ${v.file}`), []);
    });
    await t.test('tsc --noEmit passes on the features (the proof included)', () => {
      const tsc = typeCheck(dir, ['src/App.tsx']);
      assert.equal(tsc.status, 0, tsc.output);
    });
    const proofRun = () => run(['test', 'proof', 'screen', '--format', 'json'], dir);
    await t.test('the proof passes, and a skipped state is asserted to show nothing', () => {
      const res = proofRun();
      assert.equal(res.status, 0, `${res.stdout}${res.stderr}`);
      const result = JSON.parse(res.stdout);
      assert.equal(result.chain.complete, true);
      assert.equal(result.tests.filter((x) => x.status === 'failed').length, 0);
      if (states.startsWith('skip')) assert.ok(result.tests.some((x) => /shows nothing \(skipped\)/.test(x.title)), 'the skip is a proven test, not a gap');
    });
    if (states.startsWith('skip')) {
      await t.test('a screen that shows a skipped state FAILS the proof, and the message names the state', () => {
        const proofText = fs.readFileSync(path.join(dir, 'features', 'screen', 'tests', 'generated', `${planned.plan.steps.find((s) => s.flow === 'create.proof').args.name}Screen.proof.test.ts`), 'utf8');
        const textOf = (name) => JSON.parse(new RegExp(`const ${name} = (".*?");`).exec(proofText)?.[1] ?? 'null');
        // What a hand edit would do: show a state the choice said would show nothing. skip-all: the loading branch shows its message; skip-empty: the page hands the expression its empty message.
        const edit = states === 'skip-all'
          ? { file: 'ByStatus.expression.tsx', from: "if (state.status === 'loading') return <></>;", to: () => `if (state.status === 'loading') return <p role="status">${textOf('LOADING_TEXT')}</p>;`, title: /the loading state shows nothing/ }
          : { file: 'Page.page.tsx', from: /<(\w+ByStatus) state=\{state\} \/>/, to: (m) => `<${m[1]} state={state}><p role="status">${textOf(shape === 'detail' ? 'NOT_FOUND_TEXT' : 'EMPTY_TEXT')}</p></${m[1]}>`, title: /the (empty|not-found) state shows nothing/ };
        const target = path.join(dir, Object.keys(written).find((f) => f.endsWith(edit.file)));
        const good = fs.readFileSync(target, 'utf8');
        const match = typeof edit.from === 'string' ? [edit.from] : edit.from.exec(good);
        const broken = good.replace(edit.from, edit.to(match));
        assert.notEqual(broken, good, 'the branch was there');
        fs.writeFileSync(target, broken);
        try {
          const res = proofRun();
          assert.equal(res.status, 1, 'exit 1: the proof ran and failed');
          const failed = JSON.parse(res.stdout).tests.filter((x) => x.status === 'failed');
          const own = failed.find((x) => edit.title.test(x.title));
          assert.ok(own, failed.map((x) => x.title).join(' | '));
          assert.equal(own.failure.kind, 'app', 'the app behaved differently: not a harness problem');
          assert.equal(own.failure.reached, states === 'skip-all' ? 'loading' : shape === 'detail' ? 'not-found' : 'empty', 'the message names the state the screen showed');
          assert.equal(own.failure.expected, 'nothing');
        } finally {
          fs.writeFileSync(target, good);
        }
        assert.equal(proofRun().status, 0, 'and the proof is green again once the screen is');
      });
    }
  });
}

// -------------------------------------------------------------------------------------------------------------- the browser (opt-in)

const browser = process.env.CONSTRUCT_RUN_PLAYWRIGHT === '1';
const NEEDS_BROWSER = { skip: (!browser && 'set CONSTRUCT_RUN_PLAYWRIGHT=1 (needs ui/e2e node_modules + chromium)') || (!HAVE_XSTATE && 'react-dom, esbuild and typescript are not installed here'), timeout: 240000 };
const BROWSER = [
  { shape: 'list', states: 'skip-empty', feature: 'products', name: 'Products', entity: 'Product', fields: 'id:string,name:string,price:number', route: '/products', title: 'Products screen: loading, then the list' },
  { shape: 'list', states: 'skip-all', feature: 'products', name: 'Products', entity: 'Product', fields: 'id:string,name:string,price:number', route: '/products', title: 'Products screen: the list' },
  { shape: 'detail', states: 'skip-all', feature: 'product', name: 'Product', entity: 'Product', fields: 'id:string,name:string,price:number', route: '/product', title: 'Product screen: the item with every field' },
  { shape: 'dashboard', states: 'skip-all', feature: 'orders-dashboard', name: 'OrdersDashboard', entity: 'Order', fields: 'id:string,total:number', route: '/orders-dashboard', title: 'OrdersDashboard screen: every tile and every panel' },
];

for (const c of BROWSER) {
  test(`the generated Playwright flow of a ${c.shape} screen with q-states ${c.states} PASSES against the real screen in a browser (its skipped states have no flow, the others keep theirs)`, NEEDS_BROWSER, async () => {
    const dir = initProject('react-spa', `states-browser-${c.shape}`);
    assert.equal(run(['create', 'feature', c.feature], dir).status, 0);
    const made = run(['create', 'layer', c.name, '--feature', c.feature, '--layers', 'domain,service,hook,component,page,controller', '--shape', c.shape, '--entity', c.entity, '--fields', c.fields, '--source', 'endpoint', '--states', c.states], dir);
    assert.equal(made.status, 0, made.stderr);
    fs.writeFileSync(path.join(dir, 'playwright.config.ts'), "export default { testDir: 'features' };\n");
    for (const name of ['@playwright', 'playwright', 'playwright-core']) fs.symlinkSync(fs.realpathSync(path.join(REPO, 'ui', 'e2e', 'node_modules', name)), path.join(dir, 'node_modules', name));
    const created = run(['create', 'proof', c.name, '--feature', c.feature, '--shape', c.shape, '--kind', 'playwright', '--entity', c.entity, '--fields', c.fields, '--route', c.route, '--source', 'endpoint', '--states', c.states], dir);
    assert.equal(created.status, 0, created.stderr);
    const { build } = await import('esbuild');
    const out = path.join(dir, 'served');
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(dir, 'entry.tsx'), `import { createRoot } from 'react-dom/client';\nimport { ${c.name}Controller } from './features/${c.feature}/controllers/${c.name}Controller.controller';\ncreateRoot(document.getElementById('root')!).render(<${c.name}Controller />);\n`);
    await build({ entryPoints: [path.join(dir, 'entry.tsx')], outfile: path.join(out, 'app.js'), bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic', absWorkingDir: dir, logLevel: 'silent', alias: { react: fs.realpathSync(path.join(dir, 'node_modules', 'react')) } });
    const html = '<!doctype html><html><body><div id="root"></div><script src="/app.js"></script></body></html>';
    const server = http.createServer((req, res) => {
      if (req.url === '/app.js') { res.setHeader('content-type', 'text/javascript'); res.end(fs.readFileSync(path.join(out, 'app.js'))); } else { res.setHeader('content-type', 'text/html'); res.end(html); }
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const slug = c.name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
      const result = await runFeatureTests(dir, c.feature, { name: `${slug}--screen.spec.ts`, area: 'generated', baseUrl: `http://127.0.0.1:${server.address().port}` });
      assert.equal(result.ok, true, JSON.stringify(result));
      assert.deepEqual(result.tests.map((t) => t.status), result.tests.map(() => 'passed'), JSON.stringify(result.tests.map((t) => [t.title, t.status, t.failure?.message])));
      assert.ok(result.tests.some((t) => t.title === c.title), result.tests.map((t) => t.title).join(' | '));
      assert.equal(result.tests.some((t) => /error state/.test(t.title)), c.states !== 'skip-all', 'a skipped state has no flow');
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
}
