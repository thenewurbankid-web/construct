// cp1 -- the Line operations as @mx/plan tools, merged with Construct's commands (packages/core/plan-registry.mjs)
// into ONE registry: { list(), call(name, args) } (packages/line-links/contracts.d.ts PlanRegistry). Only the plan
// runner calls `call`; Cockpit and agents add steps and approve/run them through the plan API (planService.mjs).
//
//   line.baseOn       write  BaseOnRequest   -> planBaseOn  + applyChange
//   line.promote      write  PromoteRequest  -> planPromote + applyChange
//   line.setPageProp  write  SetPropRequest  -> planSetProp + applyChange
//   line.fix          write  FixRequest      -> planFixByKey (a finding's typed fix, fixes.mjs) + applyChange
//   line.setFragment  write  SetFragmentRequest -> planSetFragment (fragments.mjs) + applyChange
//   line.setBase, line.moveFile, line.createLayout   write   the fix steps themselves (fixes.mjs planStep) + applyChange
//   line.import.mark, line.import.toLibrary, line.import.toFeature   write   ci1 Import's steps (import.mjs
//                     planImportStep): planned only when they run (each builds on the step before) with the import
//                     folder as the writer's root, so nothing outside that folder can be written
//   line.amend        write  {change, fix}   a refused change plus one fix of it whose file only that change creates,
//                                            planned together (fixes.mjs planAmended) and applied as ONE change
//   line.baseWorkflowOn, line.setWorkflowRole, line.addWorkflowTransition, line.removeWorkflowTransition
//                     write  cw1 workflows (workflows.mjs) + applyChange
//   line.leaveAsIs    write  {stepId}        -> a person's "carry on" after a step that needs them (writes nothing)
//   line.project      read   {}              -> readLineProject
//
// Correction loop (owner, 11 Oct): every write step carries `expect` (the checks that define done; defaults below),
// `gapOf` says per expected output whether it is already there before the step runs (present / partial / missing),
// and the step narrows itself to the files not already there. After the write its checks run and are recorded on
// the step's result; a failed check makes the step "needs you" with options. A retry that passes no more checks than
// the try before it stops (`stopped`) instead of looping. Every write still goes only through applyChange.
import fs from 'node:fs';
import path from 'node:path';
import { CHECK_KINDS, LineOpError, EXPR_JSON_SCHEMA, exprProblem } from './contract.mjs';
import { evaluate } from './expr.mjs';
import { buildFacts, newFindingFacts } from './facts.mjs';
import { DEFAULT_CHECK_EXPRS, checkPre } from './conditions.mjs';
import { planBaseOn, planPromote, applyChange, checkChange } from './ops.mjs';
import { planImportStep } from './import.mjs';
import { planSetProp } from './pageProp.mjs';
import { readLineProject } from './model.mjs';
import { planFixByKey, planStep, withFixes, planAmended, amendFixes, onScratch } from './fixes.mjs';
import { planSetFragment } from './fragments.mjs';
import { planCreateFeature, planAddRoute, planSetCode } from './build.mjs';
import { entryById } from './toolRegistry.mjs';

/** The one catalog's entry for a plan tool (toolRegistry.mjs); a tool the catalog does not list cannot be registered. */
const catalogEntry = (name) => { const e = entryById(name); if (!e || !e.surfaces.plan) throw new Error(`The tool registry has no plan tool ${name}.`); return e; };
import { planBaseWorkflowOn, planSetWorkflowRole, planAddWorkflowTransition, planRemoveWorkflowTransition } from './workflows.mjs';
import { importTools } from './importTools.mjs';
import { planExtractStep, EXTRACT_TOOLS } from './importV2/extract.mjs';

/** The real operations (tests pass the contract's mock instead). */
export const REAL_PLAN_OPS = Object.freeze({ planCreateFeature, planAddRoute, planSetCode, planBaseOn, planPromote, planSetProp, planFixByKey, planSetFragment, planStep, planAmended, planImportStep, planExtractStep, applyChange, checkChange, readLineProject, planBaseWorkflowOn, planSetWorkflowRole, planAddWorkflowTransition, planRemoveWorkflowTransition });

/** The write tools that plan a StagedChange, and the op that plans it (`planStep` takes {tool, args}). */
export const CHANGE_TOOLS = Object.freeze({
  'line.baseOn': 'planBaseOn', 'line.promote': 'planPromote', 'line.setPageProp': 'planSetProp',
  'line.fix': 'planFixByKey', 'line.setFragment': 'planSetFragment',
  'line.setBase': 'planStep', 'line.moveFile': 'planStep', 'line.createLayout': 'planStep',
  'line.amend': 'planAmended',
  'line.import.mark': 'planImportStep', 'line.import.toLibrary': 'planImportStep', 'line.import.toFeature': 'planImportStep',
  // Import v2 (importV2/extract.mjs): fit existing logic into Line's blocks, planned in the import folder
  ...Object.fromEntries(EXTRACT_TOOLS.map((t) => [t, 'planExtractStep'])),
  // cw1 workflows (workflows.mjs); promoting a workflow is line.promote like every other kind
  'line.baseWorkflowOn': 'planBaseWorkflowOn', 'line.setWorkflowRole': 'planSetWorkflowRole',
  'line.addWorkflowTransition': 'planAddWorkflowTransition', 'line.removeWorkflowTransition': 'planRemoveWorkflowTransition',
  'line.createFeature': 'planCreateFeature', 'line.addRoute': 'planAddRoute', 'line.setCode': 'planSetCode',
});

