// #628 -- the wizard shape, unit by unit: it is registered on the same mechanism as the other shapes (plan enum, schema, the new `steps` argument,
// touches, usage), its steps are read by fixed rules (default `details,review,done`), its files are a pure function of the request, a request
// that cannot be built writes nothing, and the Requirement chain OFFERS it by fixed rules (a flow worded as steps: wizard | scaffold, the
// rules-only default first). The whole path from a sentence (validate, tsc, the machine walked, the proof broken) is
// test/wizard-shape-chain.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { PLAN_FLOWS, PLAN_SHAPES, planToCommand, validatePlan } from '../packages/core/plan.mjs';
import { expectedFiles } from '../packages/core/plan-touches.mjs';
import { placeCard, planFromBlocks, blockSummary, SHAPE_OPTIONS_BY_SHAPE } from '../packages/core/placement.mjs';
import { suggest } from '../packages/core/decision-provider.mjs';
import { generateProof, proofFiles, proofTouches, PLAYWRIGHT_SHAPES } from '../packages/core/proof.mjs';
import { SHAPES, generateShapeVertical, shapeContext, shapeFiles, shapeTouches } from '../packages/core/shapes.mjs';
import { DEFAULT_STEPS, MAX_STEPS, dealFields, parseSteps } from '../packages/core/shape-wizard.mjs';
import { transitionRows } from '../packages/core/proof-wizard.mjs';
import { parseRequirement } from '../packages/core/requirement-card.mjs';
import { NEEDS_WIZARD_RUNTIME, cardOf, featureTree, initProject, placed, run, shapeProject as project, typeCheck, validateJson } from '../test-utils/shapeChain.mjs';

const LAYERS = ['domain', 'service', 'workflow', 'hook', 'component', 'page', 'controller'];
const WIZ = { shape: 'wizard', name: 'Signup', feature: 'shop', entity: 'Signup', fields: 'id:string,name:string,email:string' };
const SENTENCE = 'A user wants a step by step signup';

test('the wizard shape is registered on the one mechanism: plan enum, schema, flow arguments (steps included) and the shape table agree', () => {
  assert.ok(PLAN_SHAPES.includes('wizard'));
  assert.deepEqual([...PLAN_SHAPES], Object.keys(SHAPES), 'the plan enum and the shape table name the same shapes');
  const schema = JSON.parse(fs.readFileSync(new URL('../schemas/plan.v1.json', import.meta.url), 'utf8'));
  const holders = [];
  (function walk(node) {
    if (Array.isArray(node)) node.forEach(walk);
    else if (node && typeof node === 'object') {
      if (node.properties?.shape?.enum && !node.properties.shape.enum.includes('keyed')) holders.push(node.properties); // the client-state store (#630) has its own shape choice: value, list, keyed
      Object.values(node).forEach(walk);
    }
  })(schema);
  assert.ok(holders.length >= 3, 'create.unit, create.layer and create.proof carry it');
  for (const props of holders) {
    assert.deepEqual(props.shape.enum, [...PLAN_SHAPES], 'the schema mirrors the registry');
    assert.equal(props.steps.type, 'string', 'and carries the steps argument');
  }
  for (const id of ['create.unit', 'create.layer', 'create.proof']) {
    assert.deepEqual(PLAN_FLOWS[id].args.shape.enum, [...PLAN_SHAPES]);
    assert.equal(PLAN_FLOWS[id].args.steps.flag, '--steps');
    assert.equal(PLAN_FLOWS[id].args.steps.required, undefined, 'optional: a wizard without it has the default steps');
  }
  assert.deepEqual([...SHAPES.wizard.layers], LAYERS, 'the seven layers: a slice plus the workflow');
  for (const [layer, needed] of Object.entries(SHAPES.wizard.requires)) assert.ok(needed.every((l) => SHAPES.wizard.layers.includes(l)), `${layer} requires only layers of the shape`);
  assert.deepEqual([...PLAYWRIGHT_SHAPES], ['list', 'detail', 'form', 'dashboard', 'wizard'], 'every shape has a browser flow since #659 (test/proof-browser.test.mjs)');
  assert.equal(planToCommand({ id: 's1', title: 't', flow: 'create.unit', args: { layer: 'workflow', name: 'Signup', feature: 'signup', shape: 'wizard', entity: 'Signup', fields: 'id:string,name:string', steps: 'a,b', source: 'local' }, executor: 'deterministic' }).argv.join(' '), 'create workflow Signup --feature signup --shape wizard --entity Signup --fields id:string,name:string --steps a,b --source local');
});

