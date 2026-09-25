// #286 -- the Execution Plan contract.
//
// Three things are being proven here, in this order of importance:
//  1. schemas/plan.v1.json and packages/core/plan.mjs's registry/validator cannot drift
//     (the schema's enums, required fields and per-flow `allOf` branches are
//     read out of the file and compared to PLAN_FLOWS, never hand-copied);
//  2. the schema can express EVERY flow the CLI actually has -- there is one
//     real step per registry entry in the full-coverage plan below, each of
//     which is accepted by both validatePlan() and ajv, and each of which
//     planToCommand() turns back into a runnable command;
//  3. every malformed shape is rejected BY NAMED CODE, not by message text.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeTempDir } from '../test-utils/tmpdir.mjs';
import Ajv from 'ajv'; // draft-07 validator (dev dependency, same as unitSummary.test.mjs)
import {
  PLAN_VERSION,
  PLAN_FLOWS,
  PLAN_EXECUTORS,
  PLAN_ERROR_CODES,
  PLAN_TOP_LEVEL_FIELDS,
  PLAN_REQUIRED_FIELDS,
  STEP_FIELDS,
  STEP_REQUIRED_FIELDS,
  TOUCH_CHANGES,
  TICKET_SOURCES,
  createPlan,
  validatePlan,
  planFlow,
  planToCommand,
  planTouches,
  formatPlanErrors,
} from '../packages/core/plan.mjs';
import { validatePlanShape } from '../packages/core/import.mjs';
import { createEnvelope } from '../packages/engine/envelope.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCHEMA = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'schemas', 'plan.v1.json'), 'utf8'));
const ajvValidate = new Ajv({ allErrors: true }).compile(SCHEMA);

const TICKET = { source: 'github-issue', ref: '#286', title: 'Plan schema: ordered steps referencing create/import/edit flows' };
const touching = (feature, file, change = 'create', layer) => ({
  features: [feature],
  files: [{ path: file, change, ...(layer ? { layer } : {}) }],
});

const IMPORT_PLAN = {
  feature: 'checkout',
  units: [{ name: 'Totals', layers: ['domain', 'hook'], from: 'legacy/checkout/useTotals.ts' }],
};

/** One real step per registry entry, in a dependency-valid order. This is the
 * "expresses every flow Construct actually has" proof -- the coverage test
 * below fails the moment a flow is added to the registry without a step here. */
