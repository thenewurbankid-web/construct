// #286 — the Execution Plan contract (schemas/plan.v1.json).
//
// A plan is the output of Research mode and the input to execution (#287):
// an ORDERED list of steps, each one a reference to a real, named Construct
// flow — a create/import/refactor/research block that already exists — plus
// who runs it, what it is expected to touch, and what it depends on. A step
// is executable because it names a deterministic block, not because a model
// re-reads prose at run time.
//
// Relationship to `packages/core/import.mjs`'s plan (the decision recorded on #286):
// this is a DIFFERENT artifact that CONTAINS an import plan rather than an
// extension of it. `import.mjs`'s `{ feature, units }` is single-flow and
// single-feature by construction (executeImportPlan runs importVertical once
// per unit against one feature), carries no executor tag, no expected-touch
// set, no step identity and no dependency concept, and its validator throws,
// mutates its input and prints warnings. Here it is nested unchanged as the
// `args.plan` of one `import.plan` step. `packages/core/import.mjs` is untouched and
// `validatePlanShape()` remains the authority for that sub-object at
// execution time (including its deliberate layer repair).
//
// No JSON-Schema-engine dependency is added for this, matching
// packages/engine/envelope.mjs: schemas/plan.v1.json is the documentation of
// record and this is the hand-written structural validator. test/plan.test.mjs
// asserts the two stay in lockstep — the schema's enums and per-flow required
// args are read directly out of the file and compared to PLAN_FLOWS, so drift
// fails a test instead of silently diverging.
//
// Deterministic by construction: nothing here reads a clock, a filesystem or
// a random source, and the schema has no `createdAt` field — the same research
// input must produce a byte-identical plan. Runtime state (queued/running/
// paused/failed/done) deliberately lives in #287's process model keyed by
// `step.id`, not in the plan.
import path from 'node:path';
import { validateEnvelope } from '../../packages/engine/envelope.mjs';

export const PLAN_VERSION = 1;

/** Who actually performs a step. Mirrors the Deterministic / Local model /
 * You tags in docs/design/cockpit-layout.md §4 `plan-mode`. */
export const PLAN_EXECUTORS = Object.freeze(['deterministic', 'local-model', 'user']);

/** How a step is expected to change a file it touches. `read` is for the
 * read-only research/validate flows, which still declare what they looked at. */
export const TOUCH_CHANGES = Object.freeze(['create', 'modify', 'delete', 'move', 'read']);

/** Where the ticket that produced this plan came from. */
export const TICKET_SOURCES = Object.freeze(['text', 'github-issue', 'file']);

/** Every rejection this validator can produce, by name — so callers (and
 * tests) match on a code rather than on message text. */
export const PLAN_ERROR_CODES = Object.freeze({
  PLAN_NOT_OBJECT: 'PLAN_NOT_OBJECT',
  PLAN_MISSING_FIELD: 'PLAN_MISSING_FIELD',
  PLAN_UNKNOWN_FIELD: 'PLAN_UNKNOWN_FIELD',
  PLAN_FIELD_TYPE: 'PLAN_FIELD_TYPE',
  PLAN_VERSION_INVALID: 'PLAN_VERSION_INVALID',
  TICKET_INVALID: 'TICKET_INVALID',
  TICKET_SOURCE_INVALID: 'TICKET_SOURCE_INVALID',
  STEPS_NOT_ARRAY: 'STEPS_NOT_ARRAY',
  STEPS_EMPTY: 'STEPS_EMPTY',
  STEP_NOT_OBJECT: 'STEP_NOT_OBJECT',
  STEP_UNKNOWN_FIELD: 'STEP_UNKNOWN_FIELD',
  STEP_ID_INVALID: 'STEP_ID_INVALID',
  STEP_ID_DUPLICATE: 'STEP_ID_DUPLICATE',
  STEP_TITLE_INVALID: 'STEP_TITLE_INVALID',
  STEP_FLOW_MISSING: 'STEP_FLOW_MISSING',
  STEP_FLOW_UNKNOWN: 'STEP_FLOW_UNKNOWN',
  STEP_ARGS_NOT_OBJECT: 'STEP_ARGS_NOT_OBJECT',
  STEP_ARG_MISSING: 'STEP_ARG_MISSING',
  STEP_ARG_UNKNOWN: 'STEP_ARG_UNKNOWN',
  STEP_ARG_TYPE: 'STEP_ARG_TYPE',
  STEP_ARG_ENUM: 'STEP_ARG_ENUM',
  STEP_EXECUTOR_MISSING: 'STEP_EXECUTOR_MISSING',
  STEP_EXECUTOR_INVALID: 'STEP_EXECUTOR_INVALID',
  STEP_EXECUTOR_NOT_ALLOWED: 'STEP_EXECUTOR_NOT_ALLOWED',
  STEP_EXECUTOR_LLM_CONFLICT: 'STEP_EXECUTOR_LLM_CONFLICT',
  STEP_DEPENDS_ON_INVALID: 'STEP_DEPENDS_ON_INVALID',
  STEP_DEPENDENCY_SELF: 'STEP_DEPENDENCY_SELF',
  STEP_DEPENDENCY_UNKNOWN: 'STEP_DEPENDENCY_UNKNOWN',
  STEP_DEPENDENCY_FORWARD: 'STEP_DEPENDENCY_FORWARD',
  STEP_TOUCHES_REQUIRED: 'STEP_TOUCHES_REQUIRED',
  STEP_TOUCHES_INVALID: 'STEP_TOUCHES_INVALID',
  STEP_TOUCHES_CHANGE_INVALID: 'STEP_TOUCHES_CHANGE_INVALID',
  STEP_TOUCHES_ABSOLUTE_PATH: 'STEP_TOUCHES_ABSOLUTE_PATH',
  STEP_ESTIMATE_INVALID: 'STEP_ESTIMATE_INVALID',
  IMPORT_PLAN_INVALID: 'IMPORT_PLAN_INVALID',
  ENVELOPE_INVALID: 'ENVELOPE_INVALID',
});

const DIR_ARG = { type: 'string', flag: '--dir', description: 'Target a Construct project nested in a subdirectory.' };
const LLM_ARG = { type: 'string', flag: '--llm', description: 'LLM provider that writes the file bodies (claude, ollama). Only meaningful on a local-model step.' };

/**
 * The named screen shapes a `create.layer` / `create.unit` step can scaffold with real, typed code instead of an empty stub (#619).
 * Extensible: a new shape is one more name here and one more entry in `packages/core/shapes.mjs` (a test keeps the two equal).
 *
 * @type {readonly string[]}
 */
export const PLAN_SHAPES = Object.freeze(['list', 'detail']);