/** Change tools planned only when they run: an import step builds on the steps before it (the library item a feature
 * item is based on is moved there by an earlier step), so it cannot be planned, or its gap worked out, ahead. */
export const DEFERRED_TOOLS = Object.freeze(['line.import.mark', 'line.import.toLibrary', 'line.import.toFeature', ...EXTRACT_TOOLS]);
/**
 * Whether a tool's change is planned in its own folder (an import step) rather than at the project root.
 * @param {string} tool The tool name.
 * @returns {boolean}
 */
export const isDeferred = (tool) => DEFERRED_TOOLS.includes(tool);

/** A root-relative folder inside the project (no leading slash, no "." or ".." parts). */
const isFolder = (v) => typeof v === 'string' && v.length > 0 && !v.startsWith('/') && !v.endsWith('/') && !v.split('/').some((x) => x === '' || x === '.' || x === '..');

/**
 * Where a tool's change is planned and written: the import folder for an import step, else the project root.
 * @param {string} root The project root.
 * @param {string} tool The tool name.
 * @param {any} args The step's args.
 * @returns {string}
 */
export function rootOf(root, tool, args) {
  if (!isDeferred(tool)) return root;
  if (!isFolder(args?.folder)) throw new LineOpError('The import folder must be a folder inside the project.', 'BAD_FOLDER');
  const at = path.join(root, String(args.folder));
  if (!fs.existsSync(at)) throw new LineOpError(`There is no folder ${args.folder} in this project.`, 'BAD_FOLDER');
  return at;
}

/** How deep a line.amend may wrap another line.amend (a refused amended change amended again). */
const MAX_AMEND_DEPTH = 3;

/** Plan a change tool's request with `ops` (pure; throws a LineOpError for a refusal). */
function planWith(ops, root, tool, req, depth = 0) {
  const opName = CHANGE_TOOLS[tool];
  if (opName === 'planImportStep') return ops.planImportStep(rootOf(root, tool, req), { id: tool, tool, args: req });
  if (opName === 'planExtractStep') return (ops.planExtractStep ?? planExtractStep)(rootOf(root, tool, req), { tool, args: req });
  if (opName === 'planAmended') {
    const { change, fix: one, fixes } = /** @type {any} */ (req);
    const fix = fixes ?? one;
    if (!fix || (one && fixes)) throw new LineOpError('Name the fix to apply with the change: one step as "fix", or several in order as "fixes".', 'BAD_ARGS');
    if (depth >= MAX_AMEND_DEPTH) throw new LineOpError('This change amends too many refused changes in a row; apply them one at a time.', 'BAD_ARGS');
    if (!CHANGE_TOOLS[change?.tool]) throw new LineOpError(`"${change?.tool}" is not a Line change, so it cannot be amended.`, 'UNKNOWN_TOOL');
    const first = planWith(ops, root, change.tool, requestOf(change.args), depth + 1);
    return (ops.planAmended ?? planAmended)(root, first, fix);
  }
  return opName === 'planStep' ? ops.planStep(root, { tool, args: req }) : ops[opName](root, req);
}

/** The checks every change tool expects unless the step names its own. */
export const DEFAULT_EXPECT = Object.freeze([
  Object.freeze({ id: 'validate', sentence: 'Validate (profile line) shows no new problems.', kind: 'validate', expr: DEFAULT_CHECK_EXPRS.validate }),
  Object.freeze({ id: 'files', sentence: 'The planned files exist with the planned content.', kind: 'file', expr: DEFAULT_CHECK_EXPRS.files }),
]);

// ------------------------------------------------------------------------------------------------- schemas
const failed = (p, message) => ({ success: /** @type {const} */ (false), error: { issues: [{ path: p, message }] } });
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isStep = (v) => isObj(v) && typeof v.tool === 'string' && v.tool.length > 0 && (v.args === undefined || isObj(v.args));
const TYPES = {
  string: (v) => typeof v === 'string' && v.length > 0,
  anyString: (v) => typeof v === 'string',
  optString: (v) => v === undefined || (typeof v === 'string' && v.length > 0),
  step: (v) => isStep(v),
  optStep: (v) => v === undefined || isStep(v),
  optSteps: (v) => v === undefined || (Array.isArray(v) && v.length > 0 && v.length <= 4 && v.every(isStep)),
  scalar: (v) => ['string', 'number', 'boolean'].includes(typeof v),
  propKind: (v) => ['string', 'number', 'boolean', 'expression'].includes(v),
  strings: (v) => Array.isArray(v) && v.length > 0 && v.length <= 50 && v.every((x) => typeof x === 'string' && x.trim().length > 0),
};

/** `expect`: a list of {id, sentence, kind}. */
function checkExpect(v) {
  if (!Array.isArray(v) || v.length === 0 || v.length > 10) return 'must be a list of 1 to 10 checks';
  for (const c of v) {
    if (!isObj(c) || typeof c.id !== 'string' || !c.id || typeof c.sentence !== 'string' || !/^\S.*[.?!]$/.test(c.sentence) || !CHECK_KINDS.includes(c.kind)) {
      return `must hold checks like {"id": "files", "sentence": "The file exists.", "kind": "file"} (kinds: ${CHECK_KINDS.join(', ')})`;
    }
    if (c.expr !== undefined) { const why = exprProblem(c.expr); if (why) return `has a check "${c.id}" whose expression cannot be used: ${why.charAt(0).toLowerCase()}${why.slice(1).replace(/[.?!]$/, '')}`; }
  }
  return null;
}
/** `retry`: {of: <step id>, passed?: number}. */
function checkRetry(v) {
  if (!isObj(v) || typeof v.of !== 'string' || !v.of) return 'must be {"of": "<step id>"}';
  if (v.passed !== undefined && !Number.isInteger(v.passed)) return 'passed must be a whole number';
  return null;
}