const EVERY_FLOW_STEPS = [
  {
    id: 's-init', title: 'Initialise the project', flow: 'project.init', executor: 'deterministic',
    args: { dir: 'apps/shop', framework: 'react-spa' },
    touches: { features: [], files: [{ path: 'apps/shop/architecture.yml', change: 'create' }] },
  },
  {
    id: 's-feature', title: 'Create the checkout feature', flow: 'create.feature', executor: 'deterministic',
    args: { name: 'checkout' }, dependsOn: ['s-init'],
    touches: touching('checkout', 'features/checkout/index.ts'),
  },
  {
    id: 's-slice', title: 'Scaffold the Totals vertical slice', flow: 'create.layer', executor: 'deterministic',
    args: { name: 'Totals', feature: 'checkout', layers: ['domain', 'service', 'hook'] }, dependsOn: ['s-feature'],
    touches: touching('checkout', 'features/checkout/domain/Totals.ts', 'create', 'domain'),
    estimateSeconds: 3,
    rationale: 'The ticket needs a pure total calculation plus the hook that exposes it.',
  },
  {
    id: 's-unit', title: 'Add the Discount domain unit', flow: 'create.unit', executor: 'local-model',
    args: { layer: 'domain', name: 'Discount', feature: 'checkout', llm: 'ollama' }, dependsOn: ['s-feature'],
    touches: touching('checkout', 'features/checkout/domain/Discount.ts', 'create', 'domain'),
  },
  {
    id: 's-proof', title: 'Write the proof of the Totals screen', flow: 'create.proof', executor: 'deterministic',
    args: { name: 'Totals', feature: 'checkout', shape: 'list', entity: 'Total', fields: 'id:string,name:string', kind: 'render' }, dependsOn: ['s-slice'],
    touches: { features: ['checkout'], files: [{ path: 'features/checkout/tests/generated/TotalsScreen.proof.test.ts', change: 'create' }, { path: 'architecture.yml', change: 'modify' }] },
  },
  {
    id: 's-route', title: 'Wire the Totals screen into the route entry', flow: 'create.route', executor: 'deterministic',
    args: { name: 'Totals', feature: 'checkout', route: '/totals' }, dependsOn: ['s-slice'],
    touches: { features: ['checkout'], files: [{ path: 'app/totals/page.tsx', change: 'create', layer: 'route' }] },
  },
  {
    id: 's-dependency', title: 'Add @line/construct-core to package.json', flow: 'add.dependency', executor: 'deterministic',
    args: { name: '@line/construct-core', version: '^0.9.0' },
    touches: { features: [], files: [{ path: 'package.json', change: 'modify' }] },
  },
  {
    id: 's-env', title: 'Add STRIPE_SECRET_KEY to .env.example', flow: 'add.env', executor: 'deterministic',
    args: { name: 'STRIPE_SECRET_KEY', scope: 'server', comment: 'The Stripe secret key, server only.' },
    touches: { features: [], files: [{ path: '.env.example', change: 'create' }] },
  },
  {
    id: 's-page', title: 'Ingest the designed checkout page', flow: 'create.page.from', executor: 'deterministic',
    args: { name: 'Checkout', feature: 'checkout', from: '../design-exports/Checkout.jsx' }, dependsOn: ['s-feature'],
    touches: touching('checkout', 'features/checkout/pages/CheckoutPage.tsx', 'create', 'page'),
  },
  {
    id: 's-workflow', title: 'Compile the checkout state graph', flow: 'create.workflow.from', executor: 'deterministic',
    args: { name: 'Checkout', feature: 'checkout', from: 'descriptors/checkout.json' }, dependsOn: ['s-feature'],
    touches: touching('checkout', 'features/checkout/workflows/CheckoutWorkflow.ts', 'create', 'workflow'),
  },
  {
    id: 's-controller', title: 'Bind the hook into the page', flow: 'create.controller.bind', executor: 'deterministic',
    args: { name: 'Checkout', feature: 'checkout', envelope: '.construct/checkout.envelope.json' },
    dependsOn: ['s-page', 's-slice'],
    touches: touching('checkout', 'features/checkout/controllers/CheckoutController.tsx', 'create', 'controller'),
  },
  {
    id: 's-service', title: 'Generate the orders service from the API spec', flow: 'create.service.openapi', executor: 'deterministic',
    args: { name: 'Orders', feature: 'checkout', openapi: 'specs/orders.yaml' }, dependsOn: ['s-feature'],
    touches: touching('checkout', 'features/checkout/services/OrdersService.ts', 'create', 'service'),
  },
  {
    id: 's-move', title: 'Move Discount out of domain into service', flow: 'refactor.move', executor: 'deterministic',
    args: { name: 'Discount', feature: 'checkout', from: 'domain', to: 'service' }, dependsOn: ['s-unit'],
    touches: {
      features: ['checkout'],
      files: [
        { path: 'features/checkout/domain/Discount.ts', change: 'delete', layer: 'domain' },
        { path: 'features/checkout/services/DiscountService.ts', change: 'create', layer: 'service' },
      ],
    },
  },
  {
    id: 's-rename', title: 'Rename Totals to CartTotals', flow: 'refactor.rename', executor: 'deterministic',
    args: { name: 'Totals', newName: 'CartTotals', feature: 'checkout', layer: 'domain' }, dependsOn: ['s-slice'],
    touches: touching('checkout', 'features/checkout/domain/CartTotals.ts', 'move', 'domain'),
  },
  {
    id: 's-wrap', title: 'Wrap the Totals page with the checkout provider', flow: 'wrap.provider', executor: 'deterministic',
    args: { name: 'TotalsPage', feature: 'checkout', provider: 'useCheckoutProvider' }, dependsOn: ['s-slice'],
    touches: touching('checkout', 'features/checkout/controllers/TotalsController.tsx', 'modify', 'controller'),
  },
  {
    id: 's-guard', title: 'Only a signed-in person may open the Totals screen', flow: 'guard.route', executor: 'deterministic',
    args: { name: 'Totals', feature: 'checkout', access: 'role', roles: ['admin', 'manager'], redirect: '/sign-in', route: '/totals' }, dependsOn: ['s-wrap'],
    touches: touching('checkout', 'features/checkout/controllers/TotalsGuardController.controller.tsx', 'create', 'controller'),
  },
  {
    id: 's-store', title: 'Keep the selected totals in a store', flow: 'create.store', executor: 'deterministic',
    args: { name: 'SelectedTotals', feature: 'checkout', shape: 'list', entity: 'Total', fields: 'id:string,name:string' }, dependsOn: ['s-guard'],
    touches: touching('checkout', 'features/checkout/hooks/useSelectedTotalsState.state.ts', 'create', 'hook'),
  },
  {
    id: 's-import-unit', title: 'Import the legacy coupon helper', flow: 'import.unit', executor: 'local-model',
    args: { name: 'Coupon', feature: 'checkout', layers: ['domain'], from: 'legacy/checkout/coupon.ts', llm: 'ollama' },
    dependsOn: ['s-feature'],
    touches: touching('checkout', 'features/checkout/domain/Coupon.ts', 'create', 'domain'),
  },
  {
    id: 's-import-plan', title: 'Run the approved legacy checkout import plan', flow: 'import.plan', executor: 'deterministic',
    args: { plan: IMPORT_PLAN }, dependsOn: ['s-feature'],
    touches: touching('checkout', 'features/checkout/hooks/useTotals.ts', 'create', 'hook'),
  },
  {
    id: 's-import-route', title: 'Walk the /checkout route import wizard', flow: 'import.route', executor: 'user',
    args: { route: '/checkout' }, dependsOn: ['s-feature'],
    touches: { features: ['checkout'], files: [] },
  },
  {
    id: 's-summarize-unit', title: 'Summarise the checkout feature', flow: 'summarize.unit', executor: 'deterministic',
    args: { ref: 'feature:checkout', kind: 'feature', detail: 'full', include: ['layers', 'health'], format: 'json' },
    dependsOn: ['s-controller'],
  },
  {
    id: 's-summarize-list', title: 'List every feature in the project', flow: 'summarize.list', executor: 'deterministic',
    args: { kind: 'feature' },
  },
  {
    id: 's-summarize-usage', title: 'Print the unit-summary API manifest', flow: 'summarize.usage', executor: 'deterministic',
    args: {},
  },
  {
    id: 's-research-summarize', title: 'Report what changed since main', flow: 'research.summarize', executor: 'deterministic',
    args: { feature: 'checkout', format: 'prose', since: 'main' },
  },
  {
    id: 's-research-workflow', title: 'Explain the checkout machine in English', flow: 'research.workflow', executor: 'deterministic',
    args: { feature: 'checkout', file: 'CheckoutWorkflow.ts', format: 'prose' }, dependsOn: ['s-workflow'],
  },
  {
    id: 's-research-doctor', title: 'Check the toolchain', flow: 'research.doctor', executor: 'deterministic', args: {},
  },
  {
    id: 's-validate', title: 'Validate the architecture', flow: 'validate', executor: 'deterministic',
    args: { format: 'json' }, dependsOn: ['s-controller'],
  },
  {
    id: 's-review', title: 'Review the change against main', flow: 'review.analyze', executor: 'deterministic',
    args: { base: 'main', head: 'feat/checkout', plan: { features: ['checkout'], files: ['features/checkout/index.ts'] } }, dependsOn: ['s-validate'],
  },
  {
    id: 's-test-run', title: 'Run the checkout tests against the running app', flow: 'test.run', executor: 'deterministic',
    args: { feature: 'checkout', name: 'happy-path.spec.ts', area: 'yours', 'base-url': 'http://localhost:3000' }, dependsOn: ['s-validate'],
  },
  {
    id: 's-test-proof', title: 'Run the proof of the Totals screen', flow: 'test.proof', executor: 'deterministic',
    args: { feature: 'checkout', name: 'TotalsScreen.proof.test.ts' }, dependsOn: ['s-proof'],
  },
  {
    id: 's-check-types', title: 'Type-check the checkout feature', flow: 'check.types', executor: 'deterministic',
    args: { feature: 'checkout' }, dependsOn: ['s-wrap'],
  },
  {
    id: 's-check-build', title: 'Build the project', flow: 'check.build', executor: 'deterministic',
    args: {}, dependsOn: ['s-check-types'],
  },
  {
    id: 's-sync', title: 'Regenerate the rule config and public API barrels', flow: 'sync', executor: 'deterministic',
    args: {}, dependsOn: ['s-controller'],
    touches: { features: ['checkout'], files: [{ path: '.dependency-cruiser.cjs', change: 'modify' }] },
  },
  {
    id: 's-pipeline', title: 'Run the buffered generator pipeline', flow: 'pipeline.run', executor: 'deterministic',
    args: { envelope: { ...createEnvelope('checkout'), steps: [{ layer: 'domain', name: 'Tax' }] } },
    dependsOn: ['s-feature'],
    touches: touching('checkout', 'features/checkout/domain/Tax.ts', 'create', 'domain'),
  },
  {
    id: 's-manual', title: 'Review the model-written files before accepting them', flow: 'manual.task', executor: 'user',
    args: { instructions: 'Read the Diff tab and accept or reject each file the local model wrote.' },
    dependsOn: ['s-unit', 's-import-unit'],
    touches: { features: ['checkout'], files: [] },
  },
];