/**
 * The kinds of proof a `create.proof` step writes for a shaped screen (#623): `render` runs offline as a node test, `playwright` is
 * written only when the project already has a Playwright config. A test keeps this equal to `PROOF_KINDS` in `packages/core/proof.mjs`.
 *
 * @type {readonly string[]}
 */
export const PLAN_PROOF_KINDS = Object.freeze(['render', 'playwright']);

// #619 -- the three optional arguments of a shaped step. Additive: a step without them is exactly what it was.
const SHAPE_ARG = { type: 'string', flag: '--shape', enum: [...PLAN_SHAPES], description: 'A named screen shape: the units are filled with real, typed code for it (list: an entity list with loading, empty and error states; detail: one item by id with loading, not-found and error states).' };
const ENTITY_ARG = { type: 'string', flag: '--entity', description: 'The entity a shape shows, PascalCase and singular (Product). Defaults to the singular of the unit name (list) or the unit name (detail).' };
const FIELDS_ARG = { type: 'string', flag: '--fields', description: 'The entity fields for a shape as name:type pairs, comma separated (id:string,name:string,price:number). Types: string, number, boolean; an id field is required.' };

/** The flow registry: every flow `packages/cli/construct.mjs` actually exposes, keyed
 * by a stable dotted id. Checked against `construct --help` and packages/core/cli.mjs,
 * not against prose.
 *
 * Each entry declares:
 *  - `cli`         the command words, e.g. ['refactor', 'move'] (null = no CLI
 *                  command behind it; only `manual.task`)
 *  - `fixedFlags`  flags the flow id itself implies (e.g. `--bind`, `--list`)
 *  - `args`        arg name -> { type, required, positional | flag | stdin |
 *                  materialize, enum, join }. Arg names are the CLI flag names
 *                  minus `--`, so a step maps mechanically onto a real command
 *                  (see planToCommand).
 *  - `writes`      whether the flow changes files (drives whether `touches` is
 *                  required on the step)
 *  - `executors`   which executor tags are legitimate for this flow.
 *                  `local-model` appears only on flows that genuinely have an
 *                  `--llm` path, so "exactly where a model is involved" is
 *                  enforced rather than merely documented. */