/** JSON Schema for each field type of objectSchema (cl1 spec). */
const JSON_TYPES = Object.freeze({
  string: { type: 'string', minLength: 1 },
  anyString: { type: 'string' },
  optString: { type: 'string', minLength: 1 },
  scalar: { type: ['string', 'number', 'boolean'] },
  propKind: { enum: ['string', 'number', 'boolean', 'expression'] },
  strings: { type: 'array', minItems: 1, maxItems: 50, items: { type: 'string', minLength: 1 } },
  step: { type: 'object', required: ['tool'], properties: { tool: { type: 'string', minLength: 1 }, args: { type: 'object' } } },
  optStep: { type: 'object', required: ['tool'], properties: { tool: { type: 'string', minLength: 1 }, args: { type: 'object' } } },
  optSteps: { type: 'array', minItems: 1, maxItems: 4, items: { type: 'object', required: ['tool'], properties: { tool: { type: 'string', minLength: 1 }, args: { type: 'object' } } } },
});
/** The JSON Schema an objectSchema accepts: its fields, plus `expect`, `retry` and `fixOf` on a change tool. */
function jsonSchemaOf(required, o) {
  const properties = Object.fromEntries(Object.entries(required).map(([k, t]) => [k, { ...JSON_TYPES[t] }]));
  if (o.change) {
    properties.expect = { type: 'array', minItems: 1, maxItems: 10, items: { type: 'object', required: ['id', 'sentence', 'kind'], properties: { id: { type: 'string' }, sentence: { type: 'string' }, kind: { enum: [...CHECK_KINDS] }, expr: { $ref: EXPR_JSON_SCHEMA.$id } } } };
    properties.retry = { type: 'object', required: ['of'], properties: { of: { type: 'string' }, passed: { type: 'integer' } } };
    properties.fixOf = { type: 'string', minLength: 1, description: 'The id of the refused step this step fixes.' };
  }
  return { type: 'object', properties, required: Object.entries(required).filter(([, t]) => !['optString', 'optStep', 'optSteps'].includes(t)).map(([k]) => k), additionalProperties: false };
}

/**
 * cl1 -- every line.* plan tool as the spec describes it: name, read/write, one sentence, JSON Schema of its args.
 * @returns {{name: string, kind: string, describe: string, args: any}[]}
 */
export function lineToolSpecs() {
  const own = Object.keys(SCHEMAS).map((name) => ({
    name, kind: name === 'line.project' ? 'read' : 'write', describe: DESCRIBE[name], args: SCHEMAS[name].jsonSchema(),
  }));
  // ci2's line.import.fix (importTools.mjs) is in the same registry, so the spec lists it too.
  const fix = importTools({ root: '.' }).map((t) => ({ name: t.name, kind: t.kind, describe: t.describe, args: /** @type {any} */ (t.schema).jsonSchema() }));
  return [...own, ...fix];
}

/**
 * A SchemaLike (safeParse only) over required and optional fields; unknown fields are refused.
 * @param {Record<string, keyof typeof TYPES>} required
 * @param {{change?: boolean}} [o] `change` also allows `expect` and `retry`.
 */
function objectSchema(required, o = {}) {
  return Object.freeze({
    fields: Object.keys(required),
    /** cl1: the field types and plan-only fields, so the spec can describe the schema from this code. */
    jsonSchema: () => jsonSchemaOf(required, o),
    safeParse(value) {
      const v = value ?? {};
      if (!isObj(v)) return failed([], 'must be an object');
      const allowed = new Set([...Object.keys(required), ...(o.change ? ['expect', 'retry', 'fixOf'] : [])]);
      const extra = Object.keys(v).find((k) => !allowed.has(k));
      if (extra) return failed([extra], 'is not an argument of this tool');
      for (const [k, t] of Object.entries(required)) if (!TYPES[t](v[k])) return failed([k], t === 'scalar' ? 'must be a string, number or boolean' : t === 'propKind' ? 'must be string, number, boolean or expression' : t === 'anyString' ? 'must be a string' : t === 'step' || t === 'optStep' ? 'must be a step {"tool": "line.<name>", "args": {...}}' : t === 'optSteps' ? 'must be a list of 1 to 4 steps {"tool": "line.<name>", "args": {...}}' : t === 'strings' ? 'must be a JSON list of 1 to 50 non-empty strings, like ["First point.", "Second point."]' : 'must be a non-empty string');
      if (v.expect !== undefined) { const why = checkExpect(v.expect); if (why) return failed(['expect'], why); }
      if (v.retry !== undefined) { const why = checkRetry(v.retry); if (why) return failed(['retry'], why); }
      if (v.fixOf !== undefined && (typeof v.fixOf !== 'string' || !v.fixOf)) return failed(['fixOf'], 'must be the id of the step this fix is for');
      return { success: /** @type {const} */ (true), data: { ...v } };
    },
  });
}