const FULL_PLAN = createPlan(TICKET, EVERY_FLOW_STEPS, {
  summary: 'Build the checkout feature from the legacy route, then validate it.',
  provenance: { generator: 'construct research plan', model: 'claude-opus-5', deterministic: false },
  constraints: { framework: 'react-spa' },
  impact: { features: ['checkout'] },
});

/** Deep clone so a test can mutate a copy without disturbing the shared
 * fixture -- and so "validate never mutates its input" is testable. */
const clone = (v) => JSON.parse(JSON.stringify(v));
/** A minimal, always-valid plan to mutate into each malformed shape. */
const minimalPlan = () => clone(createPlan(TICKET, [
  { id: 'a', title: 'Create the feature', flow: 'create.feature', executor: 'deterministic', args: { name: 'checkout' }, touches: touching('checkout', 'features/checkout/index.ts') },
  { id: 'b', title: 'Validate', flow: 'validate', executor: 'deterministic', args: {}, dependsOn: ['a'] },
]));
const codes = (plan) => validatePlan(plan).errors.map((e) => e.code);
/** Assert a mutated plan is rejected, and rejected with THIS named code. */
function rejectsWith(code, mutate) {
  const plan = minimalPlan();
  mutate(plan);
  const { valid, errors } = validatePlan(plan);
  assert.equal(valid, false, `expected ${code} to make the plan invalid`);
  assert.ok(errors.some((e) => e.code === code), `expected a ${code} error, got: ${errors.map((e) => e.code).join(', ') || '(none)'}`);
  for (const e of errors) assert.equal(typeof e.path, 'string', 'every error carries a path');
}

// ---------------------------------------------------------------------------
// 1. The schema file itself
// ---------------------------------------------------------------------------

test('schemas/plan.v1.json is a well-formed draft-07 schema following the house convention', () => {
  assert.equal(SCHEMA.$schema, 'http://json-schema.org/draft-07/schema#');
  assert.equal(SCHEMA.$id, 'https://construct.dev/schemas/plan.v1.json');
  assert.equal(SCHEMA.title, 'Construct Execution Plan v1');
  assert.equal(SCHEMA.type, 'object');
  assert.equal(SCHEMA.additionalProperties, false);
  assert.ok(SCHEMA.description.length > 200, 'the description is the documentation of record');
});

test('the schema records the two deliberate omissions (no run state, no timestamp)', () => {
  // Guards the #286 decision from being quietly undone: run state belongs to
  // the process model, and a clock would break plan determinism.
  assert.ok(!('status' in SCHEMA.definitions.step.properties), 'a step must not carry run state');
  const asText = JSON.stringify(SCHEMA);
  assert.ok(!/"createdAt"|"timestamp"|"generatedAt"/.test(asText), 'the plan must have no clock in it');
});

// ---------------------------------------------------------------------------
// 2. Lockstep: schema vs. registry/validator. Read, never hand-copied.
// ---------------------------------------------------------------------------

test('schema and validator agree on the top-level and step field sets', () => {
  assert.deepEqual(Object.keys(SCHEMA.properties).sort(), [...PLAN_TOP_LEVEL_FIELDS].sort());
  assert.deepEqual([...SCHEMA.required].sort(), [...PLAN_REQUIRED_FIELDS].sort());
  assert.deepEqual(Object.keys(SCHEMA.definitions.step.properties).sort(), [...STEP_FIELDS].sort());
  assert.deepEqual([...SCHEMA.definitions.step.required].sort(), [...STEP_REQUIRED_FIELDS].sort());
  assert.equal(SCHEMA.properties.version.const, PLAN_VERSION);
});

test('schema and validator agree on every enum', () => {
  assert.deepEqual(SCHEMA.definitions.step.properties.flow.enum, Object.keys(PLAN_FLOWS));
  assert.deepEqual(SCHEMA.definitions.step.properties.executor.enum, [...PLAN_EXECUTORS]);
  assert.deepEqual(SCHEMA.definitions.ticket.properties.source.enum, [...TICKET_SOURCES]);
  assert.deepEqual(SCHEMA.definitions.touches.properties.files.items.properties.change.enum, [...TOUCH_CHANGES]);
});

test("every flow's argument contract is mirrored into the schema exactly once", () => {
  const branches = new Map(SCHEMA.definitions.step.allOf.map((b) => [b.if.properties.flow.const, b.then]));
  assert.deepEqual([...branches.keys()], Object.keys(PLAN_FLOWS), 'one allOf branch per flow, in registry order');
  for (const [id, flow] of Object.entries(PLAN_FLOWS)) {
    const then = branches.get(id);
    const argNames = Object.keys(flow.args);
    const requiredArgs = argNames.filter((n) => flow.args[n].required);
    assert.deepEqual(Object.keys(then.properties.args.properties), argNames, `${id}: argument names`);
    assert.deepEqual(then.properties.args.required, requiredArgs, `${id}: required arguments`);
    assert.equal(then.properties.args.additionalProperties, false, `${id}: takes no other arguments`);
    assert.deepEqual(then.properties.executor.enum, flow.executors, `${id}: permitted executors`);
    assert.equal(Boolean(then.required?.includes('touches')), Boolean(flow.writes), `${id}: touches required iff it writes`);
  }
});