export const PLAN_FLOWS = Object.freeze({
  'project.init': {
    cli: ['init'],
    summary: 'Initialise a Construct project (architecture.yml, rules, an app entry point).',
    writes: true,
    executors: ['deterministic', 'user'],
    args: {
      dir: { type: 'string', positional: 0, description: 'Directory to initialise; defaults to the current one.' },
      framework: { type: 'string', flag: '--framework', enum: ['nextjs', 'react-spa'] },
    },
  },
  'create.feature': {
    cli: ['create', 'feature'],
    summary: 'Create an empty feature slice (types.ts/index.ts boilerplate).',
    writes: true,
    executors: ['deterministic', 'user'],
    args: { name: { type: 'string', required: true, positional: 0 }, dir: DIR_ARG },
  },
  'create.layer': {
    cli: ['create', 'layer'],
    summary: 'Scaffold a whole vertical slice — several layers of one unit, in dependency order.',
    writes: true,
    executors: ['deterministic', 'local-model', 'user'],
    args: {
      name: { type: 'string', required: true, positional: 0 },
      feature: { type: 'string', required: true, flag: '--feature' },
      layers: { type: 'string[]', required: true, flag: '--layers', join: ',' },
      shape: SHAPE_ARG,
      entity: ENTITY_ARG,
      fields: FIELDS_ARG,
      llm: LLM_ARG,
      dir: DIR_ARG,
    },
  },
  'create.unit': {
    cli: ['create'],
    summary: 'Scaffold one layer file of a feature (domain/service/workflow/hook/component/page/controller/route).',
    writes: true,
    executors: ['deterministic', 'local-model', 'user'],
    args: {
      layer: { type: 'string', required: true, positional: 0 },
      name: { type: 'string', required: true, positional: 1 },
      feature: { type: 'string', required: true, flag: '--feature' },
      shape: SHAPE_ARG,
      entity: ENTITY_ARG,
      fields: FIELDS_ARG,
      llm: LLM_ARG,
      dir: DIR_ARG,
    },
  },
  'create.proof': {
    cli: ['create', 'proof'],
    summary: 'Write the locked proof of a shaped screen (#623): the four states with sample props, the controller\'s loading state and the service with a stubbed fetch (kind render, offline), or the route flow with a mocked API (kind playwright, only when the project already has a Playwright config). Declares the generated-test regions in architecture.yml once. Zero-LLM.',
    writes: true,
    executors: ['deterministic', 'user'],
    args: {
      name: { type: 'string', required: true, positional: 0, description: 'The unit name of the shaped screen, PascalCase (Products).' },
      feature: { type: 'string', required: true, flag: '--feature' },
      shape: SHAPE_ARG,
      entity: ENTITY_ARG,
      fields: FIELDS_ARG,
      kind: { type: 'string', flag: '--kind', enum: [...PLAN_PROOF_KINDS], description: 'render (a node test, offline; the default) or playwright (the route flow with a mocked API; needs a Playwright config already in the project).' },
      route: { type: 'string', flag: '--route', description: 'The route of the screen for a playwright proof, for example /products. Defaults to /.' },
      dir: DIR_ARG,
    },
  },
  'create.route': {
    cli: ['create', 'route'],
    summary: 'Point the project\'s route entry at the controller of a generated screen (#654): Next.js creates app/<route>/page.tsx that renders the controller; react-spa adds the import and a <Route> to src/App.tsx and drops the dangling controller import the init scaffold leaves. Idempotent; refuses a route something else owns. Zero-LLM.',
    writes: true,
    executors: ['deterministic', 'user'],
    args: {
      name: { type: 'string', required: true, positional: 0, description: 'The controller unit name of the screen, PascalCase (Products).' },
      feature: { type: 'string', required: true, flag: '--feature' },
      route: { type: 'string', flag: '--route', description: 'The route path of the screen, for example /products. Defaults to the kebab-case of the name.' },
      dir: DIR_ARG,
    },
  },
  'add.dependency': {
    cli: ['create', 'dependency'],
    summary: 'Add one dependency line to package.json (#654), for example @line/construct-core, which the generated typed units import. Never runs a package manager: install afterwards. Idempotent. Zero-LLM.',
    writes: true,
    executors: ['deterministic', 'user'],
    args: {
      name: { type: 'string', required: true, positional: 0, description: 'The package name, for example @line/construct-core.' },
      version: { type: 'string', required: true, flag: '--version', description: 'The version range to add, for example ^0.9.0.' },
      dir: DIR_ARG,
    },
  },
  'create.page.from': {
    cli: ['create', 'page'],
    summary: 'Ingest an externally authored JSX page (e.g. a Subframe export) as a pristine page plus an explicit Props interface. Zero-LLM.',
    writes: true,
    executors: ['deterministic', 'user'],
    args: {
      name: { type: 'string', required: true, positional: 0 },
      feature: { type: 'string', required: true, flag: '--feature' },
      from: { type: 'string', required: true, flag: '--from', description: 'Path to the authored JSX file. May live outside the project.' },
      dir: DIR_ARG,
    },
  },
  'create.workflow.from': {
    cli: ['create', 'workflow'],
    summary: 'Compile a JSON state-graph descriptor into a real XState v5 machine file. Zero-LLM.',
    writes: true,
    executors: ['deterministic', 'user'],
    args: {
      name: { type: 'string', required: true, positional: 0 },
      feature: { type: 'string', required: true, flag: '--feature' },
      from: { type: 'string', required: true, flag: '--from', description: 'Path to the state-graph JSON descriptor.' },
      stateUnion: { type: 'boolean', flag: '--state-union', description: 'Also emit a typed <Name>State union and exhaustive matcher beside the machine.' },
      dir: DIR_ARG,
    },
  },
  'create.controller.bind': {
    cli: ['create', 'controller'],
    fixedFlags: ['--bind'],
    summary: 'Auto-wire an already-generated hook into an already-generated pristine page via AST signature matching. Zero-LLM.',
    writes: true,
    executors: ['deterministic', 'user'],
    args: {
      name: { type: 'string', required: true, positional: 0 },
      feature: { type: 'string', required: true, flag: '--feature' },
      envelope: { type: 'string', flag: '--envelope', description: 'Path to a Context Envelope to take the hook/slot inventory from.' },
      dir: DIR_ARG,
    },
  },
  'create.service.openapi': {
    cli: ['create', 'service'],
    summary: 'Compile an OpenAPI spec into an RTK Query injectEndpoints service plus the shared transport client. Zero-LLM.',
    writes: true,
    executors: ['deterministic', 'user'],
    args: {
      name: { type: 'string', required: true, positional: 0 },
      feature: { type: 'string', required: true, flag: '--feature' },
      openapi: { type: 'string', required: true, flag: '--openapi', description: 'Path or URL of the OpenAPI spec.' },
      dir: DIR_ARG,
    },
  },
  'refactor.move': {
    cli: ['refactor', 'move'],
    summary: 'Move a unit between layers and rewrite every importer. Never touches file content.',
    writes: true,
    executors: ['deterministic', 'user'],
    args: {
      name: { type: 'string', required: true, positional: 0 },
      feature: { type: 'string', required: true, flag: '--feature' },
      from: { type: 'string', required: true, flag: '--from', description: 'Source LAYER name (not a path) for this flow.' },
      to: { type: 'string', required: true, flag: '--to', description: 'Destination layer name.' },
      dir: DIR_ARG,
    },
  },
  'refactor.rename': {
    cli: ['refactor', 'rename'],
    summary: 'Rename a unit within its layer and rewrite every importer. Never touches file content.',
    writes: true,
    executors: ['deterministic', 'user'],
    args: {
      name: { type: 'string', required: true, positional: 0 },
      newName: { type: 'string', required: true, positional: 1 },
      feature: { type: 'string', required: true, flag: '--feature' },
      layer: { type: 'string', required: true, flag: '--layer' },
      dir: DIR_ARG,
    },
  },
  'import.unit': {
    cli: ['import'],
    summary: 'Scaffold layers for one existing non-Construct file, with a TODO(import) breadcrumb back to it.',
    writes: true,
    executors: ['deterministic', 'local-model', 'user'],
    args: {
      name: { type: 'string', required: true, positional: 0 },
      feature: { type: 'string', required: true, flag: '--feature' },
      layers: { type: 'string[]', required: true, flag: '--layers', join: ',' },
      from: { type: 'string', required: true, flag: '--from', description: 'Path to the existing source file. May live outside the project.' },
      llm: LLM_ARG,
      dir: DIR_ARG,
    },
  },
  'import.plan': {
    cli: ['import'],
    summary: 'Run a whole approved import plan — the existing { feature, units } artifact from packages/core/import.mjs, carried inline as this step\'s argument.',
    writes: true,
    executors: ['deterministic', 'local-model', 'user'],
    args: {
      plan: {
        type: 'object',
        required: true,
        flag: '--plan',
        materialize: 'file',
        schemaRef: '#/definitions/importPlan',
        description: 'The import plan itself: { feature, units: [{ name, layers, from }] }. Validated structurally here and by validatePlanShape() in packages/core/import.mjs at execution time.',
      },
      llm: LLM_ARG,
      dir: DIR_ARG,
    },
  },
  'import.route': {
    cli: ['import'],
    summary: 'The guided whole-feature import wizard: traces a real route\'s import graph, proposes a plan, builds it on approval. Interactive, so a human drives it.',
    writes: true,
    executors: ['user'],
    args: {
      route: { type: 'string', required: true, flag: '--route', description: 'A URL like /v2/home, or the folder that owns its page.tsx.' },
      dir: DIR_ARG,
    },
  },
  'summarize.unit': {
    cli: ['summarize'],
    summary: 'Deterministic, LLM-free structured summary of one unit (schemas/unit-summary.v1.json). Read-only.',
    writes: false,
    executors: ['deterministic'],
    args: {
      ref: { type: 'string', required: true, positional: 0, description: 'A unit reference, normally `kind:id` (e.g. feature:checkout).' },
      kind: { type: 'string', flag: '--kind' },
      detail: { type: 'string', flag: '--detail', enum: ['brief', 'standard', 'full'] },
      include: { type: 'string[]', flag: '--include', join: ',' },
      format: { type: 'string', flag: '--format', enum: ['json', 'markdown'] },
      dir: DIR_ARG,
    },
  },
  'summarize.list': {
    cli: ['summarize'],
    fixedFlags: ['--list'],
    summary: 'List the units in the project, optionally of one kind. Read-only.',
    writes: false,
    executors: ['deterministic'],
    args: { kind: { type: 'string', flag: '--kind' }, dir: DIR_ARG },
  },
  'summarize.usage': {
    cli: ['summarize'],
    fixedFlags: ['--usage'],
    summary: 'Print the unit-summary API manifest — the machine-readable description of the summarize surface itself. Read-only.',
    writes: false,
    executors: ['deterministic'],
    args: { dir: DIR_ARG },
  },
  'research.summarize': {
    cli: ['research', 'summarize'],
    summary: 'Project/feature summary in JSON, markdown, compact or prose form, optionally scoped to changes since a git ref. Read-only.',
    writes: false,
    executors: ['deterministic'],
    args: {
      feature: { type: 'string', flag: '--feature' },
      format: { type: 'string', flag: '--format', enum: ['json', 'md', 'compact', 'prose'] },
      since: { type: 'string', flag: '--since', description: 'A git ref; summarises only what changed since it.' },
      dir: DIR_ARG,
    },
  },
  'research.workflow': {
    cli: ['research', 'workflow'],
    summary: 'Explain a feature\'s XState machines in plain English, with scenarios and health findings. Read-only.',
    writes: false,
    executors: ['deterministic'],
    args: {
      feature: { type: 'string', required: true, positional: 0 },
      file: { type: 'string', positional: 1, description: 'One workflow file; omitted means every workflow in the feature.' },
      format: { type: 'string', flag: '--format', enum: ['prose', 'md', 'json', 'scenarios'] },
      dir: DIR_ARG,
    },
  },
  'research.doctor': {
    cli: ['research', 'doctor'],
    summary: 'Check the environment and tooling a Construct project depends on. Read-only.',
    writes: false,
    executors: ['deterministic'],
    args: { dir: DIR_ARG },
  },
  validate: {
    cli: ['validate'],
    summary: 'Run every architecture enforcer over the project and report violations. Read-only.',
    writes: false,
    executors: ['deterministic'],
    args: { format: { type: 'string', flag: '--format', enum: ['json', 'text'] }, dir: DIR_ARG },
  },
  'review.analyze': {
    cli: ['review'],
    summary: 'PR health of one change: what it touched, what broke, what the public surface lost (schemas/pr-health.v1.json). Read-only: it reads two commits through temporary checkouts, writes nothing and produces no artifacts, so it never needs approval. Zero-LLM.',
    writes: false,
    executors: ['deterministic'],
    args: {
      base: { type: 'string', required: true, positional: 0, description: 'The base commit (or ref) the change is compared against.' },
      head: { type: 'string', required: true, positional: 1, description: 'The head commit (or ref) of the change under review.' },
      plan: {
        type: 'object',
        flag: '--plan',
        materialize: 'file',
        schemaRef: '#/definitions/expectedScope',
        description: 'The scope the change is expected to stay inside: { features, files }. Optional; without it the scope indicator is not measured.',
      },
      dir: DIR_ARG,
    },
  },
  'test.run': {
    cli: ['test', 'run'],
    summary: 'Run a feature\'s Playwright tests (all of them, or one) against the project\'s own running app and say what each result means: a convention failure (the test harness could not find an element the flow binds to; not a product bug) or an app failure (the flow reached another state; a bug worth reporting). Read-only: it writes nothing in the project and produces no artifacts, so it never needs approval. Zero-LLM.',
    writes: false,
    executors: ['deterministic'],
    args: {
      feature: { type: 'string', required: true, positional: 0, description: 'The feature whose tests are run.' },
      name: { type: 'string', flag: '--name', description: 'Run only this test file (with area). Omit to run every test of the feature.' },
      area: { type: 'string', flag: '--area', enum: ['generated', 'yours'], description: 'Which directory the named test is in: generated (locked) or yours (clones and authored tests).' },
      'base-url': { type: 'string', flag: '--base-url', description: 'Where the project\'s app is running, for example http://localhost:3000. Only an address on this machine is accepted.' },
      dir: DIR_ARG,
    },
  },
  'test.proof': {
    cli: ['test', 'proof'],
    summary: 'Run the render proof of a shaped screen (written by create.proof) and say what each result means: a pass, an app failure (the screen reached another state than the proof expects; the failure names the state) or a convention failure (a file the proof binds to is gone; not a product bug). Needs no browser and no running app. The chain of a screen is complete when this is green or explicitly skipped. Read-only: it writes nothing in the project. Zero-LLM.',
    writes: false,
    executors: ['deterministic'],
    args: {
      feature: { type: 'string', required: true, positional: 0, description: 'The feature whose proofs are run.' },
      name: { type: 'string', flag: '--name', description: 'Run only this proof file, for example ProductsScreen.proof.test.ts. Omit to run every proof of the feature.' },
      dir: DIR_ARG,
    },
  },
  sync: {
    cli: ['sync'],
    summary: 'Regenerate the derived rule config and each feature\'s public API barrel from architecture.yml.',
    writes: true,
    executors: ['deterministic'],
    args: { dir: DIR_ARG },
  },
  'pipeline.run': {
    cli: ['pipeline', 'run'],
    summary: 'Run generator steps against a Context Envelope, committed atomically or not at all. Envelope in on stdin, envelope out on stdout.',
    writes: true,
    executors: ['deterministic'],
    args: {
      envelope: {
        type: 'object',
        required: true,
        stdin: true,
        schemaRef: '#/definitions/envelope',
        description: 'A Context Envelope (schemas/envelope.v1.json), including its input-only `steps` list. Validated with validateEnvelope().',
      },
      dir: DIR_ARG,
    },
  },
  'manual.task': {
    cli: null,
    summary: 'A step the owner performs by hand — reviewing model output, answering the import wizard, a decision only a human can make. The only flow with no block behind it, which is why free text is confined to it.',
    writes: true,
    executors: ['user'],
    args: {
      instructions: { type: 'string', required: true, description: 'What the person has to do, in plain language.' },
    },
  },
});