/** An import step's args (import.mjs planImport's steps): the fields listed, plus `expect`, `retry` and `fixOf`. */
function importSchema(fields) {
  const IMPORT_TYPES = {
    string: TYPES.string, optString: TYPES.optString,
    strings: (v) => Array.isArray(v) && v.every((x) => typeof x === 'string' && x.length > 0),
    optStrings: (v) => v === undefined || (Array.isArray(v) && v.every((x) => isFolder(x))),
    optBool: (v) => v === undefined || typeof v === 'boolean',
    mode: (v) => v === 'move' || v === 'wrap',
    names: (v) => Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === 'string' && /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(x)),
  };
  const loose = objectSchema({}, { change: true });
  const IMPORT_JSON = {
    string: { type: 'string', minLength: 1 }, optString: { type: 'string', minLength: 1 },
    strings: { type: 'array', items: { type: 'string', minLength: 1 } }, optStrings: { type: 'array', items: { type: 'string', minLength: 1 } }, optBool: { type: 'boolean' }, mode: { enum: ['move', 'wrap'] },
    names: { type: 'array', minItems: 1, items: { type: 'string', pattern: '^[A-Za-z_$][A-Za-z0-9_$]*$' } },
  };
  return Object.freeze({
    fields: Object.keys(fields),
    /** cl1: the import step's JSON Schema (its fields plus the plan-only expect, retry and fixOf), for the spec. */
    jsonSchema: () => {
      const plan = loose.jsonSchema();
      const properties = { ...Object.fromEntries(Object.entries(fields).map(([k, t]) => [k, { ...IMPORT_JSON[t] }])), ...plan.properties };
      return { type: 'object', properties, required: Object.entries(fields).filter(([, t]) => !['optString', 'optBool', 'optStrings'].includes(t)).map(([k]) => k), additionalProperties: false };
    },
    safeParse(value) {
      const v = value ?? {};
      if (!isObj(v)) return failed([], 'must be an object');
      const extra = Object.keys(v).find((k) => !(k in fields) && !['expect', 'retry', 'fixOf'].includes(k));
      if (extra) return failed([extra], 'is not an argument of this tool');
      for (const [k, t] of Object.entries(fields)) if (!IMPORT_TYPES[t](v[k])) return failed([k], t === 'strings' ? 'must be a list of names' : t === 'names' ? 'must be a list of function names' : t === 'optBool' ? 'must be true or false' : t === 'mode' ? 'must be move or wrap' : 'must be a non-empty string');
      if (!isFolder(v.folder)) return failed(['folder'], 'must be a folder inside the project');
      const rest = Object.fromEntries(Object.entries(v).filter(([k]) => !(k in fields)));
      const r = loose.safeParse(rest);
      return r.success ? { success: /** @type {const} */ (true), data: { ...v } } : r;
    },
  });
}

const SCHEMAS = Object.freeze({
  'line.baseOn': objectSchema({ libraryId: 'string', feature: 'string', name: 'string' }, { change: true }),
  'line.promote': objectSchema({ featureItemId: 'string' }, { change: true }),
  'line.setPageProp': objectSchema({ file: 'string', nodeId: 'string', prop: 'string', kind: 'propKind', value: 'scalar' }, { change: true }),
  'line.fix': objectSchema({ findingKey: 'string', fixId: 'string' }, { change: true }),
  'line.setFragment': objectSchema({ file: 'string', fragmentId: 'string', code: 'anyString', contentHash: 'string' }, { change: true }),
  'line.setBase': objectSchema({ file: 'string', libraryId: 'string' }, { change: true }),
  'line.moveFile': objectSchema({ from: 'string', to: 'string', base: 'optString' }, { change: true }),
  'line.createLayout': objectSchema({}, { change: true }),
  'line.import.mark': importSchema({ folder: 'string', features: 'strings', appFolders: 'optStrings' }),
  'line.import.toLibrary': importSchema({ folder: 'string', from: 'string', kind: 'string', name: 'string', exportName: 'optString', level: 'optString', keepShim: 'optBool' }),
  'line.import.toFeature': importSchema({ folder: 'string', mode: 'mode', from: 'optString', kind: 'string', name: 'string', exportName: 'optString', feature: 'string', base: 'string', keepShim: 'optBool', route: 'optString' }),
  'line.import.extractService': importSchema({ folder: 'string', from: 'string', names: 'names', name: 'string', feature: 'optString', typedContracts: 'optString' }),
  'line.import.extractDomain': importSchema({ folder: 'string', from: 'string', names: 'names', name: 'string', feature: 'optString', typedContracts: 'optString' }),
  'line.import.extractUsecase': importSchema({ folder: 'string', from: 'string', names: 'names', name: 'string', feature: 'optString' }),
  'line.import.splitPage': importSchema({ folder: 'string', from: 'string', component: 'string', name: 'string', feature: 'optString' }),
  'line.import.extractWorkflow': importSchema({ folder: 'string', from: 'string', component: 'string', name: 'string', feature: 'optString' }),
  'line.amend': objectSchema({ change: 'step', fix: 'optStep', fixes: 'optSteps' }, { change: true }),
  'line.baseWorkflowOn': objectSchema({ libraryId: 'string', feature: 'string', name: 'string' }, { change: true }),
  'line.setWorkflowRole': objectSchema({ file: 'string', role: 'string', page: 'anyString' }, { change: true }),
  'line.addWorkflowTransition': objectSchema({ file: 'string', from: 'string', event: 'string', to: 'string', service: 'optString', part: 'optString', partState: 'optString' }, { change: true }),
  'line.removeWorkflowTransition': objectSchema({ file: 'string', from: 'string', event: 'string' }, { change: true }),
  'line.createFeature': objectSchema({ name: 'string', story: 'string', points: 'strings' }, { change: true }),
  'line.addRoute': objectSchema({ route: 'string', page: 'string' }, { change: true }),
  'line.setCode': objectSchema({ file: 'string', code: 'string', contentHash: 'optString' }, { change: true }),
  'line.leaveAsIs': objectSchema({ stepId: 'string' }),
  'line.project': objectSchema({}),
});