// ---------------------------------------------------------------------------
// 3. Coverage: the plan can express every flow the CLI actually has
// ---------------------------------------------------------------------------

test('the full-coverage plan exercises every registry flow exactly once', () => {
  assert.deepEqual(EVERY_FLOW_STEPS.map((s) => s.flow), Object.keys(PLAN_FLOWS));
});

test('the full-coverage plan is accepted by the validator', () => {
  const { valid, errors } = validatePlan(FULL_PLAN);
  assert.deepEqual(formatPlanErrors(errors), []);
  assert.equal(valid, true);
});

test('the full-coverage plan is accepted by ajv against schemas/plan.v1.json', () => {
  const ok = ajvValidate(clone(FULL_PLAN));
  assert.deepEqual(ajvValidate.errors ?? [], [], 'schema and validator must agree on a valid plan');
  assert.equal(ok, true);
});

test('every flow in the registry names a real CLI command (or is the one explicit human step)', () => {
  for (const [id, flow] of Object.entries(PLAN_FLOWS)) {
    if (id === 'manual.task') {
      assert.equal(flow.cli, null, 'manual.task is the only flow with no command behind it');
      assert.deepEqual(flow.executors, ['user']);
      continue;
    }
    assert.ok(Array.isArray(flow.cli) && flow.cli.length, `${id} must name a command`);
    assert.ok(typeof flow.summary === 'string' && flow.summary.length, `${id} must be described`);
    assert.ok(flow.executors.every((e) => PLAN_EXECUTORS.includes(e)), `${id}: executors are real`);
  }
});

test('only the flows with a real --llm path may be executed by a local model', () => {
  // The Vision-level requirement: the plan must show exactly where a model is
  // involved, so "local-model" cannot be claimed by a flow that has no way to
  // call one.
  for (const [id, flow] of Object.entries(PLAN_FLOWS)) {
    const hasLlmArg = 'llm' in flow.args;
    assert.equal(flow.executors.includes('local-model'), hasLlmArg, `${id}: local-model iff it takes --llm`);
  }
});

// ---------------------------------------------------------------------------
// 4. planToCommand: a step hands the executor a concrete command
// ---------------------------------------------------------------------------

test('planToCommand turns every step of the full-coverage plan into something runnable', () => {
  for (const step of FULL_PLAN.steps) {
    const { argv, stdin, files, manual } = planToCommand(step);
    if (manual) {
      assert.equal(argv, null);
      assert.equal(step.flow, 'manual.task');
      continue;
    }
    assert.ok(Array.isArray(argv) && argv.length, `${step.flow}: produced no command`);
    assert.ok(argv.every((a) => typeof a === 'string'), `${step.flow}: argv must be all strings`);
    for (const f of files) assert.ok(argv.includes(f.placeholder), `${step.flow}: placeholder is in argv`);
    if (step.flow === 'pipeline.run') assert.ok(stdin && JSON.parse(stdin).feature === 'checkout');
    else assert.equal(stdin, null);
  }
});

test('planToCommand reproduces the documented CLI usage line for each command shape', () => {
  const cmd = (id) => planToCommand(FULL_PLAN.steps.find((s) => s.flow === id)).argv;
  assert.deepEqual(cmd('project.init'), ['init', 'apps/shop', '--framework', 'react-spa']);
  assert.deepEqual(cmd('create.feature'), ['create', 'feature', 'checkout']);
  assert.deepEqual(cmd('create.layer'), ['create', 'layer', 'Totals', '--feature', 'checkout', '--layers', 'domain,service,hook']);
  assert.deepEqual(cmd('create.unit'), ['create', 'domain', 'Discount', '--feature', 'checkout', '--llm', 'ollama']);
  assert.deepEqual(cmd('create.page.from'), ['create', 'page', 'Checkout', '--feature', 'checkout', '--from', '../design-exports/Checkout.jsx']);
  assert.deepEqual(cmd('create.workflow.from'), ['create', 'workflow', 'Checkout', '--feature', 'checkout', '--from', 'descriptors/checkout.json']);
  assert.deepEqual(cmd('create.controller.bind'), ['create', 'controller', 'Checkout', '--bind', '--feature', 'checkout', '--envelope', '.construct/checkout.envelope.json']);
  assert.deepEqual(cmd('create.service.openapi'), ['create', 'service', 'Orders', '--feature', 'checkout', '--openapi', 'specs/orders.yaml']);
  assert.deepEqual(cmd('refactor.move'), ['refactor', 'move', 'Discount', '--feature', 'checkout', '--from', 'domain', '--to', 'service']);
  assert.deepEqual(cmd('refactor.rename'), ['refactor', 'rename', 'Totals', 'CartTotals', '--feature', 'checkout', '--layer', 'domain']);
  assert.deepEqual(cmd('import.unit'), ['import', 'Coupon', '--feature', 'checkout', '--layers', 'domain', '--from', 'legacy/checkout/coupon.ts', '--llm', 'ollama']);
  assert.deepEqual(cmd('import.plan'), ['import', '--plan', '{{plan}}']);
  assert.deepEqual(cmd('import.route'), ['import', '--route', '/checkout']);
  assert.deepEqual(cmd('summarize.unit'), ['summarize', 'feature:checkout', '--kind', 'feature', '--detail', 'full', '--include', 'layers,health', '--format', 'json']);
  assert.deepEqual(cmd('summarize.list'), ['summarize', '--list', '--kind', 'feature']);
  assert.deepEqual(cmd('summarize.usage'), ['summarize', '--usage']);
  assert.deepEqual(cmd('research.summarize'), ['research', 'summarize', '--feature', 'checkout', '--format', 'prose', '--since', 'main']);
  assert.deepEqual(cmd('research.workflow'), ['research', 'workflow', 'checkout', 'CheckoutWorkflow.ts', '--format', 'prose']);
  assert.deepEqual(cmd('research.doctor'), ['research', 'doctor']);
  assert.deepEqual(cmd('validate'), ['validate', '--format', 'json']);
  assert.deepEqual(cmd('review.analyze'), ['review', 'main', 'feat/checkout', '--plan', '{{plan}}']);
  assert.deepEqual(cmd('test.run'), ['test', 'run', 'checkout', '--name', 'happy-path.spec.ts', '--area', 'yours', '--base-url', 'http://localhost:3000']);
  assert.deepEqual(cmd('sync'), ['sync']);
  assert.deepEqual(cmd('pipeline.run'), ['pipeline', 'run']);
});

