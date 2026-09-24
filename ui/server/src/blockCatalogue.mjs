// #407 -- the Blocks catalogue: every mechanical block (PLAN_FLOWS entry) in plain words, with what it reads and
// writes, whether it can use a model, its arguments, one concrete example, the settings for this project and how many
// times it ran here.
//
// The facts come from the contract (#543): `flowBlocks()` gives each block's `writes`, scope kind and executors, and
// `flowCatalogue()` (planService.mjs) gives its arguments and whether the Cockpit offers it. Only the WORDS are written
// here (`BLOCK_DOCS`): a plain purpose, what it reads, what it writes, and an example step. A test proves the table has
// exactly one entry per flow and that every example is a step `validatePlan` accepts and `planToCommand` can turn into
// the real command, so an example can never drift into something the block would refuse.
//
// Pure over its inputs; no model is called and nothing is written.
import { planFlow, planToCommand, PLAN_FLOWS } from '../../../packages/core/plan.mjs';
import { flowBlocks } from '../../../packages/core/block-flows.mjs';
import { flowCatalogue } from './planService.mjs';
import { effectiveSettings } from './blockSettingsStore.mjs';

/**
 * Plain words per block. `example` is a step's `title` and `args` (`exampleStep` adds the executor and the empty
 * `touches` a writing step must declare). `null` example: the Cockpit never offers the block.
 * Every text is one sentence a person who has never read the code can follow.
 */