const DESCRIBE = Object.freeze({
  'line.baseOn': 'Creates a feature component based on one library item, through Construct\'s checked writer.',
  'line.promote': 'Moves a feature item into the library and points its users at the library copy, through the checked writer.',
  'line.setPageProp': 'Sets one prop of one part of a feature page, through the checked writer.',
  'line.fix': 'Applies one typed fix of a finding (by its key and fix id), through the checked writer.',
  'line.setFragment': 'Replaces one code fragment of a file (spot code editing), through the checked writer.',
  'line.setBase': 'Points a feature item\'s base link at one library item, through the checked writer.',
  'line.moveFile': 'Moves a file and re-points every import of it, through the checked writer.',
  'line.createLayout': 'Creates the library folder so the project is laid out as Line, through the checked writer.',
  'line.import.mark': 'Import: marks a folder as a Line folder (architecture.yml, library, feature specs), through the checked writer.',
  'line.import.toLibrary': 'Import: moves one item of the import folder into its library, through the checked writer.',
  'line.import.toFeature': 'Import: moves one item into a feature of the import folder, or adds it based on its library copy, through the checked writer.',
  'line.import.extractService': 'Import v2: moves the named top-level functions of a file (data hooks, adapters) into a service of the import folder; the old file imports them back, through the checked writer.',
  'line.import.extractDomain': 'Import v2: moves the named pure functions and rules of a file into a domain of the import folder; the old file imports them back, through the checked writer.',
  'line.import.extractUsecase': 'Import v2: moves the named orchestration functions of a file (one user goal) into a usecase of the import folder, through the checked writer.',
  'line.import.splitPage': 'Import v2: splits a page or component into its presentation and a use<Name> hook (a usecase) holding its logic, through the checked writer.',
  'line.import.extractWorkflow': 'Import v2: makes an xstate workflow of the URL state and navigation of a component, in the library with the feature workflow based on it, through the checked writer.',
  'line.amend': 'Applies a change Construct refused together with one typed fix of it, as one change, through the checked writer (for a fix whose file only that change creates).',
  'line.baseWorkflowOn': 'Creates a feature workflow based on one library workflow (a copy of its state machine, its pages not chosen yet), through the checked writer.',
  'line.setWorkflowRole': 'Chooses which page of the feature fills one role of a feature workflow (empty page clears it), through the checked writer.',
  'line.addWorkflowTransition': 'Adds a When -> Do transition to a feature workflow: when a state gets an event, optionally call a service or set a part\'s state, then go to a state; through the checked writer.',
  'line.removeWorkflowTransition': 'Removes a transition a feature added to its workflow (the library workflow\'s stay), through the checked writer.',
  'line.createFeature': 'Creates a new feature folder with its spec.md (one story and its acceptance points), through the checked writer.',
  'line.addRoute': 'Serves one feature page at a route: an app-router entry that only re-exports the page, plus the page\'s @line-route, through the checked writer.',
  'line.setCode': 'Writes the whole code of one library or feature file (or a feature\'s spec.md); an existing file needs the contentHash it was read at; through the checked writer.',
  'line.leaveAsIs': 'Records that a person chose to carry on after a step that needed them; writes nothing.',
  'line.project': 'Reads the Line view of the project: library, features, items and findings.',
});

// ------------------------------------------------------------------------------------------------- gap and checks
/**
 * The change args without the plan-only fields.
 * @param {any} args The step's args.
 * @returns {any} The change request.
 */
export const requestOf = (args) => { const { expect: _e, retry: _r, fixOf: _f, ...req } = args ?? {}; return req; };
const base = (p) => path.basename(p);
const readOrNull = (root, rel) => { try { return fs.readFileSync(path.join(root, rel), 'utf8'); } catch { return null; } };

/**
 * Per planned file: already as planned (present: the content, or gone for a delete) or not yet (missing).
 * @param {string} root The project root.
 * @param {any} staged The planned change.
 * @returns {{path: string, state: string}[]}
 */
export function fileStates(root, staged) {
  return staged.files.map((f) => ({ path: f.path, state: readOrNull(root, f.path) === f.content ? 'present' : 'missing' }));
}

/**
 * Before a step runs: for each expected output, whether it is already there. Pure read.
 * @param {string} root @param {string} tool @param {Record<string, unknown>} args @param {typeof REAL_PLAN_OPS} [ops]
 * @returns {import('./contract.mjs').GapItem[]}
 */
export function gapOf(root, tool, args, ops = REAL_PLAN_OPS) {
  const opName = CHANGE_TOOLS[tool];
  if (!opName) return [];
  const expect = Array.isArray(args?.expect) ? args.expect : DEFAULT_EXPECT;
  if (isDeferred(tool)) return expect.map((c) => ({ checkId: c.id, state: /** @type {const} */ ('missing'), sentence: `To do when it runs (it builds on the steps before it): ${lower(c.sentence)}` }));
  let staged;
  try { staged = planWith(ops, root, tool, requestOf(args)); } catch (e) {
    const s = /** @type {any} */ (e)?.sentence ?? 'This change can no longer be planned.';
    return expect.map((c) => ({ checkId: c.id, state: /** @type {const} */ ('missing'), sentence: `To do: ${lower(c.sentence)} It cannot run as it stands: ${lower(s)}` }));
  }
  const files = fileStates(root, staged);
  return expect.map((c) => {
    if (c.kind !== 'file') return { checkId: c.id, state: /** @type {const} */ ('missing'), sentence: `To do: ${lower(c.sentence)}` };
    const present = files.filter((f) => f.state === 'present');
    if (present.length === files.length) return { checkId: c.id, state: /** @type {const} */ ('present'), sentence: `Already there: ${files.map((f) => base(f.path)).join(', ')} as planned.` };
    if (present.length) {
      return { checkId: c.id, state: /** @type {const} */ ('partial'), sentence: `Already there: ${present.map((f) => base(f.path)).join(', ')}; to do: ${files.filter((f) => f.state !== 'present').map((f) => base(f.path)).join(', ')}.` };
    }
    return { checkId: c.id, state: /** @type {const} */ ('missing'), sentence: `To do: write ${files.map((f) => base(f.path)).join(', ')}.` };
  });
}
const lower = (s) => String(s).charAt(0).toLowerCase() + String(s).slice(1);