test('an optional trailing positional is simply omitted', () => {
  const { argv } = planToCommand({ flow: 'research.workflow', args: { feature: 'checkout', format: 'json' } });
  assert.deepEqual(argv, ['research', 'workflow', 'checkout', '--format', 'json']);
});

test("planToCommand hands back an object argument to materialise, rather than stringifying it into argv", () => {
  const { argv, files } = planToCommand(FULL_PLAN.steps.find((s) => s.flow === 'import.plan'));
  assert.equal(files.length, 1);
  assert.equal(files[0].arg, 'plan');
  assert.deepEqual(files[0].value, IMPORT_PLAN);
  assert.equal(argv[argv.indexOf('--plan') + 1], files[0].placeholder);
});

test('planToCommand rejects an unknown flow instead of inventing a command', () => {
  assert.throws(() => planToCommand({ flow: 'create.everything', args: {} }), TypeError);
});

test("a planToCommand argv really runs: create.feature scaffolds the feature it said it would", () => {
  const dir = makeTempDir('construct-plan-');
  const bin = path.join(REPO_ROOT, 'packages', 'cli', 'construct.mjs');
  try {
    assert.equal(spawnSync('node', [bin, 'init', '.'], { cwd: dir, encoding: 'utf8' }).status, 0);
    const step = { id: 'x', title: 'Create the checkout feature', flow: 'create.feature', executor: 'deterministic', args: { name: 'checkout' }, touches: touching('checkout', 'features/checkout/index.ts') };
    assert.equal(validatePlan(createPlan(TICKET, [step])).valid, true);
    const res = spawnSync('node', [bin, ...planToCommand(step).argv], { cwd: dir, encoding: 'utf8' });
    assert.equal(res.status, 0, res.stderr);
    // ... and the file the step DECLARED it would touch is the file that appeared.
    for (const file of step.touches.files) assert.ok(fs.existsSync(path.join(dir, file.path)), `${file.path} was declared but not created`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 5. Round-trip and determinism
// ---------------------------------------------------------------------------

test('a plan round-trips through JSON unchanged and stays valid', () => {
  const roundTripped = JSON.parse(JSON.stringify(FULL_PLAN));
  assert.deepEqual(roundTripped, FULL_PLAN);
  assert.equal(validatePlan(roundTripped).valid, true);
  assert.equal(ajvValidate(roundTripped), true);
});

test('createPlan is deterministic: same input, byte-identical plan', () => {
  const a = createPlan(TICKET, clone(EVERY_FLOW_STEPS));
  const b = createPlan(TICKET, clone(EVERY_FLOW_STEPS));
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  assert.equal(a.version, PLAN_VERSION);
});

test('validatePlan never mutates, never throws, and never prints', () => {
  const frozen = Object.freeze(clone(FULL_PLAN));
  Object.freeze(frozen.steps);
  frozen.steps.forEach((s) => Object.freeze(s));
  const before = JSON.stringify(frozen);
  assert.equal(validatePlan(frozen).valid, true);
  assert.equal(JSON.stringify(frozen), before);
  for (const junk of [null, undefined, 'a string', 42, [], true]) {
    const { valid, errors } = validatePlan(junk);
    assert.equal(valid, false);
    assert.equal(errors[0].code, PLAN_ERROR_CODES.PLAN_NOT_OBJECT);
  }
});

test('validatePlan reports every problem at once rather than stopping at the first', () => {
  const plan = minimalPlan();
  delete plan.steps[0].title;
  plan.steps[0].executor = 'wizard';
  plan.steps[1].flow = 'create.nothing';
  assert.ok(validatePlan(plan).errors.length >= 3);
});

test('formatPlanErrors renders one readable line per structured error', () => {
  const lines = formatPlanErrors(validatePlan({}).errors);
  assert.ok(lines.length >= 3);
  assert.ok(lines.every((l) => /^[A-Z_]+ at .+: /.test(l) || /^[A-Z_]+: /.test(l)));
});

// ---------------------------------------------------------------------------
// 6. The import-plan containment decision (#286)
// ---------------------------------------------------------------------------

test("an import.plan step's argument is exactly the artifact packages/core/import.mjs already accepts", () => {
  // The decision recorded on #286: this schema CONTAINS the existing import
  // plan rather than extending or replacing it. If the two shapes ever drift,
  // this fails -- validatePlanShape is the authority for that sub-object.
  const step = FULL_PLAN.steps.find((s) => s.flow === 'import.plan');
  const carried = clone(step.args.plan);
  assert.doesNotThrow(() => validatePlanShape(carried, 'a plan.v1 import.plan step'));
  assert.deepEqual(carried, IMPORT_PLAN, 'a well-formed unit needs no repair, so nothing was rewritten');
});

test('a malformed nested import plan is caught while the plan is still being reviewed', () => {
  for (const bad of [
    { units: [{ name: 'A', layers: ['domain'], from: 'a.ts' }] },              // no feature
    { feature: 'checkout', units: [] },                                         // no units
    { feature: 'checkout', units: [{ layers: ['domain'], from: 'a.ts' }] },     // unit without a name
    { feature: 'checkout', units: [{ name: 'A', layers: [], from: 'a.ts' }] },  // unit without layers
    { feature: 'checkout', units: [{ name: 'A', layers: ['domain'] }] },        // unit without a source
  ]) {
    rejectsWith(PLAN_ERROR_CODES.IMPORT_PLAN_INVALID, (plan) => {
      plan.steps.push({ id: 'imp', title: 'Import', flow: 'import.plan', executor: 'deterministic', args: { plan: bad }, touches: { features: [], files: [] } });
    });
  }
});

test('a pipeline.run step delegates its envelope to the one envelope validator', () => {
  rejectsWith(PLAN_ERROR_CODES.ENVELOPE_INVALID, (plan) => {
    plan.steps.push({
      id: 'pipe', title: 'Run the pipeline', flow: 'pipeline.run', executor: 'deterministic',
      args: { envelope: { version: 2, feature: '', status: 'nope', layers: [] } },
      touches: { features: [], files: [] },
    });
  });
});

// ---------------------------------------------------------------------------
// 7. Rejections, by name
// ---------------------------------------------------------------------------

test('rejects a plan that is not an object', () => {
  assert.deepEqual(codes(null), [PLAN_ERROR_CODES.PLAN_NOT_OBJECT]);
});

test('rejects every missing required top-level field, by name', () => {
  for (const key of PLAN_REQUIRED_FIELDS) {
    const plan = minimalPlan();
    delete plan[key];
    const { valid, errors } = validatePlan(plan);
    assert.equal(valid, false, `expected invalid when "${key}" is missing`);
    assert.ok(errors.some((e) => e.code === PLAN_ERROR_CODES.PLAN_MISSING_FIELD && e.path === key), `expected PLAN_MISSING_FIELD at ${key}`);
  }
});

test('rejects a wrong version, an unknown top-level field and wrong top-level types', () => {
  rejectsWith(PLAN_ERROR_CODES.PLAN_VERSION_INVALID, (p) => { p.version = 2; });
  rejectsWith(PLAN_ERROR_CODES.PLAN_UNKNOWN_FIELD, (p) => { p.status = 'running'; });
  rejectsWith(PLAN_ERROR_CODES.PLAN_FIELD_TYPE, (p) => { p.summary = 42; });
  rejectsWith(PLAN_ERROR_CODES.PLAN_FIELD_TYPE, (p) => { p.impact = 'lots'; });
  rejectsWith(PLAN_ERROR_CODES.PLAN_FIELD_TYPE, (p) => { p.constraints = []; });
  rejectsWith(PLAN_ERROR_CODES.PLAN_FIELD_TYPE, (p) => { p.provenance = { deterministic: 'yes' }; });
});

test('rejects a malformed ticket', () => {
  rejectsWith(PLAN_ERROR_CODES.TICKET_INVALID, (p) => { p.ticket = 'fix the checkout'; });
  rejectsWith(PLAN_ERROR_CODES.TICKET_INVALID, (p) => { delete p.ticket.title; });
  rejectsWith(PLAN_ERROR_CODES.TICKET_INVALID, (p) => { p.ticket.assignee = 'me'; });
  rejectsWith(PLAN_ERROR_CODES.TICKET_SOURCE_INVALID, (p) => { p.ticket.source = 'jira'; });
});

test('rejects a plan with no steps', () => {
  rejectsWith(PLAN_ERROR_CODES.STEPS_NOT_ARRAY, (p) => { p.steps = {}; });
  rejectsWith(PLAN_ERROR_CODES.STEPS_EMPTY, (p) => { p.steps = []; });
  rejectsWith(PLAN_ERROR_CODES.STEP_NOT_OBJECT, (p) => { p.steps = ['create the feature']; });
});

test('rejects a step that is missing or misusing its own fields', () => {
  rejectsWith(PLAN_ERROR_CODES.STEP_ID_INVALID, (p) => { delete p.steps[0].id; });
  rejectsWith(PLAN_ERROR_CODES.STEP_ID_INVALID, (p) => { p.steps[0].id = ''; });
  rejectsWith(PLAN_ERROR_CODES.STEP_ID_DUPLICATE, (p) => { p.steps[1].id = 'a'; });
  rejectsWith(PLAN_ERROR_CODES.STEP_TITLE_INVALID, (p) => { delete p.steps[0].title; });
  rejectsWith(PLAN_ERROR_CODES.STEP_UNKNOWN_FIELD, (p) => { p.steps[0].status = 'running'; });
  rejectsWith(PLAN_ERROR_CODES.STEP_ESTIMATE_INVALID, (p) => { p.steps[0].estimateSeconds = -1; });
  rejectsWith(PLAN_ERROR_CODES.STEP_ESTIMATE_INVALID, (p) => { p.steps[0].estimateSeconds = 'a while'; });
});

test('rejects a step whose flow is missing or is not a real Construct flow', () => {
  rejectsWith(PLAN_ERROR_CODES.STEP_FLOW_MISSING, (p) => { delete p.steps[0].flow; });
  rejectsWith(PLAN_ERROR_CODES.STEP_FLOW_UNKNOWN, (p) => { p.steps[0].flow = 'create.everything'; });
  rejectsWith(PLAN_ERROR_CODES.STEP_FLOW_UNKNOWN, (p) => { p.steps[0].flow = 'ask the model to figure it out'; });
});

test("rejects arguments the flow doesn't take, and misses the ones it needs", () => {
  rejectsWith(PLAN_ERROR_CODES.STEP_ARGS_NOT_OBJECT, (p) => { delete p.steps[0].args; });
  rejectsWith(PLAN_ERROR_CODES.STEP_ARG_MISSING, (p) => { p.steps[0].args = {}; });
  rejectsWith(PLAN_ERROR_CODES.STEP_ARG_UNKNOWN, (p) => { p.steps[0].args.layers = ['domain']; });
  rejectsWith(PLAN_ERROR_CODES.STEP_ARG_TYPE, (p) => { p.steps[0].args.name = ['checkout']; });
  rejectsWith(PLAN_ERROR_CODES.STEP_ARG_TYPE, (p) => { p.steps[0].args.name = ''; });
  rejectsWith(PLAN_ERROR_CODES.STEP_ARG_ENUM, (p) => { p.steps[1].args.format = 'yaml'; });
});

test('rejects an empty layers array -- a vertical slice of nothing', () => {
  rejectsWith(PLAN_ERROR_CODES.STEP_ARG_TYPE, (p) => {
    p.steps.push({ id: 'c', title: 'Slice', flow: 'create.layer', executor: 'deterministic', args: { name: 'T', feature: 'checkout', layers: [] }, touches: { features: [], files: [] } });
  });
});

test('rejects an executor that is missing, unreal, or wrong for that flow', () => {
  rejectsWith(PLAN_ERROR_CODES.STEP_EXECUTOR_MISSING, (p) => { delete p.steps[0].executor; });
  rejectsWith(PLAN_ERROR_CODES.STEP_EXECUTOR_INVALID, (p) => { p.steps[0].executor = 'the intern'; });
  // create.feature has no --llm path, so claiming a local model runs it is a lie.
  rejectsWith(PLAN_ERROR_CODES.STEP_EXECUTOR_NOT_ALLOWED, (p) => { p.steps[0].executor = 'local-model'; });
  // validate is read-only machinery; a human "running" it is not a plan step.
  rejectsWith(PLAN_ERROR_CODES.STEP_EXECUTOR_NOT_ALLOWED, (p) => { p.steps[1].executor = 'user'; });
  // manual.task is the only flow a user-executed step may name.
  rejectsWith(PLAN_ERROR_CODES.STEP_EXECUTOR_NOT_ALLOWED, (p) => {
    p.steps.push({ id: 'm', title: 'Think', flow: 'manual.task', executor: 'deterministic', args: { instructions: 'decide' }, touches: { features: [], files: [] } });
  });
});

test('rejects a step that claims to be deterministic while passing an LLM provider', () => {
  rejectsWith(PLAN_ERROR_CODES.STEP_EXECUTOR_LLM_CONFLICT, (p) => {
    p.steps.push({
      id: 'llm', title: 'Write the domain unit', flow: 'create.unit', executor: 'deterministic',
      args: { layer: 'domain', name: 'Tax', feature: 'checkout', llm: 'ollama' },
      touches: touching('checkout', 'features/checkout/domain/Tax.ts'),
    });
  });
});

test('rejects broken ordering and dependency references', () => {
  rejectsWith(PLAN_ERROR_CODES.STEP_DEPENDS_ON_INVALID, (p) => { p.steps[1].dependsOn = 'a'; });
  rejectsWith(PLAN_ERROR_CODES.STEP_DEPENDENCY_SELF, (p) => { p.steps[1].dependsOn = ['b']; });
  rejectsWith(PLAN_ERROR_CODES.STEP_DEPENDENCY_UNKNOWN, (p) => { p.steps[1].dependsOn = ['nope']; });
  // The ordering rule that makes a cycle impossible to express in the first place.
  rejectsWith(PLAN_ERROR_CODES.STEP_DEPENDENCY_FORWARD, (p) => { p.steps[0].dependsOn = ['b']; });
});

test('a two-step cycle cannot be expressed at all -- one half is always a forward reference', () => {
  const plan = minimalPlan();
  plan.steps[0].dependsOn = ['b'];
  plan.steps[1].dependsOn = ['a'];
  assert.ok(codes(plan).includes(PLAN_ERROR_CODES.STEP_DEPENDENCY_FORWARD));
});

test('rejects a writing step that does not say what it expects to touch', () => {
  rejectsWith(PLAN_ERROR_CODES.STEP_TOUCHES_REQUIRED, (p) => { delete p.steps[0].touches; });
  // ... but a read-only flow is not obliged to.
  const plan = minimalPlan();
  delete plan.steps[1].touches;
  assert.equal(validatePlan(plan).valid, true);
});

test('rejects a malformed touches block', () => {
  rejectsWith(PLAN_ERROR_CODES.STEP_TOUCHES_INVALID, (p) => { p.steps[0].touches = ['features/checkout/index.ts']; });
  rejectsWith(PLAN_ERROR_CODES.STEP_TOUCHES_INVALID, (p) => { p.steps[0].touches.folders = ['features']; });
  rejectsWith(PLAN_ERROR_CODES.STEP_TOUCHES_INVALID, (p) => { p.steps[0].touches.features = [{ name: 'checkout' }]; });
  rejectsWith(PLAN_ERROR_CODES.STEP_TOUCHES_INVALID, (p) => { p.steps[0].touches.files = 'features/checkout/index.ts'; });
  rejectsWith(PLAN_ERROR_CODES.STEP_TOUCHES_INVALID, (p) => { delete p.steps[0].touches.files[0].path; });
  rejectsWith(PLAN_ERROR_CODES.STEP_TOUCHES_INVALID, (p) => { p.steps[0].touches.files[0].reason = 'because'; });
  rejectsWith(PLAN_ERROR_CODES.STEP_TOUCHES_CHANGE_INVALID, (p) => { p.steps[0].touches.files[0].change = 'improve'; });
  rejectsWith(PLAN_ERROR_CODES.STEP_TOUCHES_CHANGE_INVALID, (p) => { delete p.steps[0].touches.files[0].change; });
});

test('rejects an absolute touched path, because a plan has to stay portable', () => {
  rejectsWith(PLAN_ERROR_CODES.STEP_TOUCHES_ABSOLUTE_PATH, (p) => { p.steps[0].touches.files[0].path = '/home/dev/app/features/checkout/index.ts'; });
  rejectsWith(PLAN_ERROR_CODES.STEP_TOUCHES_ABSOLUTE_PATH, (p) => { p.steps[0].touches.files[0].path = 'C:\\app\\features\\checkout\\index.ts'; });
});

test('ajv rejects the malformed shapes the schema is able to express, so the two agree', () => {
  // Not every rule is expressible in JSON Schema (dependency ORDER, the
  // deterministic/llm contradiction and the absolute-path rule are the
  // validator's own); these are the ones that must fail in both.
  const cases = [
    (p) => { p.version = 2; },
    (p) => { p.status = 'running'; },
    (p) => { delete p.ticket; },
    (p) => { p.ticket.source = 'jira'; },
    (p) => { p.steps = []; },
    (p) => { delete p.steps[0].id; },
    (p) => { p.steps[0].flow = 'create.everything'; },
    (p) => { p.steps[0].args = {}; },
    (p) => { p.steps[0].args.layers = ['domain']; },
    (p) => { p.steps[0].executor = 'local-model'; },
    (p) => { delete p.steps[0].touches; },
    (p) => { p.steps[0].touches.files[0].change = 'improve'; },
    (p) => { p.steps[0].status = 'running'; },
  ];
  for (const mutate of cases) {
    const plan = minimalPlan();
    mutate(plan);
    assert.equal(validatePlan(plan).valid, false, `validator accepted ${JSON.stringify(plan)}`);
    assert.equal(ajvValidate(plan), false, `ajv accepted ${JSON.stringify(plan)}`);
  }
});

// ---------------------------------------------------------------------------
// 8. Helpers
// ---------------------------------------------------------------------------

test('planFlow looks a flow up without falling through to Object.prototype', () => {
  assert.equal(planFlow('refactor.move').cli.join(' '), 'refactor move');
  assert.equal(planFlow('constructor'), undefined);
  assert.equal(planFlow('toString'), undefined);
});

test('planTouches rolls the per-step expectations up, deduplicated, with the steps responsible', () => {
  const { features, files } = planTouches(FULL_PLAN);
  assert.deepEqual(features, ['checkout']);
  const index = new Map(files.map((f) => [f.path, f]));
  assert.deepEqual(index.get('features/checkout/domain/Discount.ts').changes, ['create', 'delete']);
  assert.deepEqual(index.get('features/checkout/domain/Discount.ts').steps, ['s-unit', 's-move']);
  assert.equal(index.get('features/checkout/domain/Totals.ts').layer, 'domain');
  assert.equal(files.length, new Set(files.map((f) => f.path)).size, 'no duplicate paths');
});

test('planTouches tolerates a plan that is still being assembled', () => {
  assert.deepEqual(planTouches(undefined), { features: [], files: [] });
  assert.deepEqual(planTouches({ steps: [{ id: 'a' }] }), { features: [], files: [] });
});

// ---------------------------------------------------------------------------
// #351 -- review.analyze: a read-only flow, so an analysis is the same block a human or a plan would use
// ---------------------------------------------------------------------------

test('review.analyze is read-only and deterministic by registry, so it needs no touches and can never claim a model', () => {
  const flow = PLAN_FLOWS['review.analyze'];
  assert.equal(flow.writes, false);
  assert.deepEqual(flow.executors, ['deterministic']);
  const plan = createPlan(TICKET, [{ id: 'r', title: 'Review', flow: 'review.analyze', executor: 'deterministic', args: { base: 'main', head: 'x' } }]);
  assert.equal(validatePlan(plan).valid, true, 'no touches are required');
  plan.steps[0].executor = 'local-model';
  assert.ok(codes(plan).includes('STEP_EXECUTOR_NOT_ALLOWED'));
});

test('review.analyze: base and head are required, the optional scope is checked, and old plans are unaffected', () => {
  const mk = (args) => createPlan(TICKET, [{ id: 'r', title: 'Review', flow: 'review.analyze', executor: 'deterministic', args }]);
  assert.ok(codes(mk({ head: 'x' })).includes('STEP_ARG_MISSING'));
  assert.ok(codes(mk({ base: 'main' })).includes('STEP_ARG_MISSING'));
  assert.ok(codes(mk({ base: 'a', head: 'b', plan: { features: 'billing' } })).includes('STEP_ARG_TYPE'));
  assert.ok(codes(mk({ base: 'a', head: 'b', plan: { files: [''] } })).includes('STEP_ARG_TYPE'));
  assert.ok(codes(mk({ base: 'a', head: 'b', plan: { extra: [] } })).includes('STEP_ARG_TYPE'));
  assert.equal(validatePlan(mk({ base: 'a', head: 'b', plan: { features: ['billing'], files: ['a.ts'] } })).valid, true);
  assert.equal(ajvValidate(mk({ base: 'a', head: 'b', plan: { features: ['billing'] } })), true);
  assert.equal(ajvValidate(mk({ base: 'a', head: 'b', plan: { features: 'billing' } })), false, 'the schema agrees with the validator');
});

// #305 -- test.run: run a feature's Playwright tests against the project's own app; read-only like review.analyze
test('test.run is read-only and deterministic by registry, needs no touches and can never claim a model', () => {
  const flow = PLAN_FLOWS['test.run'];
  assert.equal(flow.writes, false);
  assert.deepEqual(flow.executors, ['deterministic']);
  const mk = (args, executor = 'deterministic') => createPlan(TICKET, [{ id: 't', title: 'Run', flow: 'test.run', executor, args }]);
  assert.equal(validatePlan(mk({ feature: 'refunds' })).valid, true, 'no touches are required');
  assert.ok(codes(mk({ feature: 'refunds' }, 'local-model')).includes('STEP_EXECUTOR_NOT_ALLOWED'));
  assert.equal(ajvValidate(mk({ feature: 'refunds', area: 'generated', name: 'a--b.spec.ts' })), true);
});

test('test.run: the feature is required, one test needs name AND area, and nothing path-like or remote-looking is accepted', () => {
  const mk = (args) => createPlan(TICKET, [{ id: 't', title: 'Run', flow: 'test.run', executor: 'deterministic', args }]);
  assert.ok(codes(mk({})).includes('STEP_ARG_MISSING'));
  assert.ok(codes(mk({ feature: '../x' })).includes('STEP_ARG_TYPE'));
  assert.ok(codes(mk({ feature: 'a', name: '../../etc/passwd', area: 'yours' })).includes('STEP_ARG_TYPE'));
  assert.ok(codes(mk({ feature: 'a', name: 'x.spec.ts' })).includes('STEP_ARG_MISSING'));
  assert.ok(codes(mk({ feature: 'a', area: 'yours' })).includes('STEP_ARG_MISSING'));
  assert.ok(codes(mk({ feature: 'a', name: 'x.spec.ts', area: 'other' })).includes('STEP_ARG_ENUM'));
  assert.ok(codes(mk({ feature: 'a', 'base-url': 'http://localhost:3000/admin?x=1' })).includes('STEP_ARG_TYPE'));
  assert.equal(validatePlan(mk({ feature: 'a', 'base-url': 'http://127.0.0.1:5173' })).valid, true);
});