export const BLOCK_DOCS = Object.freeze({
  'project.init': {
    purpose: 'Set a folder up as a Construct project.',
    reads: 'The folder you name (or the current one).',
    writes: 'architecture.yml, the rule config and an app entry point.',
    example: { title: 'Set up this folder as a React project', args: { framework: 'react-spa' } },
  },
  'create.feature': {
    purpose: 'Add an empty feature, the home for one part of your app.',
    reads: 'architecture.yml, to learn where features live.',
    writes: 'A new feature folder with starter types.ts and index.ts files.',
    example: { title: 'Add the checkout feature', args: { name: 'checkout' } },
  },
  'create.layer': {
    purpose: 'Scaffold one unit across several layers at once, in dependency order.',
    reads: 'architecture.yml and the files the feature already has.',
    writes: 'One new file per layer you pick, inside the feature.',
    example: { title: 'Scaffold Cart as a domain and a service', args: { name: 'Cart', feature: 'checkout', layers: ['domain', 'service'] } },
  },
  'create.unit': {
    purpose: 'Add one file for one layer (domain, service, hook, component, page and so on) of a feature.',
    reads: 'architecture.yml and the files the feature already has.',
    writes: 'One new file in the feature.',
    example: { title: 'Add the Cart domain', args: { layer: 'domain', name: 'Cart', feature: 'checkout' } },
  },
  'create.proof': {
    purpose: 'Write the locked proof that a generated screen works: its four states, its controller and its service.',
    reads: 'The screen the list shape wrote and architecture.yml.',
    writes: 'One locked test file in the feature, and the test regions in architecture.yml the first time.',
    example: { title: 'Prove the Products screen', args: { name: 'Products', feature: 'products', shape: 'list', entity: 'Product', fields: 'id:string,name:string,price:number', kind: 'render' } },
  },
  'create.page.from': {
    purpose: 'Bring in a page someone designed elsewhere (a JSX file) as a page plus its props.',
    reads: 'The JSX file you point at; it may live outside the project.',
    writes: 'A page file and a Props interface in the feature.',
    example: { title: 'Import the designed cart page', args: { name: 'CartPage', feature: 'checkout', from: 'design/CartPage.jsx' } },
  },
  'create.workflow.from': {
    purpose: 'Turn a JSON state graph into a working XState workflow file.',
    reads: 'The JSON state graph you point at.',
    writes: 'A workflow file in the feature, and optionally a state type beside it.',
    example: { title: 'Compile the checkout state graph', args: { name: 'checkoutFlow', feature: 'checkout', from: 'design/checkout.json', stateUnion: true } },
  },
  'create.controller.bind': {
    purpose: 'Wire an existing hook into an existing page automatically.',
    reads: 'The page and the hook already generated in the feature.',
    writes: 'A controller file that connects the hook to the page.',
    example: { title: 'Wire the cart hook into the cart page', args: { name: 'CartPage', feature: 'checkout' } },
  },
  'create.service.openapi': {
    purpose: 'Generate an API service from an OpenAPI spec.',
    reads: 'The OpenAPI spec, a file or an address.',
    writes: 'A service file with one endpoint per operation, plus the shared API client.',
    example: { title: 'Generate the orders service', args: { name: 'orders', feature: 'checkout', openapi: 'api/openapi.yaml' } },
  },
  'refactor.move': {
    purpose: 'Move a unit from one layer to another and fix every import.',
    reads: 'Every file that imports the unit.',
    writes: 'The moved file, and only the import lines of the files that used it.',
    example: { title: 'Move Cart from domain to service', args: { name: 'Cart', feature: 'checkout', from: 'domain', to: 'service' } },
  },
  'refactor.rename': {
    purpose: 'Rename a unit and fix every import.',
    reads: 'Every file that imports the unit.',
    writes: 'The renamed file, and only the import lines of the files that used it.',
    example: { title: 'Rename Cart to Basket', args: { name: 'Cart', newName: 'Basket', feature: 'checkout', layer: 'domain' } },
  },
  'import.unit': {
    purpose: 'Bring one existing file into a feature as Construct layers, each with a note pointing back to it.',
    reads: 'The existing file you name; it may live outside the project.',
    writes: 'One new file per layer you pick, each with a TODO(import) note.',
    example: { title: 'Import the legacy cart', args: { name: 'Cart', feature: 'checkout', layers: ['domain', 'service'], from: 'legacy/cart.js' } },
  },
  'import.plan': {
    purpose: 'Run a whole approved import plan, several files at once, as one step.',
    reads: 'Each existing file the plan lists.',
    writes: 'New layer files for every unit in the plan.',
    example: {
      title: 'Import the legacy cart and checkout',
      args: { plan: { feature: 'checkout', units: [{ name: 'Cart', layers: ['domain', 'service'], from: 'legacy/cart.js' }, { name: 'Checkout', layers: ['domain'], from: 'legacy/checkout.js' }] } },
    },
  },
  'import.route': {
    purpose: 'A guided wizard that imports a whole page route; a person drives it.',
    reads: 'The route\'s page and everything it imports.',
    writes: 'The feature built from the plan you approve in the wizard.',
    example: { title: 'Import the checkout route', args: { route: '/checkout' } },
  },
  'summarize.unit': {
    purpose: 'Summarise one unit (its purpose, exports and neighbours) without a model.',
    reads: 'The unit\'s files.',
    writes: null,
    example: { title: 'Summarise the checkout feature', args: { ref: 'feature:checkout', detail: 'brief' } },
  },
  'summarize.list': {
    purpose: 'List the units in the project, or only those of one kind.',
    reads: 'The project\'s files.',
    writes: null,
    example: { title: 'List every feature', args: { kind: 'feature' } },
  },
  'summarize.usage': {
    purpose: 'Print the machine-readable description of the summarize commands themselves.',
    reads: 'Nothing in your project.',
    writes: null,
    example: { title: 'Show the summarize manifest', args: {} },
  },
  'research.summarize': {
    purpose: 'Summarise the project or one feature, optionally only what changed since a git ref.',
    reads: 'The project\'s files, and its git history when you name a ref.',
    writes: null,
    example: { title: 'Summarise the checkout feature', args: { feature: 'checkout', format: 'md' } },
  },
  'research.workflow': {
    purpose: 'Explain a feature\'s workflows in plain English, with scenarios and health findings.',
    reads: 'The feature\'s workflow files.',
    writes: null,
    example: { title: 'Explain the checkout workflows', args: { feature: 'checkout', format: 'prose' } },
  },
  'research.doctor': {
    purpose: 'Check that the tools a Construct project needs are in place.',
    reads: 'Your environment and the project\'s tooling.',
    writes: null,
    example: { title: 'Check the environment', args: {} },
  },
  validate: {
    purpose: 'Check the whole project against its architecture rules and list every violation.',
    reads: 'Every source file and architecture.yml.',
    writes: null,
    example: { title: 'Validate the project', args: { format: 'text' } },
  },
  'review.analyze': {
    purpose: 'Compare two commits and report what a change touched, what broke and what the public surface lost.',
    reads: 'Two commits, through temporary checkouts.',
    writes: null,
    example: { title: 'Review the latest change', args: { base: 'main', head: 'HEAD' } },
  },
  'test.run': {
    purpose: 'Run a feature\'s Playwright tests and say whether each failure is a convention problem or a real app bug.',
    reads: 'The feature\'s tests and your running app.',
    writes: null,
    example: { title: 'Run the checkout tests', args: { feature: 'checkout' } },
  },
  'test.proof': {
    purpose: 'Run the proof of a generated screen and say whether it passes, or which state is wrong.',
    reads: 'The feature\'s proof files and the screen\'s code.',
    writes: null,
    example: { title: 'Run the proof of the products screen', args: { feature: 'products' } },
  },
  sync: {
    purpose: 'Regenerate the derived rule config and each feature\'s public API from architecture.yml.',
    reads: 'architecture.yml and every feature.',
    writes: 'The derived rule config and each feature\'s index file.',
    example: { title: 'Sync the derived files', args: {} },
  },
  'pipeline.run': {
    purpose: 'Run generator steps against a raw Context Envelope.',
    reads: 'The envelope handed to it.',
    writes: 'Whatever the envelope\'s steps generate, all or nothing.',
    example: null,
  },
  'manual.task': {
    purpose: 'A step a person does by hand; Construct waits for them to say it is done.',
    reads: 'Nothing.',
    writes: 'Whatever the person changes; Construct cannot know in advance.',
    example: { title: 'Check the generated Cart domain', args: { instructions: 'Open features/checkout/domain/Cart.ts and confirm the fields match the ticket.' } },
  },
});