/**
 * The facts a step's checks are evaluated against: what it planned and what the writer did, plus (read only when an
 * expression needs them) the project's facts after the write.
 * @param {string} root @param {string} tool @param {any} staged @param {any} apply @param {typeof REAL_PLAN_OPS} [ops]
 * @returns {any} A lazy LineFacts (facts.mjs buildFacts).
 */
export function stepFacts(root, tool, staged, apply, ops = REAL_PLAN_OPS) {
  const plan = { tool, staged: Boolean(staged), applied: Boolean(apply?.ok), files: staged ? fileStates(root, staged).map((f) => ({ path: f.path, asPlanned: f.state === 'present' })) : [] };
  return buildFacts(root, { ops, plan, findingsNew: apply?.ok ? [] : newFindingFacts(apply?.findings) });
}

/**
 * After a write: each expected check, run. `validate` passes when the writer landed the change (it blocks every
 * NEW problem of the line profile); `file` re-reads every planned file. A check with an `expr` is decided by its
 * expression over the step's facts (stepFacts); for validate and file checks the sentence stays cp1's whenever the
 * expression agrees with it (the default expressions always do), else it is the expression's own failed sentence.
 * Kinds Line cannot run yet, without an expression, fail honestly.
 * @param {string} root The project root.
 * @param {any[]} expect The expected checks.
 * @param {any} staged The planned change.
 * @param {any} apply The writer's result.
 * @param {{tool?: string, ops?: typeof REAL_PLAN_OPS, facts?: any}} [o]
 * @returns {import('./contract.mjs').CheckResult[]}
 */
export function runChecks(root, expect, staged, apply, o = {}) {
  let facts = o.facts ?? null;
  const factsNow = () => (facts ??= stepFacts(root, o.tool ?? '', staged, apply, o.ops));
  return expect.map((c) => {
    const legacy = legacyCheck(root, c, staged, apply);
    if (c.expr === undefined) return legacy;
    const r = evaluate(factsNow(), c.expr);
    if ((c.kind === 'validate' || c.kind === 'file') && r.ok === legacy.ok) return legacy;
    return { checkId: c.id, ok: r.ok, sentence: r.ok ? c.sentence : r.failed.map((f) => f.sentence).join(' ') };
  });
}

/** cp1's check, as it always ran. */
function legacyCheck(root, c, staged, apply) {
  if (c.kind === 'validate') {
    if (apply.ok) return { checkId: c.id, ok: true, sentence: 'Validate shows no new problems.' };
    const first = apply.findings.find((f) => f.severity === 'error');
    return { checkId: c.id, ok: false, sentence: first ? `Validate found a new problem: ${lower(first.sentence)}` : `Not checked, because nothing was saved: ${lower(apply.sentence.replace(/^Nothing was saved: /, ''))}` };
  }
  if (c.kind === 'file') {
    if (!staged) return { checkId: c.id, ok: false, sentence: 'The planned files were not written, because the change could not be planned.' };
    const wrong = fileStates(root, staged).filter((f) => f.state !== 'present');
    if (!wrong.length) return { checkId: c.id, ok: true, sentence: `${staged.files.length === 1 ? 'The planned file is' : `All ${staged.files.length} planned files are`} there as planned.` };
    const names = wrong.map((f) => base(f.path));
    const shown = new Set(names).size === names.length ? names : wrong.map((f) => f.path);
    return { checkId: c.id, ok: false, sentence: `${shown.join(', ')} ${wrong.length === 1 ? 'is' : 'are'} not as planned.` };
  }
  return { checkId: c.id, ok: false, sentence: `Line cannot run ${c.kind} checks for a step yet, so "${c.sentence.replace(/[.?!]$/, '')}" is not confirmed.` };
}

/**
 * The typed fixes of a refused change's findings, worked out on the project as the change would leave it (the
 * findings only exist there): a scratch copy of the project (no node_modules, no .git) with the change written,
 * removed afterwards. With `refused` (the refused step's {tool, args}), a fix that only works with the change in place
 * becomes one line.amend step. Never throws; on any trouble the findings come back as they are.
 * @param {string} root The project root.
 * @param {any} staged The refused change.
 * @param {any[]} findings Its findings.
 * @param {{tool: string, args: any} | null} [refused] The refused step's tool and args.
 * @returns {any[]} The findings with their fixes.
 */
export function fixesAsProposed(root, staged, findings, refused = null) {
  try {
    const withTyped = onScratch(root, staged, (scratch) => withFixes(scratch, findings));
    // A fix that names a file only the refused change creates cannot run on its own: it becomes one line.amend step
    // carrying the refused change and the fix together (fixes.mjs amendFixes).
    return refused ? amendFixes(root, refused, staged, withTyped) : withTyped;
  } catch {
    return findings;
  }
}