export const PLAN_TOP_LEVEL_FIELDS = Object.freeze(['version', 'ticket', 'steps', 'summary', 'impact', 'constraints', 'provenance', 'ext']);
export const PLAN_REQUIRED_FIELDS = Object.freeze(['version', 'ticket', 'steps']);
export const STEP_FIELDS = Object.freeze(['id', 'title', 'flow', 'args', 'executor', 'dependsOn', 'touches', 'estimateSeconds', 'rationale']);
export const STEP_REQUIRED_FIELDS = Object.freeze(['id', 'title', 'flow', 'args', 'executor']);

const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const isNonEmptyString = (v) => typeof v === 'string' && v.length > 0;
const isAbsolutePath = (p) => path.isAbsolute(p) || /^[A-Za-z]:[\\/]/.test(p);

/**
 * The flow registry entry for `id`, or undefined.
 *
 * @param {string} id Flow id.
 * @returns {object|undefined} The flow registry entry, or `undefined` for an unknown id.
 */
export function planFlow(id) {
  return Object.prototype.hasOwnProperty.call(PLAN_FLOWS, id) ? PLAN_FLOWS[id] : undefined;
}

/** Build a well-formed v1 plan. Pure: no clock, no filesystem, no ids
 * invented for you — step ids are the planner's, so re-planning the same
 * ticket yields the same JSON. */
export function createPlan(ticket, steps = [], extras = {}) {
  return { version: PLAN_VERSION, ticket, steps, ...extras };
}

function checkArgType(spec, value) {
  if (spec.type === 'string[]') return Array.isArray(value) && value.every((v) => typeof v === 'string');
  if (spec.type === 'object') return isPlainObject(value);
  if (spec.type === 'boolean') return typeof value === 'boolean';
  return typeof value === 'string';
}