/** The step a block's example stands for, ready to drop into a plan. Null when the block has no example. */
export function exampleStep(flowId, { id = 's1', engine } = {}) {
  const flow = planFlow(flowId);
  const doc = Object.hasOwn(BLOCK_DOCS, flowId) ? BLOCK_DOCS[flowId] : null;
  if (!flow || !doc?.example) return null;
  const executor = engine === 'ai' && flow.executors.includes('local-model') ? 'local-model' : flow.executors.includes('deterministic') ? 'deterministic' : flow.executors[0];
  const args = { ...doc.example.args, ...(executor === 'local-model' ? { llm: 'ollama' } : {}) };
  const step = { id, title: doc.example.title, flow: flowId, args, executor };
  if (flow.writes) step.touches = { features: [] };
  return step;
}

/**
 * How many times each block ran in this project: the steps of this project's process records that finished (done or
 * failed), counted by the flow their plan step names. A step that never started (pending, skipped) is not a run.
 *
 * @param {{plan: {steps: {id: string, flow: string}[]}, steps: {id: string, status: string}[]}[]} processes Full process records.
 * @returns {Record<string, number>} Flow id to number of runs; flows that never ran are absent.
 */
export function runCounts(processes) {
  const counts = {};
  for (const p of Array.isArray(processes) ? processes : []) {
    const flows = new Map((p?.plan?.steps ?? []).map((s) => [s.id, s.flow]));
    for (const s of p?.steps ?? []) {
      if (s?.status !== 'done' && s?.status !== 'failed') continue;
      const flow = flows.get(s.id);
      if (typeof flow === 'string' && Object.hasOwn(PLAN_FLOWS, flow)) counts[flow] = (counts[flow] ?? 0) + 1;
    }
  }
  return counts;
}

/**
 * The catalogue: one row per block, in registry order.
 *
 * @param {{blocks?: Record<string, object>, runs?: Record<string, number>}} [state] The project's stored settings and run counts.
 * @returns {object[]} Rows: `{ id, purpose, reads, writes, writesFiles, modelCalls, engines, scope, offered, notOffered?, args, example, settings, runs }`.
 */
export function blockCatalogue({ blocks = {}, runs = {} } = {}) {
  const contract = flowBlocks();
  const byId = new Map(flowCatalogue().map((f) => [f.id, f]));
  return Object.keys(PLAN_FLOWS).map((id) => {
    const block = contract[id];
    const flow = byId.get(id);
    const doc = BLOCK_DOCS[id];
    const executors = block.meta.executors;
    const example = exampleStep(id);
    let argv = null;
    try { if (example) { const c = planToCommand(example); argv = c.argv ? ['construct', ...c.argv] : null; } } catch { argv = null; }
    return {
      id,
      purpose: doc.purpose,
      reads: doc.reads,
      writes: doc.writes,
      writesFiles: block.writes,
      // 'none' = model calls: 0; 'optional' = the block can use a model when a step asks for one.
      modelCalls: executors.includes('local-model') ? 'optional' : 'none',
      engines: [executors.includes('deterministic') ? 'mechanical' : null, executors.includes('local-model') ? 'ai' : null].filter(Boolean),
      scope: block.meta.scope,
      offered: flow.offered,
      ...(flow.notOffered ? { notOffered: flow.notOffered } : {}),
      args: flow.args,
      example: example ? { title: example.title, flow: id, executor: example.executor, args: example.args, ...(example.touches ? { touches: example.touches } : {}), argv } : null,
      settings: effectiveSettings(id, blocks),
      runs: runs[id] ?? 0,
    };
  });
}