/**
 * Run one change tool: plan (pure), narrow to the files not already there, apply through the writer, check.
 * Never throws for a refusal: the step's result records it and says the step needs the person.
 * @param {string} projectRoot The project root.
 * @param {string} tool The change tool.
 * @param {any} args The step's args.
 * @param {any} [ops] The Line ops (real by default).
 * @param {{pre?: boolean}} [o] `pre`: evaluate the tool's pre first (the registry does; a retry skips it).
 * @returns {import('./contract.mjs').LineStepResult}
 */
export function runChange(projectRoot, tool, args, ops = REAL_PLAN_OPS, o = {}) {
  const expect = Array.isArray(args?.expect) ? args.expect : DEFAULT_EXPECT;
  // An import step plans and writes inside its folder (the writer's root), and reports project-relative paths.
  let root = projectRoot;
  const folder = isDeferred(tool) ? String(args?.folder ?? '') : '';
  const prefixed = (r) => (folder ? { ...r, files: r.files.map((f) => `${folder}/${f}`), findings: r.findings.map((x) => ({ ...x, file: x.file === '.' ? folder : `${folder}/${x.file}` })) } : r);
  // The tool's pre, on the project as it is now (not for a retry: that repairs a step whose pre already held).
  const refusedByPre = o.pre && !args?.retry ? preRefusal(projectRoot, tool, args, ops) : null;
  /** @type {import('./contract.mjs').StagedChange | null} */
  let staged = null;
  /** @type {import('./contract.mjs').ApplyResult} */
  let apply;
  try {
    if (refusedByPre) throw new LineOpError(refusedByPre, 'PRE_FAILED');
    root = rootOf(projectRoot, tool, args);
    staged = planWith(ops, projectRoot, tool, requestOf(args));
  } catch (e) {
    if (!(e instanceof LineOpError) && /** @type {any} */ (e)?.name !== 'LineOpError') throw e;
    // The refusal's code (UNKNOWN_FEATURE, NAME_TAKEN, ...) travels with it, so a caller can tell why without parsing words.
    apply = /** @type {any} */ ({ ok: false, sentence: `Nothing was saved: ${lower(/** @type {any} */ (e).sentence)}`, files: [], findings: [], code: /** @type {any} */ (e).code ?? null });
  }
  if (staged) {
    const todo = fileStates(root, staged).filter((f) => f.state !== 'present').map((f) => f.path);
    const narrowed = { ...staged, files: staged.files.filter((f) => todo.includes(f.path)) };
    apply = narrowed.files.length ? ops.applyChange(root, narrowed) : { ok: true, sentence: `Nothing to save: ${lower(staged.summary.replace(/[.?!]$/, ''))} is already there.`, files: [], findings: [] };
    // A plan may carry warnings that must not block (a type check too slow to gate the save): shown after it lands.
    const warnings = /** @type {any} */ (staged).warnings;
    if (/** @type {any} */ (apply).ok && Array.isArray(warnings) && warnings.length) apply = { .../** @type {any} */ (apply), findings: [.../** @type {any} */ (apply).findings, ...warnings] };
  }
  if (!/** @type {any} */ (apply).ok && /** @type {any} */ (apply).findings.length && staged) {
    apply = { .../** @type {any} */ (apply), findings: fixesAsProposed(root, staged, /** @type {any} */ (apply).findings, { tool, args: requestOf(args) }) };
  }
  const checks = runChecks(root, expect, staged, /** @type {any} */ (apply), { tool, ops });
  apply = prefixed(/** @type {any} */ (apply));
  const passed = checks.filter((c) => c.ok).length;
  const total = checks.length;
  const needsYou = passed < total;
  const prior = args?.retry && Number.isInteger(args.retry.passed) ? Number(args.retry.passed) : null;
  const stopped = needsYou && prior !== null && passed <= prior;
  /** @type {import('./contract.mjs').StepOption[]} */
  const options = [];
  if (needsYou) {
    // Construct's refusal is the source of truth: each new error's typed fixes (fixes.mjs, rank 1 recommended) become
    // the next step options, as plan steps a person (one click) or an agent (plan_add_step with args.fixOf) can add.
    for (const f of /** @type {any} */ (apply).findings.filter((x) => x.severity === 'error').slice(0, 3)) {
      const fixes = Array.isArray(f.fixes) ? f.fixes : [];
      if (!fixes.length) options.push({ id: 'fix', sentence: f.sentence });
      for (const x of fixes.slice(0, 3)) {
        options.push(x.step
          ? { id: 'fix', fixId: x.id, sentence: x.sentence, recommended: x.rank === 1, step: { tool: x.step.tool, args: { ...x.step.args } } }
          : { id: 'fix', fixId: x.id, sentence: x.sentence, recommended: false, step: null });
      }
    }
    if (!stopped) options.push({ id: 'retry', sentence: 'Try this step again.' });
    options.push({ id: 'leave', sentence: 'Leave it as it is and carry on.' });
  }
  const failing = checks.filter((c) => !c.ok).map((c) => c.sentence);
  // cl1: Construct refused the change and none of its fixes would land either (each was tried on a scratch copy).
  const noFixLands = needsYou && /** @type {any} */ (apply).findings.some((f) => f.severity === 'error' && Array.isArray(f.fixes) && f.fixes.length) && !options.some((o) => o.id === 'fix' && o.step);
  const sentence = !needsYou
    ? /** @type {any} */ (apply).sentence
    : stopped
      ? `Trying again passed ${passed} of ${total} checks, no more than before, so Line stopped and needs you: ${lower(failing.join(' '))}`
      : noFixLands
        ? `This needs you: Construct refused the change, and none of its fixes would be accepted either, so Line cannot fix it on its own. ${failing.join(' ')}`
        : `This needs you: ${passed} of ${total} checks passed. ${failing.join(' ')}`;
  // ci2: a fix of an import step runs inside the import folder too, as one line.import.fix step (importTools.mjs).
  const offered = folder ? options.map((o) => (o.id === 'fix' && o.step ? { ...o, step: { tool: 'line.import.fix', args: { folder, tool: o.step.tool, args: { ...o.step.args } } } } : o)) : options;
  return { apply: /** @type {any} */ (apply), checks, passed, total, needsYou, options: offered, stopped, sentence };
}