/** Structural check of a nested `import.plan` argument — deliberately the
 * same requirements validatePlanShape() in packages/core/import.mjs enforces, but
 * without throwing, mutating or printing, so a bad one is caught while the
 * plan is being reviewed rather than half-way through executing it.
 * validatePlanShape() still runs at execution time and keeps its layer
 * repair; nothing here duplicates that repair. */
function validateImportPlanArg(value, at, push) {
  if (!isNonEmptyString(value?.feature)) {
    push(PLAN_ERROR_CODES.IMPORT_PLAN_INVALID, at, 'An import plan needs a non-empty "feature" string.');
  }
  if (!Array.isArray(value?.units) || value.units.length === 0) {
    push(PLAN_ERROR_CODES.IMPORT_PLAN_INVALID, `${at}.units`, 'An import plan needs a non-empty "units" array.');
    return;
  }
  value.units.forEach((unit, i) => {
    const where = `${at}.units[${i}]`;
    if (!isPlainObject(unit)) {
      push(PLAN_ERROR_CODES.IMPORT_PLAN_INVALID, where, 'Each import plan unit must be an object.');
      return;
    }
    if (!isNonEmptyString(unit.name)) push(PLAN_ERROR_CODES.IMPORT_PLAN_INVALID, `${where}.name`, 'Each import plan unit needs a non-empty "name".');
    if (!Array.isArray(unit.layers) || !unit.layers.length || !unit.layers.every(isNonEmptyString)) {
      push(PLAN_ERROR_CODES.IMPORT_PLAN_INVALID, `${where}.layers`, 'Each import plan unit needs a non-empty "layers" array of strings.');
    }
    if (!isNonEmptyString(unit.from)) push(PLAN_ERROR_CODES.IMPORT_PLAN_INVALID, `${where}.from`, 'Each import plan unit needs a non-empty "from".');
  });
}

/**
 * Check a step's declared scope (`touches`): an object with optional `features` and `files` arrays. Shared with the
 * block contract (block-contract.mjs), whose `declaredScope` is exactly this shape, so there is one definition.
 *
 * @param {any} touches The value to check.
 * @param {string} at Dotted path used in error paths, e.g. `steps[0].touches`.
 * @param {(code:string, at:string, message:string) => void} push Called once per problem found.
 * @returns {void}
 */
export function validateTouches(touches, at, push) {
  if (!isPlainObject(touches)) {
    push(PLAN_ERROR_CODES.STEP_TOUCHES_INVALID, at, '"touches" must be an object with "features" and "files" arrays.');
    return;
  }
  for (const key of Object.keys(touches)) {
    if (key !== 'features' && key !== 'files') {
      push(PLAN_ERROR_CODES.STEP_TOUCHES_INVALID, `${at}.${key}`, `Unknown "touches" key "${key}" (expected "features" or "files").`);
    }
  }
  if (touches.features !== undefined && (!Array.isArray(touches.features) || !touches.features.every(isNonEmptyString))) {
    push(PLAN_ERROR_CODES.STEP_TOUCHES_INVALID, `${at}.features`, '"touches.features" must be an array of feature-name strings.');
  }
  if (touches.files === undefined) return;
  if (!Array.isArray(touches.files)) {
    push(PLAN_ERROR_CODES.STEP_TOUCHES_INVALID, `${at}.files`, '"touches.files" must be an array.');
    return;
  }
  touches.files.forEach((file, i) => {
    const where = `${at}.files[${i}]`;
    if (!isPlainObject(file)) {
      push(PLAN_ERROR_CODES.STEP_TOUCHES_INVALID, where, 'Each touched file must be an object with "path" and "change".');
      return;
    }
    if (!isNonEmptyString(file.path)) {
      push(PLAN_ERROR_CODES.STEP_TOUCHES_INVALID, `${where}.path`, 'Each touched file needs a non-empty "path".');
    } else if (isAbsolutePath(file.path)) {
      push(
        PLAN_ERROR_CODES.STEP_TOUCHES_ABSOLUTE_PATH,
        `${where}.path`,
        `"${file.path}" is absolute — touched paths are project-relative so a plan stays portable and reproducible across machines.`,
      );
    }
    if (!TOUCH_CHANGES.includes(file.change)) {
      push(
        PLAN_ERROR_CODES.STEP_TOUCHES_CHANGE_INVALID,
        `${where}.change`,
        `"change" must be one of: ${TOUCH_CHANGES.join(', ')} (got ${JSON.stringify(file.change)}).`,
      );
    }
    for (const key of Object.keys(file)) {
      if (!['path', 'change', 'layer', 'why'].includes(key)) {
        push(PLAN_ERROR_CODES.STEP_TOUCHES_INVALID, `${where}.${key}`, `Unknown touched-file key "${key}".`);
      }
    }
  });
}