test('--steps: read by fixed rules, the default is details,review,done, and every problem is named', () => {
  assert.equal(DEFAULT_STEPS, 'details,review,done');
  assert.deepEqual(parseSteps(undefined).map((s) => [s.name, s.label, s.pascal]), [['details', 'Details', 'Details'], ['review', 'Review', 'Review'], ['done', 'Done', 'Done']]);
  assert.deepEqual(parseSteps('shipping-address, payment').map((s) => [s.name, s.label, s.pascal]), [['shipping-address', 'Shipping address', 'ShippingAddress'], ['payment', 'Payment', 'Payment']]);
  assert.deepEqual(parseSteps('').map((s) => s.name), ['details', 'review', 'done'], 'blank is the default');
  const bad = (text, message) => assert.throws(() => parseSteps(text), message, text);
  bad('one', /2 to 6 steps \(got 1\); a single step is a form/);
  bad('a,b,c,d,e,f,g', /2 to 6 steps \(got 7\)/);
  bad('a,a', /"a" is listed twice/);
  bad('a,Bad', /"Bad" must be lower-case/);
  bad('a,2b', /"2b" must be lower-case/);
  bad('a,-b', /"-b" must be lower-case/);
  bad('a,submitting', /"submitting" is a state of the wizard's machine already/);
  assert.equal(MAX_STEPS, 6);
});

test('the fields are dealt to every step but the last, which shows them all and holds none', () => {
  const fields = ['id', 'a', 'b', 'c', 'd', 'e'].map((name) => ({ name, type: name === 'id' ? 'string' : 'string' }));
  const held = (names) => dealFields(fields, names.map((name) => ({ name }))).map((d) => d.fields.map((f) => f.name).join(''));
  assert.deepEqual(held(['one', 'two']), ['abcde', ''], 'two steps: everything on the first');
  assert.deepEqual(held(['one', 'two', 'three']), ['ace', 'bd', ''], 'dealt one after another and round again');
  assert.deepEqual(held(['one', 'two', 'three', 'four', 'five', 'six']), ['a', 'b', 'c', 'd', 'e', ''], 'more steps than fields: the fields first, then steps with none');
});

test('the transition rows say what every state does with every event, from the rules of the flow', () => {
  const steps = [{ name: 'a' }, { name: 'b' }, { name: 'c' }];
  const dealt = [{ name: 'a', fields: [{ name: 'x', type: 'string' }] }, { name: 'b', fields: [{ name: 'y', type: 'boolean' }] }, { name: 'c', fields: [] }];
  const rows = transitionRows(steps, dealt);
  const row = (from, event, values) => rows.find((r) => r[0] === from && r[1] === event && r[2] === values)?.[3];
  assert.equal(row('a', 'NEXT', 'valid'), 'b');
  assert.equal(row('a', 'NEXT', 'empty'), 'a', 'a string step blocks');
  assert.equal(row('b', 'NEXT', 'empty'), 'c', 'a step with only a yes or no field never blocks');
  assert.equal(row('c', 'SUBMIT', 'valid'), 'submitting');
  assert.equal(row('c', 'SUBMIT', 'empty'), 'c', 'every step must be valid');
  assert.equal(row('a', 'SUBMIT', 'valid'), 'a', 'only the last step decides SUBMIT');
  assert.equal(row('submitting', 'RESET', 'valid'), 'submitting');
  assert.equal(row('submitted', 'RESET', 'valid'), 'a');
  assert.equal(row('submitting', 'FAILED', 'valid'), 'c');
  assert.equal(row('c', 'BACK', 'valid'), 'b');
  assert.equal(row('a', 'BACK', 'valid'), 'a');
  assert.equal(rows.length, 5 * 6 + 3, 'six events for each of the five states, plus the second row of NEXT on the two steps that can go on and of SUBMIT on the last');
});

test('a request that cannot be built writes nothing: one step, a clash, steps on another shape, an openapi source with no spec', () => {
  const dir = project();
  const before = featureTree(dir);
  const refused = (request, layers, message) => assert.throws(() => generateShapeVertical(dir, { ...request }, layers), message, JSON.stringify(request));
  refused({ ...WIZ, steps: 'only' }, LAYERS, /2 to 6 steps/);
  refused({ ...WIZ, fields: 'id:string' }, LAYERS, /needs at least one field besides "id"/);
  refused({ ...WIZ, shape: 'form', name: 'AddThing', entity: 'Thing', steps: 'a,b' }, ['domain'], /--steps only applies to the wizard shape/);
  refused({ ...WIZ, source: 'openapi' }, LAYERS, /POST on a path ending in \/signups/);
  assert.throws(() => generateShapeVertical(dir, WIZ, ['domain', 'service', 'hook', 'component', 'page', 'controller']), /import(s)? workflow/, 'a hook imports the machine: the workflow layer must be in the request');
  assert.deepEqual(featureTree(dir), before, 'nothing was written by any of them');
  assert.equal(shapeTouches(dir, { ...WIZ, layer: 'domain', steps: 'only' }), null, 'touches never throws');
  const cli = run(['create', 'layer', 'Signup', '--feature', 'shop', '--layers', 'domain', '--shape', 'wizard', '--steps', 'a,a'], dir);
  assert.notEqual(cli.status, 0);
  assert.match(cli.stderr, /"a" is listed twice/);
  const stray = run(['create', 'layer', 'Signup', '--feature', 'shop', '--layers', 'domain', '--steps', 'a,b'], dir);
  assert.notEqual(stray.status, 0);
  assert.match(stray.stderr, /--steps only applies with --shape/);
});

test('construct create --shape wizard writes the whole flow, and its usage names the shape and --steps', () => {
  const dir = project();
  const out = run(['create', 'layer', 'Signup', '--feature', 'shop', '--layers', LAYERS.join(','), '--shape', 'wizard', '--fields', 'id:string,name:string', '--steps', 'about,confirm', '--format', 'json'], dir);
  assert.equal(out.status, 0, out.stderr);
  const files = JSON.parse(out.stdout).files;
  assert.equal(files.length, 16, 'sixteen files, types.ts among them: one component per step');
  assert.ok(files.includes('features/shop/components/SignupAboutStep.component.tsx') && files.includes('features/shop/components/SignupConfirmStep.component.tsx'));
  assert.ok(files.includes('features/shop/workflows/Signup.workflow.ts'));
  const usage = `${run(['--help'], dir).stdout}`;
  assert.match(usage, /--shape list\|detail\|form\|dashboard\|wizard/);
  assert.match(usage, /\[--steps details,review,done\]/);
  assert.match(usage, /wizard = a multi-step flow run by an XState machine/);
});

test('the names, the context and the endpoint: the entity defaults to the unit name, steps are echoed as given, the endpoint is the plural of the entity', () => {
  const dir = project();
  const ctx = shapeContext(dir, { feature: 'shop', shape: 'wizard', name: 'Checkout', steps: 'cart, payment' });
  assert.equal(ctx.request.entity, 'Checkout');
  assert.equal(ctx.request.steps, 'cart,payment');
  assert.equal(ctx.endpoint, '/api/checkouts');
  assert.deepEqual([ctx.names.machine, ctx.names.workflow, ctx.names.hook, ctx.names.state], ['checkoutMachine', 'CheckoutWorkflow', 'useCheckout', 'CheckoutState']);
  assert.equal(shapeContext(dir, { feature: 'shop', shape: 'wizard', name: 'Checkout' }).request.steps, 'details,review,done', 'the default is echoed too, so a proof command is complete');
  assert.equal(shapeContext(dir, { feature: 'shop', shape: 'list', name: 'Products' }).request.steps, undefined, 'another shape has no steps');
});

test('the files are a pure function of the request; every unit is built with its factory and named Name.layer.ext', () => {
  const dir = project();
  const request = { ...WIZ, steps: 'about,address,confirm' };
  for (const layer of LAYERS) assert.deepEqual(shapeFiles(dir, { ...request, layer }), shapeFiles(dir, { ...request, layer }));
  const all = LAYERS.flatMap((layer) => shapeFiles(dir, { ...request, layer }));
  assert.ok(all.every((f) => /\.(domain|service|workflow|state|component|page|expression|controller)\.tsx?$/.test(f.path) || f.path.endsWith('types.ts')), all.map((f) => path.basename(f.path)).join());
  const of = (base) => all.find((f) => path.basename(f.path) === base).content;
  assert.match(of('Signup.workflow.ts'), /'address': \{\n {6}on: \{\n {8}CHANGE: \{ actions: 'change' \},\n {8}NEXT: \{ guard: \{ type: 'stepIsValid', params: \{ step: 'address' \} \}, target: 'confirm' \},\n {8}BACK: 'about',/);
  assert.match(of('Signup.workflow.ts'), /'confirm': \{[\s\S]*?SUBMIT: \{ guard: 'everyStepIsValid', target: 'submitting' \}/);
  assert.match(of('SignupValidity.domain.ts'), /'about': \['name'\],\n {4}'address': \['email'\],\n {4}'confirm': \[\],/, 'two fields dealt to two steps, none on the last');
  assert.match(of('SignupAddressStep.component.tsx'), /<legend>Address<\/legend>[\s\S]*type="text"/);
  assert.match(of('SignupConfirmStep.component.tsx'), /<dt>Name<\/dt>[\s\S]*<dt>Email<\/dt>/, 'the last step shows everything typed');
  assert.match(of('SignupByStep.expression.tsx'), /if \(state\.step === 'about'\) return[\s\S]*if \(state\.step === 'address'\) return[\s\S]*\n {2}return <SignupFrame \{\.\.\.frame\}>\{notice\}<SignupConfirmStep values=\{state\.values\} \/><\/SignupFrame>;/);
  assert.deepEqual(expectedFiles(dir, 'create.unit', { layer: 'workflow', ...request }).map((f) => `${f.change} ${f.path}`), ['create features/shop/workflows/Signup.workflow.ts']);
  assert.equal(expectedFiles(dir, 'create.unit', { layer: 'component', ...request }).length, 2 + 3 + 2, 'a field, a frame, a component per step, a notice and the again button');
});

// ------------------------------------------------------------------------------------------------- the offer

test('a flow worded as steps is offered wizard | scaffold by fixed rules, and the rules that say no', () => {
  for (const [text, unit] of [[SENTENCE, 'Signup'], ['A customer wants a checkout wizard', 'Checkout'], ['A user wants an onboarding with steps', 'Onboarding'], ['A user wants a multi-step signup', 'Signup'], ['A user wants to add a product in steps', 'AddProduct']]) {
    const { offers, open, complete } = placed(text);
    assert.equal(complete, true, `${text}: the offer never holds the plan back`);
    assert.deepEqual(open, [], text);
    assert.equal(offers.length, 1, text);
    assert.deepEqual(offers[0].options.map((o) => o.id), ['wizard', 'scaffold'], text);
    assert.deepEqual([offers[0].id, offers[0].shape, offers[0].default, offers[0].suggestion.option, offers[0].suggestion.provider, offers[0].unit, offers[0].steps], ['q-shape', 'wizard', 'wizard', 'wizard', 'rules', unit, 'details,review,done'], text);
    assert.ok(offers[0].options.every((o) => o.enabled && o.label.length <= 60 && o.why.length <= 120), 'a chooser summary: capped text');
  }
  assert.deepEqual(SHAPE_OPTIONS_BY_SHAPE.wizard.map((o) => o.id), ['wizard', 'scaffold']);
  assert.equal(placed('A user wants to add a product with a name and a price').offers[0].shape, 'form', 'no wizard word: still a form');
  assert.equal(placed('A user wants to see a list of products').offers[0].shape, 'list');
  const no = [
    'A user wants to click a button', // an interaction with no wizard word
    'A user wants a step by step signup and to see products', // two verbs
    'A user wants to delete a product in steps', // a write that is not a form verb, no flow verb
    'A user wants to add products in steps', // plural: a batch
    'A user wants to add a product and an order in steps', // two data objects
  ];
  for (const text of no) assert.deepEqual(placed(text).offers, [], text);
  assert.deepEqual(blockSummary(placed(SENTENCE)).offers.map((o) => [o.id, o.chosen, o.default]), [['q-shape', null, 'wizard']]);
});

test('the lexicon knows signup, checkout, onboarding, wizard, step, multi-step and step by step: the example sentences parse with no open question', () => {
  for (const text of [SENTENCE, 'A customer wants a checkout wizard', 'A user wants an onboarding with steps', 'A user wants a multi-step signup']) {
    const { card, open } = parseRequirement(text);
    assert.deepEqual([open, card.open], [[], []], text);
  }
  const { card } = parseRequirement(SENTENCE);
  assert.deepEqual(card.verbs.map((v) => [v.text, v.kind]), [['signup', 'interact']]);
  assert.deepEqual(card.nouns.map((n) => [n.text, n.kind]), [['step by step', 'ui-part']]);
});

test('answering the offer applies the shape to the blocks (with a workflow), records who decided, and a wrong option for the card is refused', async () => {
  const first = placed(SENTENCE);
  const [offer] = first.offers;
  const suggestion = await suggest({ id: offer.id, question: offer.question, options: offer.options });
  assert.equal(suggestion.option, 'wizard', 'the rules-only decision provider suggests the matching shape');
  const answered = placed(SENTENCE, { answers: { 'q-shape': { option: suggestion.option, by: 'decision-model', provider: suggestion.provider } } });
  assert.deepEqual(answered.errors, []);
  assert.deepEqual(answered.blocks.map((b) => [b.id, b.placement, b.layers.map((l) => `${l.layer}:${l.name}`)]), [['b1', 'mutation', ['domain:Signup', 'service:Signup', 'workflow:Signup', 'hook:Signup', 'controller:Signup']], ['b1-view', 'presentational', ['component:Signup', 'page:Signup']]]);
  assert.ok(answered.blocks.every((b) => b.shape.name === 'wizard' && b.shape.entity === 'Signup' && b.shape.fields === 'id:string,name:string' && b.shape.steps === 'details,review,done'));
  assert.deepEqual(answered.decisions, [{ question: 'q-shape', option: 'wizard', by: 'decision-model', provider: 'rules' }]);
  assert.equal(answered.offers[0].chosen, 'wizard');
  assert.match(answered.notes[1], /The wizard shape runs 3 steps \(details,review,done; --steps changes them\) with an XState machine in the workflow layer/);
  assert.match(answered.notes[1], /POST \/api\/signups/);
  const scaffold = placed(SENTENCE, { answers: { 'q-shape': 'scaffold' } });
  assert.deepEqual(scaffold.blocks, first.blocks, 'choosing the scaffold is the plain plan');
  assert.deepEqual(scaffold.decisions, [{ question: 'q-shape', option: 'scaffold', by: 'person' }]);
  for (const other of ['list', 'detail', 'form', 'dashboard']) assert.deepEqual(placed(SENTENCE, { answers: { 'q-shape': other } }).errors.map((e) => e.code), ['PLACE_UNKNOWN_OPTION'], `${other} is not an option of this card`);
  assert.deepEqual(blockSummary(answered).lines, ['"signup step by step" is a step-by-step flow run by a state machine (domain, service, workflow, hook, controller).', '"signup step by step" shows the step the machine is in, from props (component, page).']);
});

test('a wizard plan carries the shape, its steps and the workflow layer on every unit, is wired and proven, and plans no browser flow for it', () => {
  for (const playwright of [false, true]) {
    const dir = project();
    if (playwright) fs.writeFileSync(path.join(dir, 'playwright.config.ts'), "export default { testDir: 'features' };\n");
    const answered = placeCard(cardOf(SENTENCE), { framework: 'react-spa', answers: { 'q-shape': 'wizard' } });
    const planned = planFromBlocks(answered.blocks, { feature: 'signup', root: dir, decisions: answered.decisions });
    assert.equal(planned.ok, true, JSON.stringify(planned.errors));
    assert.deepEqual(validatePlan(planned.plan), { valid: true, errors: [] });
    assert.deepEqual(planned.plan.steps.map((s) => s.flow), ['create.feature', ...Array(7).fill('create.unit'), 'add.dependency', 'sync', 'create.route', 'check.types', 'create.proof', 'test.proof'], 'the wiring, the type-check and the proof steps apply to every shape');
    const units = planned.plan.steps.filter((s) => s.flow === 'create.unit');
    assert.deepEqual(units.map((s) => s.args.layer), LAYERS, 'in layer order, the workflow between the service and the hook');
    assert.ok(units.every((s) => s.args.shape === 'wizard' && s.args.name === 'Signup' && s.args.steps === 'details,review,done' && s.args.source === 'local'));
    assert.deepEqual(units.find((s) => s.args.layer === 'hook').dependsOn, ['s1', 's2', 's3', 's4'], 'the hook waits for the feature, the domain, the service and the workflow');
    assert.equal(planned.plan.steps.find((s) => s.flow === 'create.proof').args.steps, 'details,review,done');
    assert.deepEqual(planned.proof.steps.map((s) => s.kind), ['render'], 'the browser flow exists only for the list shape');
    if (playwright) assert.match(planned.proof.playwright.skipped, /No browser flow is planned for Signup \(wizard\)/);
  }
});

test('the proof of a wizard is the render proof: locked, a pure function of the request, and it needs xstate', () => {
  const dir = project();
  fs.writeFileSync(path.join(dir, 'playwright.config.ts'), "export default { testDir: 'features' };\n");
  const request = { ...WIZ, steps: 'about,confirm' };
  const files = proofFiles(dir, { ...request, kind: 'render' });
  assert.deepEqual(files.map((f) => path.basename(f.path)), ['SignupScreen.proof.test.ts']);
  assert.ok(files[0].content.startsWith('// @construct-generated tests v1 - LOCKED, do not edit (#348)\n'));
  assert.equal(files[0].content, proofFiles(dir, { ...request, kind: 'render' })[0].content, 'a pure function of the request');
  assert.deepEqual(proofFiles(dir, { ...request, kind: 'playwright' }).map((f) => path.basename(f.path)), ['signup--screen.spec.ts'], 'the browser flow of the wizard (#659), with the steps of the request');
  assert.deepEqual(proofFiles(dir, { ...request, kind: 'playwright', source: 'local' }), [], 'a local source makes no request to mock');
  assert.deepEqual(proofTouches(dir, request).map((f) => f.path), ['features/shop/tests/generated/SignupScreen.proof.test.ts', 'architecture.yml']);
  assert.match(files[0].content, /construct create proof Signup --feature shop --shape wizard --entity Signup --fields id:string,name:string,email:string --steps about,confirm/);
  assert.match(files[0].content, /import \{ getInitialSnapshot, getNextSnapshot \} from 'xstate';/);
  const made = generateProof(dir, { ...request, name: 'Signup' });
  assert.deepEqual(made.needs, ['react', 'react-dom', 'esbuild', 'xstate']);
  assert.deepEqual(generateProof(project(), { name: 'Products', feature: 'shop', shape: 'list' }).needs, ['react', 'react-dom', 'esbuild'], 'another shape needs no xstate');
});

test('the worked example in docs/PLACEMENT.md runs and produces exactly the commands and files the doc shows', () => {
  const doc = fs.readFileSync(new URL('../docs/PLACEMENT.md', import.meta.url), 'utf8');
  const block = (tag) => JSON.parse(new RegExp(`<!-- ${tag} -->\\n\`\`\`json\\n([\\s\\S]*?)\`\`\``).exec(doc)?.[1] ?? 'null');
  const dir = project();
  const card = cardOf(SENTENCE);
  const [offer] = placeCard(card, { framework: 'react-spa' }).offers;
  const answered = placeCard(card, { framework: 'react-spa', answers: { [offer.id]: { option: offer.default, by: 'decision-model', provider: 'rules' } } });
  const planned = planFromBlocks(answered.blocks, { feature: 'signup', root: dir, decisions: answered.decisions });
  assert.deepEqual(block('wizard-shape-example:commands'), planned.plan.steps.map((step) => `construct ${planToCommand(step).argv.join(' ')}`), 'commands');
  assert.deepEqual(block('wizard-shape-example:files'), planned.files, 'files');
});

// ------------------------------------------------------------------------------ steps and fields the templates and the proof must survive

test('a two-step wizard with a number, a yes or no and a hyphenated step validates, type-checks, is proven, and a broken guard names the transition', NEEDS_WIZARD_RUNTIME, () => {
  const fields = 'id:number,fullName:string,quantity:number,isGift:boolean,note:string';
  const dir = initProject('react-spa', 'wizard');
  assert.equal(run(['create', 'feature', 'gift-order'], dir).status, 0);
  const args = ['--feature', 'gift-order', '--shape', 'wizard', '--entity', 'GiftOrder', '--fields', fields, '--steps', 'gift-details,confirm', '--source', 'local'];
  const layers = run(['create', 'layer', 'GiftOrder', ...args, '--layers', LAYERS.join(',')], dir);
  assert.equal(layers.status, 0, layers.stderr);
  const proof = run(['create', 'proof', 'GiftOrder', ...args], dir);
  assert.equal(proof.status, 0, `${proof.stdout}${proof.stderr}`);
  assert.equal(run(['sync'], dir).status, 0);
  assert.deepEqual(validateJson(dir).violations.filter((v) => v.file.startsWith('features/')).map((v) => `${v.severity} ${v.rule} ${v.file}`), []);
  const tsc = typeCheck(dir, []);
  assert.equal(tsc.status, 0, tsc.output);
  const green = run(['test', 'proof', 'gift-order', '--format', 'json'], dir);
  assert.equal(green.status, 0, `${green.stdout}${green.stderr}`);
  assert.equal(JSON.parse(green.stdout).counts.failed, 0);
  const validity = path.join(dir, 'features', 'gift-order', 'domain', 'GiftOrderValidity.domain.ts');
  assert.match(fs.readFileSync(validity, 'utf8'), /'gift-details': \['fullName', 'quantity', 'isGift', 'note'\],\n {4}'confirm': \[\],/);
  const good = fs.readFileSync(validity, 'utf8');
  fs.writeFileSync(validity, good.replace("quantity: values.quantity.trim() !== '' && Number.isFinite(Number(values.quantity)),", 'quantity: true,'));
  try {
    const red = run(['test', 'proof', 'gift-order', '--format', 'json'], dir);
    assert.equal(red.status, 1, 'a number that need not be a number: the proof fails');
    const failed = JSON.parse(red.stdout).tests.filter((t) => t.status === 'failed');
    assert.ok(failed.length >= 1);
  } finally {
    fs.writeFileSync(validity, good);
  }
});