// ------------------------------------------------------------------------------------------------- registry
/**
 * The Line tools for one project root.
 * @param {{root: string, ops?: typeof REAL_PLAN_OPS, afterSave?: (root: string, file: string) => unknown}} o
 * @returns The line.* tools, each with name, kind, schema, describe and run.
 */
export function lineTools({ root, ops = REAL_PLAN_OPS, afterSave }) {
  const run = {
    ...Object.fromEntries(Object.keys(CHANGE_TOOLS).map((tool) => [tool, async (a) => runChange(root, tool, a, ops, { pre: true })])),
    'line.leaveAsIs': async (a) => ({ left: a.stepId, sentence: 'Carried on; the step was left as it is.' }),
    'line.project': async () => ops.readLineProject(root),
  };
  // Owner decision (cu3): toolRegistry.mjs is Line's one tool catalog; these handlers register into @mx/plan's
  // registry (createLinePlanRegistry -> createPlanApi) only for tools the catalog lists, with the catalog's kind.
  return Object.keys(run).map((name) => ({
    name,
    kind: /** @type {'read'|'write'} */ (catalogEntry(name).kind),
    schema: SCHEMAS[name],
    describe: DESCRIBE[name],
    async run(args) {
      const r = await run[name](args);
      if (afterSave && r && r.apply?.ok) for (const f of r.apply.files) afterSave(root, f);
      return r;
    },
  }));
}

/**
 * ONE registry: the line.* tools plus Construct's commands (construct.*), as @mx/plan's runner sees it.
 * @param {{root: string, ops?: typeof REAL_PLAN_OPS, commands?: import('../../line-links/contracts').PlanRegistry | null,
 *   afterSave?: (root: string, file: string) => unknown}} o `commands` defaults to none; pass `await constructCommandTools()`.
 * @returns {import('../../line-links/contracts').PlanRegistry}
 */
export function createLinePlanRegistry({ root, ops = REAL_PLAN_OPS, commands = null, afterSave }) {
  // ci2: the Import steps (line.import.*) join the same registry, so Import executes only through plan steps.
  const own = [...lineTools({ root, ops, afterSave }), ...importTools({ root, ops, afterSave })];
  const byName = new Map(own.map((t) => [t.name, t]));
  return {
    list: () => [...own.map(({ name, kind, schema, describe }) => ({ name, kind, schema, describe })), ...(commands ? commands.list() : [])],
    async call(name, args) {
      const t = byName.get(name);
      if (!t) {
        if (commands && commands.list().some((c) => c.name === name)) return commands.call(name, args);
        throw new Error(`There is no tool named ${name}.`);
      }
      const parsed = t.schema.safeParse(args ?? {});
      if (!parsed.success) throw new Error(`${name} got arguments it cannot use: ${parsed.error.issues.map((i) => `${i.path.join('.') || 'args'} ${i.message}`).join('; ')}.`);
      return t.run(parsed.data);
    },
  };
}

/**
 * Construct's commands as plan tools (construct.validate, ...), loaded on demand (the CLI's registry is large).
 * @returns {Promise<any>} The construct.* plan registry.
 */
export async function constructCommandTools() {
  const [{ createCommandRegistry }, { registerBuiltinCommands }, { commandPlanRegistry }] = await Promise.all([
    import('@line/construct-core/command-registry'), import('@line/construct-core/builtin-commands'), import('@line/construct-core/plan-registry'),
  ]);
  const commands = createCommandRegistry();
  registerBuiltinCommands(commands);
  return commandPlanRegistry(/** @type {any} */ (commands));
}

/**
 * The tool's pre on the project as it is now: null when it holds (or the tool declares none), else one sentence.
 * @param {string} root @param {string} tool @param {Record<string, unknown>} args @param {typeof REAL_PLAN_OPS} [ops]
 * @returns {string|null}
 */
export function preRefusal(root, tool, args, ops = REAL_PLAN_OPS) {
  // A step planned in the import folder (an import or extract step) is checked against the folder's own facts.
  let at = root;
  try { at = rootOf(root, tool, args); } catch { at = root; }
  const facts = buildFacts(at, { ops });
  return checkPre(facts, tool, requestOf(args), facts.project()?.layout);
}

/**
 * Plan a change tool's step without writing (to word it and to refuse a bad request before it joins the plan).
 * @param {string} root The project root.
 * @param {string} tool The change tool.
 * @param {any} args The step's args.
 * @param {any} [ops] The Line ops (real by default).
 * @returns {import('./contract.mjs').StagedChange} Throws a LineOpError for a refusal.
 */
export function previewStep(root, tool, args, ops = REAL_PLAN_OPS) {
  if (!CHANGE_TOOLS[tool]) throw new LineOpError(`${tool} does not plan a change.`, 'NOT_A_CHANGE');
  return planWith(ops, root, tool, requestOf(args));
}