function validateStep(step, index, seenIds, push) {
  const at = `steps[${index}]`;
  if (!isPlainObject(step)) {
    push(PLAN_ERROR_CODES.STEP_NOT_OBJECT, at, 'Each step must be a JSON object.');
    return;
  }
  for (const key of Object.keys(step)) {
    if (!STEP_FIELDS.includes(key)) push(PLAN_ERROR_CODES.STEP_UNKNOWN_FIELD, `${at}.${key}`, `Unknown step field "${key}". Known fields: ${STEP_FIELDS.join(', ')}.`);
  }
  // Each required field gets its own named code (rather than one generic
  // "missing field") so a caller can react to exactly what is wrong.
  if (!isNonEmptyString(step.id)) {
    push(PLAN_ERROR_CODES.STEP_ID_INVALID, `${at}.id`, '"id" is required and must be a non-empty string — #287 keys per-step run state off it.');
  } else if (seenIds.has(step.id)) {
    push(PLAN_ERROR_CODES.STEP_ID_DUPLICATE, `${at}.id`, `Duplicate step id "${step.id}".`);
  }
  if (!isNonEmptyString(step.title)) {
    push(PLAN_ERROR_CODES.STEP_TITLE_INVALID, `${at}.title`, '"title" is required and must be a non-empty string — it is what a human reads when reviewing the plan.');
  }
  if ('rationale' in step && typeof step.rationale !== 'string') {
    push(PLAN_ERROR_CODES.PLAN_FIELD_TYPE, `${at}.rationale`, '"rationale" must be a string.');
  }
  if ('estimateSeconds' in step && (typeof step.estimateSeconds !== 'number' || !Number.isFinite(step.estimateSeconds) || step.estimateSeconds < 0)) {
    push(PLAN_ERROR_CODES.STEP_ESTIMATE_INVALID, `${at}.estimateSeconds`, '"estimateSeconds" must be a finite number >= 0.');
  }

  if (!isNonEmptyString(step.flow)) {
    push(PLAN_ERROR_CODES.STEP_FLOW_MISSING, `${at}.flow`, '"flow" is required and must be a non-empty string naming a Construct flow.');
    return;
  }
  const flow = planFlow(step.flow);
  if (!flow) {
    push(
      PLAN_ERROR_CODES.STEP_FLOW_UNKNOWN,
      `${at}.flow`,
      `Unknown flow "${step.flow}". A plan step must name a real Construct flow: ${Object.keys(PLAN_FLOWS).join(', ')}.`,
    );
    return;
  }

  // --- executor ---------------------------------------------------------
  if (!('executor' in step)) {
    push(PLAN_ERROR_CODES.STEP_EXECUTOR_MISSING, `${at}.executor`, `"executor" is required — one of: ${PLAN_EXECUTORS.join(', ')}.`);
  } else if (!PLAN_EXECUTORS.includes(step.executor)) {
    push(PLAN_ERROR_CODES.STEP_EXECUTOR_INVALID, `${at}.executor`, `"executor" must be one of: ${PLAN_EXECUTORS.join(', ')} (got ${JSON.stringify(step.executor)}).`);
  } else if (!flow.executors.includes(step.executor)) {
    push(
      PLAN_ERROR_CODES.STEP_EXECUTOR_NOT_ALLOWED,
      `${at}.executor`,
      `Flow "${step.flow}" cannot be executed by "${step.executor}" — it allows: ${flow.executors.join(', ')}.`,
    );
  }

  // --- args -------------------------------------------------------------
  if (!isPlainObject(step.args)) {
    push(PLAN_ERROR_CODES.STEP_ARGS_NOT_OBJECT, `${at}.args`, '"args" is required and must be a JSON object (use {} for a flow that takes none).');
  } else {
    for (const [name, spec] of Object.entries(flow.args)) {
      if (spec.required && !(name in step.args)) {
        push(PLAN_ERROR_CODES.STEP_ARG_MISSING, `${at}.args.${name}`, `Flow "${step.flow}" requires the "${name}" argument.`);
      }
    }
    for (const [name, value] of Object.entries(step.args)) {
      const spec = flow.args[name];
      if (!spec) {
        push(
          PLAN_ERROR_CODES.STEP_ARG_UNKNOWN,
          `${at}.args.${name}`,
          `Flow "${step.flow}" takes no "${name}" argument. It accepts: ${Object.keys(flow.args).join(', ') || '(none)'}.`,
        );
        continue;
      }
      if (!checkArgType(spec, value)) {
        push(PLAN_ERROR_CODES.STEP_ARG_TYPE, `${at}.args.${name}`, `"${name}" must be of type ${spec.type} (got ${Array.isArray(value) ? 'array' : typeof value}).`);
        continue;
      }
      if (spec.enum && !spec.enum.includes(value)) {
        push(PLAN_ERROR_CODES.STEP_ARG_ENUM, `${at}.args.${name}`, `"${name}" must be one of: ${spec.enum.join(', ')} (got ${JSON.stringify(value)}).`);
      }
      if (spec.type === 'string[]' && value.length === 0) {
        push(PLAN_ERROR_CODES.STEP_ARG_TYPE, `${at}.args.${name}`, `"${name}" must not be an empty array.`);
      }
      if (spec.type === 'string' && value.length === 0) {
        push(PLAN_ERROR_CODES.STEP_ARG_TYPE, `${at}.args.${name}`, `"${name}" must not be an empty string.`);
      }
    }
    // A deterministic step must not smuggle a model in through its arguments.
    if (step.executor === 'deterministic' && isNonEmptyString(step.args.llm)) {
      push(
        PLAN_ERROR_CODES.STEP_EXECUTOR_LLM_CONFLICT,
        `${at}.args.llm`,
        `Step is tagged "deterministic" but passes llm "${step.args.llm}" — tag it "local-model" so the plan shows where a model is involved.`,
      );
    }
    if (step.flow === 'import.plan' && isPlainObject(step.args.plan)) {
      validateImportPlanArg(step.args.plan, `${at}.args.plan`, push);
    }
    if (step.flow === 'review.analyze' && isPlainObject(step.args.plan)) {
      const scope = step.args.plan;
      for (const key of Object.keys(scope)) {
        if (key !== 'features' && key !== 'files') push(PLAN_ERROR_CODES.STEP_ARG_TYPE, `${at}.args.plan.${key}`, `Unknown key "${key}" in the expected scope; it is { features, files }.`);
      }
      for (const key of ['features', 'files']) {
        if (key in scope && !(Array.isArray(scope[key]) && scope[key].every(isNonEmptyString))) {
          push(PLAN_ERROR_CODES.STEP_ARG_TYPE, `${at}.args.plan.${key}`, `"${key}" of the expected scope must be a list of non-empty strings.`);
        }
      }
    }
    if (step.flow === 'test.run') {
      const a = step.args;
      if (typeof a.feature === 'string' && !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(a.feature)) push(PLAN_ERROR_CODES.STEP_ARG_TYPE, `${at}.args.feature`, 'A feature name uses letters, digits, "_" and "-" only.');
      if (typeof a.name === 'string' && !/^[A-Za-z0-9][A-Za-z0-9._-]{0,120}\.spec\.ts$/.test(a.name)) push(PLAN_ERROR_CODES.STEP_ARG_TYPE, `${at}.args.name`, 'A test is named by its file name, like happy-path.spec.ts (no folders).');
      if ('name' in a && !('area' in a)) push(PLAN_ERROR_CODES.STEP_ARG_MISSING, `${at}.args.area`, 'Naming one test needs "area" too: generated or yours.');
      if ('area' in a && !('name' in a)) push(PLAN_ERROR_CODES.STEP_ARG_MISSING, `${at}.args.name`, '"area" only makes sense with the name of the test it is about.');
      if (typeof a['base-url'] === 'string' && !/^https?:\/\/[^\s/?#]+\/?$/.test(a['base-url'])) push(PLAN_ERROR_CODES.STEP_ARG_TYPE, `${at}.args.base-url`, 'The address of the app is where it runs, like http://localhost:3000 (no page, no query).');
    }
    if (step.flow === 'test.proof' || step.flow === 'create.proof') {
      const a = step.args;
      if (typeof a.feature === 'string' && !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(a.feature)) push(PLAN_ERROR_CODES.STEP_ARG_TYPE, `${at}.args.feature`, 'A feature name uses letters, digits, "_" and "-" only.');
    }
    if (step.flow === 'create.route') {
      const a = step.args;
      if (typeof a.feature === 'string' && !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(a.feature)) push(PLAN_ERROR_CODES.STEP_ARG_TYPE, `${at}.args.feature`, 'A feature name uses letters, digits, "_" and "-" only.');
      if (typeof a.name === 'string' && !/^[A-Za-z][A-Za-z0-9]*$/.test(a.name)) push(PLAN_ERROR_CODES.STEP_ARG_TYPE, `${at}.args.name`, 'A controller is named in PascalCase, like Products.');
      if (typeof a.route === 'string' && !/^\/[a-z0-9]+(-[a-z0-9]+)*(\/[a-z0-9]+(-[a-z0-9]+)*)*$/.test(a.route)) push(PLAN_ERROR_CODES.STEP_ARG_TYPE, `${at}.args.route`, 'A route is lowercase segments like /products or /shop/products.');
    }
    if (step.flow === 'add.dependency') {
      const a = step.args;
      if (typeof a.name === 'string' && !/^(@[a-z0-9~-][a-z0-9._~-]*\/)?[a-z0-9~-][a-z0-9._~-]*$/.test(a.name)) push(PLAN_ERROR_CODES.STEP_ARG_TYPE, `${at}.args.name`, 'A package name like @line/construct-core or react.');
      if (typeof a.version === 'string' && !/^[\^~]?\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(a.version)) push(PLAN_ERROR_CODES.STEP_ARG_TYPE, `${at}.args.version`, 'A version range like ^0.9.0.');
    }
    if (step.flow === 'test.proof' && typeof step.args.name === 'string' && !/^[A-Za-z][A-Za-z0-9]*\.proof\.test\.ts$/.test(step.args.name)) {
      push(PLAN_ERROR_CODES.STEP_ARG_TYPE, `${at}.args.name`, 'A proof is named by its file name, like ProductsScreen.proof.test.ts (no folders).');
    }
    if (step.flow === 'pipeline.run' && isPlainObject(step.args.envelope)) {
      const { valid, errors } = validateEnvelope(step.args.envelope);
      if (!valid) for (const message of errors) push(PLAN_ERROR_CODES.ENVELOPE_INVALID, `${at}.args.envelope`, message);
    }
  }

  // --- touches ----------------------------------------------------------
  if (step.touches !== undefined) {
    validateTouches(step.touches, `${at}.touches`, push);
  } else if (flow.writes) {
    push(
      PLAN_ERROR_CODES.STEP_TOUCHES_REQUIRED,
      `${at}.touches`,
      `Flow "${step.flow}" changes files, so the step must declare what it is expected to touch (use empty arrays if genuinely nothing).`,
    );
  }
}

function validateDependencies(steps, push) {
  const idsBefore = new Set();
  const allIds = new Set(steps.filter((s) => isPlainObject(s) && isNonEmptyString(s.id)).map((s) => s.id));
  steps.forEach((step, index) => {
    const at = `steps[${index}]`;
    if (!isPlainObject(step)) return;
    if (step.dependsOn !== undefined) {
      if (!Array.isArray(step.dependsOn) || !step.dependsOn.every(isNonEmptyString)) {
        push(PLAN_ERROR_CODES.STEP_DEPENDS_ON_INVALID, `${at}.dependsOn`, '"dependsOn" must be an array of step id strings.');
      } else {
        for (const dep of step.dependsOn) {
          if (dep === step.id) {
            push(PLAN_ERROR_CODES.STEP_DEPENDENCY_SELF, `${at}.dependsOn`, `Step "${step.id}" depends on itself.`);
          } else if (!allIds.has(dep)) {
            push(PLAN_ERROR_CODES.STEP_DEPENDENCY_UNKNOWN, `${at}.dependsOn`, `Step "${step.id}" depends on "${dep}", which is not a step in this plan.`);
          } else if (!idsBefore.has(dep)) {
            push(
              PLAN_ERROR_CODES.STEP_DEPENDENCY_FORWARD,
              `${at}.dependsOn`,
              `Step "${step.id}" depends on "${dep}", which comes later. A plan is an ordered list: dependencies may only point at earlier steps, which is also what makes a dependency cycle impossible.`,
            );
          }
        }
      }
    }
    if (isNonEmptyString(step.id)) idsBefore.add(step.id);
  });
}

/**
 * Bring a stored plan record up to the current schema version before
 * validation. v1 is the only version: identity. A v2 adds a step here that
 * returns the v2 shape; see docs/VERSIONING.md. *
 * @param {any} record A parsed stored plan record, any supported version.
 * @returns {any} The record at the current schema version.
 *
 * @example
 * migratePlan(JSON.parse(text));
 */
export function migratePlan(record) {
  return record;
}

/**
 * Validate a plan against schemas/plan.v1.json's shape and the flow
 * registry. Returns `{ valid, errors }` where each error is
 * `{ code, path, message }` — never throws, never mutates `plan`, never
 * prints. Reports every problem rather than stopping at the first, so a
 * review UI can show them all at once.
 *
 * `ext` (any object) is reserved for additive data and is never inspected.
 *
 * `path` is a JSON-pointer-ish dotted path into the plan
 * (e.g. `steps[2].args.feature`), so a caller can highlight the exact field.
 *
 * @param {any} plan The plan to check.
 * @returns {{valid:boolean, errors:{code:string, path:string, message:string}[]}} Every problem found.
 *
 * @example
 * validatePlan(plan).errors.map((e) => `${e.path}: ${e.message}`);
 */
export function validatePlan(plan) {
  const errors = [];
  const push = (code, at, message) => errors.push({ code, path: at, message });

  if (!isPlainObject(plan)) {
    return { valid: false, errors: [{ code: PLAN_ERROR_CODES.PLAN_NOT_OBJECT, path: '', message: 'Plan must be a JSON object.' }] };
  }
  for (const key of Object.keys(plan)) {
    if (!PLAN_TOP_LEVEL_FIELDS.includes(key)) {
      push(PLAN_ERROR_CODES.PLAN_UNKNOWN_FIELD, key, `Unknown plan field "${key}". Known fields: ${PLAN_TOP_LEVEL_FIELDS.join(', ')}. (Run state such as a step's status belongs to the process model, not the plan.)`);
    }
  }
  for (const key of PLAN_REQUIRED_FIELDS) {
    if (!(key in plan)) push(PLAN_ERROR_CODES.PLAN_MISSING_FIELD, key, `Missing required field "${key}".`);
  }
  if ('version' in plan && plan.version !== PLAN_VERSION) {
    push(PLAN_ERROR_CODES.PLAN_VERSION_INVALID, 'version', `"version" must be ${PLAN_VERSION} (got ${JSON.stringify(plan.version)}).`);
  }
  if ('summary' in plan && typeof plan.summary !== 'string') push(PLAN_ERROR_CODES.PLAN_FIELD_TYPE, 'summary', '"summary" must be a string.');
  if ('ext' in plan && !isPlainObject(plan.ext)) push(PLAN_ERROR_CODES.PLAN_FIELD_TYPE, 'ext', '"ext" must be an object (free-form, ignored by validators).');
  if ('impact' in plan && !isPlainObject(plan.impact)) push(PLAN_ERROR_CODES.PLAN_FIELD_TYPE, 'impact', '"impact" must be an object (the impact report from #288).');
  if ('constraints' in plan && !isPlainObject(plan.constraints)) push(PLAN_ERROR_CODES.PLAN_FIELD_TYPE, 'constraints', '"constraints" must be an object.');
  if ('provenance' in plan) {
    if (!isPlainObject(plan.provenance)) {
      push(PLAN_ERROR_CODES.PLAN_FIELD_TYPE, 'provenance', '"provenance" must be an object.');
    } else if ('deterministic' in plan.provenance && typeof plan.provenance.deterministic !== 'boolean') {
      push(PLAN_ERROR_CODES.PLAN_FIELD_TYPE, 'provenance.deterministic', '"provenance.deterministic" must be a boolean.');
    }
  }

  if ('ticket' in plan) {
    if (!isPlainObject(plan.ticket)) {
      push(PLAN_ERROR_CODES.TICKET_INVALID, 'ticket', '"ticket" must be an object: { source, title, ref?, body? }.');
    } else {
      if (!isNonEmptyString(plan.ticket.title)) push(PLAN_ERROR_CODES.TICKET_INVALID, 'ticket.title', '"ticket.title" must be a non-empty string.');
      if (!TICKET_SOURCES.includes(plan.ticket.source)) {
        push(PLAN_ERROR_CODES.TICKET_SOURCE_INVALID, 'ticket.source', `"ticket.source" must be one of: ${TICKET_SOURCES.join(', ')} (got ${JSON.stringify(plan.ticket.source)}).`);
      }
      for (const key of Object.keys(plan.ticket)) {
        if (!['source', 'title', 'ref', 'body'].includes(key)) push(PLAN_ERROR_CODES.TICKET_INVALID, `ticket.${key}`, `Unknown ticket field "${key}".`);
      }
    }
  }

  if ('steps' in plan) {
    if (!Array.isArray(plan.steps)) {
      push(PLAN_ERROR_CODES.STEPS_NOT_ARRAY, 'steps', '"steps" must be an array.');
    } else if (plan.steps.length === 0) {
      push(PLAN_ERROR_CODES.STEPS_EMPTY, 'steps', 'A plan must have at least one step.');
    } else {
      const seenIds = new Set();
      plan.steps.forEach((step, i) => {
        validateStep(step, i, seenIds, push);
        if (isPlainObject(step) && isNonEmptyString(step.id)) seenIds.add(step.id);
      });
      validateDependencies(plan.steps, push);
    }
  }

  return { valid: errors.length === 0, errors };
}

/** One human-readable line per structured error, for a CLI or a log. */
export function formatPlanErrors(errors) {
  return errors.map((e) => `${e.code}${e.path ? ` at ${e.path}` : ''}: ${e.message}`);
}

/**
 * Turn a step into the real command that performs it — the mantra applied:
 * each layer hands the next a concrete example, not an abstract spec. #287's
 * runner can execute a plan without re-deriving how any flow is invoked.
 *
 * Returns `{ argv, stdin, files, manual }`:
 *  - `argv`   the arguments to `packages/cli/construct.mjs`, or null for `manual.task`
 *             (nothing to run — read `instructions` instead)
 *  - `stdin`  a JSON string to pipe in (`pipeline.run`'s envelope), else null
 *  - `files`  object arguments the caller must write to a temp file and
 *             substitute for the placeholder token already sitting in `argv`
 *             (`import.plan`'s inline plan): `[{ placeholder, arg, value }]`
 *  - `manual` true when a human, not a command, performs the step
 *
 * Throws TypeError on an unknown flow — validate the plan first.
 *
 * @param {{flow:string, args?:object}} step A plan step.
 * @returns {{argv:string[]|null, stdin:string|null, files:object[], manual:boolean}} The command that performs the step.
 * @throws {TypeError} For an unknown flow.
 */
export function planToCommand(step) {
  const flow = planFlow(step?.flow);
  if (!flow) throw new TypeError(`Unknown flow "${step?.flow}".`);
  const args = step.args || {};
  if (flow.cli === null) return { argv: null, stdin: null, files: [], manual: true };

  const positionals = Object.entries(flow.args)
    .filter(([, spec]) => typeof spec.positional === 'number')
    .sort((a, b) => a[1].positional - b[1].positional);
  const argv = [...flow.cli];
  for (const [name] of positionals) {
    if (args[name] === undefined) break; // optional trailing positional (e.g. research.workflow's file)
    argv.push(String(args[name]));
  }
  argv.push(...(flow.fixedFlags || []));

  const files = [];
  let stdin = null;
  for (const [name, spec] of Object.entries(flow.args)) {
    if (typeof spec.positional === 'number' || args[name] === undefined) continue;
    if (spec.stdin) {
      stdin = JSON.stringify(args[name], null, 2);
      continue;
    }
    if (spec.type === 'boolean') {
      if (args[name]) argv.push(spec.flag);
      continue;
    }
    const value = spec.type === 'string[]' ? args[name].join(spec.join || ',') : args[name];
    if (spec.materialize === 'file') {
      const placeholder = `{{${name}}}`;
      files.push({ placeholder, arg: name, value });
      argv.push(spec.flag, placeholder);
      continue;
    }
    argv.push(spec.flag, String(value));
  }
  return { argv, stdin, files, manual: false };
}

/**
 * Roll the per-step `touches` up to plan level — the features and files the
 * whole plan expects to change, deduplicated, in first-mentioned order.
 * Derived rather than stored so there is only ever one source of truth.
 * Each file carries every `change` any step declared for it and the ids of
 * the steps that touch it, so "who wrote this file?" is answerable after the
 * fact.
 *
 * @param {object} plan A plan with `steps[].touches`.
 * @returns {{features:string[], files:{path:string, changes:string[], steps:string[], layer?:string}[]}} The deduplicated features and files the plan expects to change.
 */
export function planTouches(plan) {
  const features = [];
  const files = new Map();
  for (const step of plan?.steps || []) {
    for (const feature of step?.touches?.features || []) {
      if (!features.includes(feature)) features.push(feature);
    }
    for (const file of step?.touches?.files || []) {
      if (!file?.path) continue;
      if (!files.has(file.path)) files.set(file.path, { path: file.path, changes: [], steps: [], ...(file.layer ? { layer: file.layer } : {}) });
      const entry = files.get(file.path);
      if (file.change && !entry.changes.includes(file.change)) entry.changes.push(file.change);
      if (step.id && !entry.steps.includes(step.id)) entry.steps.push(step.id);
    }
  }
  return { features, files: [...files.values()] };
}
