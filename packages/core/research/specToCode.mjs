// #593 (R2, part of #576) -- turn an ACCEPTED machine-spec.v1 (packages/core/research/machine-spec.mjs
// already refused anything else) into real, deterministic code: an XState workflow (with the typed
// state union, #580) and one typed-contracts function stub per `functions[]` entry. No LLM, and
// nothing here re-checks the spec's own shape or meaning -- that is machine-spec.mjs's job, run
// first by the CLI (packages/core/cli.mjs's researchSpec) before this module is ever called.
//
// Mapping from the spec onto what already exists (from the R1 report on #593):
//   - `initial` is the state with `initial: true`; `states[id] = { type: final ? 'final' : undefined,
//     on: {...} }`, transitions grouped by (from, event), guarded entries ordered before the
//     unguarded fallback (SPEC-006 already guarantees no two transitions share from/event/guard, so
//     this grouping is never ambiguous) -- handed straight to `workflowGenerator.mjs`'s
//     `generateWorkflow` with `{ stateUnion: true }`.
//   - Each transition's `guard` name becomes a `descriptor.guards` entry (#593's addition to
//     `compileWorkflow`, see workflowGenerator.mjs): a stub in `setup()` that returns `false` with a
//     `// TODO:` comment naming the req sentence(s) that transition exists to satisfy.
//   - Each `functions[]` entry becomes a `defineService(...)` stub (packages/core/typed-contracts/
//     factories.ts) under the feature's `services/` folder: the v1 schema has no per-function layer
//     field, so every function lands in the service layer -- documented in docs/machine-spec.md, not
//     a schema change. Its `input`/`output` (free-form TS type strings) are parsed and re-printed via
//     `workflowGenerator.mjs`'s own `parseTypeString` (the same "hand-authored type string prints back
//     out as real TS" step the workflow's context fields already use), and its precondition/
//     postcondition plus the req sentence text land as comments directly above the stub, which throws
//     rather than returning a fabricated value.
//   - `spec.feature` is optional; `--feature` (the CLI flag) is the fallback, and generation refuses
//     (before writing anything) when neither is given.
//
// Event `payload` typing (spec.events[].payload -> the generated event union) is explicitly NOT done
// here yet -- workflowGenerator.mjs's event union stays `{ type: 'EVENT' }` only, as today; see
// docs/machine-spec.md's "Known gaps" for the follow-up.
//
// Never overwrites an existing file (same policy as #497's scaffold.mjs): a target that already
// exists is left untouched and reported as skipped, so a second run of the same spec against the
// same project is a no-op.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateWorkflow, parseTypeString } from '../../engine/workflowGenerator.mjs';
import { printNode as print } from '../../ast/index.mjs';
import { loadConfig } from '../config.mjs';
import { write, rel } from '../fs.mjs';
import { createFeature, pascalCase, selfCheck } from '../generators.mjs';
import { ConstructError, EXIT_CODES } from '../diagnostics.mjs';

function usageError(message) {
  return new ConstructError(message, { exitCode: EXIT_CODES.USAGE_ERROR });
}

// The vendored typed-contracts mechanism ships alongside this file (packages/core/typed-contracts/)
// whether Construct runs from this monorepo checkout or as an installed package -- same reasoning,
// and the same fixed on-disk offset, as packages/core/extractExpression.mjs's own
// TYPED_CONTRACTS_INDEX (a bare `@construct/typed-contracts` package specifier would need a publish
// this repo does not do yet; a relative import computed from where THIS module itself loaded from
// always resolves).
const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));
const TYPED_CONTRACTS_INDEX = path.join(THIS_DIR, '..', 'typed-contracts', 'index.ts');

/** Strip the extension and normalize to posix separators, keeping the typed-contracts sources'
 * explicit `.ts` (mirrors extractExpression.mjs's own `relativeSpecifier`, duplicated rather than
 * imported since that module does not export it -- same call as this repo's own test files, which
 * each carry their own copy of the small `tsc()` helper rather than share one). */
function typedContractsSpecifier(fromDir) {
  const relPath = path.relative(fromDir, TYPED_CONTRACTS_INDEX).split(path.sep).join('/');
  return relPath.startsWith('.') ? relPath : `./${relPath}`;
}

const oneLine = (text) => String(text ?? '').replace(/\s+/g, ' ').trim();

/**
 * Group a machine-spec.v1's `transitions[]` by `(from, event)`, guarded entries ordered before the
 * unguarded fallback so XState tries them first. Pure.
 *
 * @param {object[]} transitions `spec.transitions` (already SPEC-006-clean: no two share from/event/guard).
 * @returns {Map<string, {from: string, event: string, items: object[]}>} Keyed by `"from\u0000event"`, insertion-ordered.
 */
function groupTransitions(transitions) {
  const groups = new Map();
  for (const t of transitions) {
    const key = `${t.from}\u0000${t.event}`;
    if (!groups.has(key)) groups.set(key, { from: t.from, event: t.event, items: [] });
    groups.get(key).items.push(t);
  }
  for (const g of groups.values()) g.items.sort((a, b) => Number(!a.guard) - Number(!b.guard));
  return groups;
}

/**
 * Build the JSON state-graph descriptor `workflowGenerator.mjs`'s `generateWorkflow` expects, from
 * an accepted machine-spec.v1. Pure -- no filesystem access, no re-validation (the spec must already
 * have passed `validateMachineSpec`).
 *
 * @param {object} spec A machine-spec.v1 object that passed `validateMachineSpec`.
 * @returns {{initial: string, states: object, guards: object}} `initial`/`states` in `generateWorkflow`'s own shape; `guards` maps each guard name to its TODO note (the req sentence text(s) of every transition that names it).
 *
 * @example
 * const descriptor = buildWorkflowDescriptor(spec);
 * generateWorkflow(root, name, feature, descriptor, { stateUnion: true });
 */
export function buildWorkflowDescriptor(spec) {
  const states = {};
  for (const s of spec.states) states[s.id] = s.final ? { type: 'final' } : {};
  for (const { from, event, items } of groupTransitions(spec.transitions).values()) {
    const on = states[from].on ?? (states[from].on = {});
    on[event] = items.length === 1
      ? (items[0].guard ? { target: items[0].to, guard: items[0].guard } : items[0].to)
      : items.map((t) => (t.guard ? { target: t.to, guard: t.guard } : { target: t.to }));
  }

  const sentenceText = new Map(spec.requirement.map((s) => [s.id, s.text]));
  const guardReqIds = new Map();
  for (const t of spec.transitions) {
    if (!t.guard) continue;
    const ids = guardReqIds.get(t.guard) ?? guardReqIds.set(t.guard, new Set()).get(t.guard);
    for (const id of t.req) ids.add(id);
  }
  const guards = {};
  for (const [name, ids] of guardReqIds) guards[name] = [...ids].map((id) => sentenceText.get(id)).filter(Boolean).join(' ');

  return { initial: spec.states.find((s) => s.initial).id, states, guards };
}

/** A machine-spec.v1 `name` ("sign-in with retry") turned into a legal, PascalCase TS identifier
 * base ("SignInWithRetry") -- `pascalCase` (generators.mjs) only treats `-`/`_` as word boundaries,
 * so whitespace is folded to `-` first. */
function workflowBaseName(specName) {
  return specName.trim().replace(/\s+/g, '-');
}

/** Re-print a spec's free-form TS type string via `parseTypeString`, wrapping its parse error with
 * which function/field it came from -- `validateMachineSpec`'s SPEC-008 only guarantees the string
 * is non-empty, not that it parses as a TS type, so a genuinely malformed one still needs a clear,
 * actionable message here rather than a bare compiler-API exception. */
function reprintType(raw, fnName, label) {
  try {
    return print(parseTypeString(raw));
  } catch (e) {
    throw usageError(`Function "${fnName}"'s ${label} type is not valid TypeScript: ${JSON.stringify(raw)} (${e.message})`);
  }
}

/** The req sentence ids a function/transition claims, rendered as `s1 ("text"), s2 ("text")` for a
 * stub's leading comment. */
function reqLine(spec, reqIds) {
  const sentenceText = new Map(spec.requirement.map((s) => [s.id, s.text]));
  return reqIds.map((id) => `${id} (${JSON.stringify(sentenceText.get(id) ?? '')})`).join(', ');
}

/**
 * The full TypeScript source of one `functions[]` entry's stub: a `defineService(...)` unit (the v1
 * schema has no per-function layer, so every function lands in the service layer, see
 * docs/machine-spec.md) whose body throws rather than returning a fabricated value, with its
 * precondition/postcondition and req sentence text as comments directly above it. Pure.
 *
 * @param {object} spec The machine-spec.v1 (for its `requirement[]`, to resolve `fn.req` to sentence text).
 * @param {object} fn One `spec.functions[]` entry (`name`, `input`, `output`, `precondition`, `postcondition`, `req`).
 * @param {string} fileDir The absolute directory the stub will be written into (its import specifier is relative to this).
 * @returns {string} The stub file's full source text.
 */
export function functionStubSource(spec, fn, fileDir) {
  const inputType = reprintType(fn.input, fn.name, 'input');
  const outputType = reprintType(fn.output, fn.name, 'output');
  const specifier = typedContractsSpecifier(fileDir);
  return [
    `import { defineService } from ${JSON.stringify(specifier)};`,
    '',
    '// Generated by `construct research spec --generate` (#593) from a machine-spec.v1 function entry.',
    `// Precondition: ${oneLine(fn.precondition)}`,
    `// Postcondition: ${oneLine(fn.postcondition)}`,
    `// req: ${reqLine(spec, fn.req)}`,
    `export const ${fn.name} = defineService(${JSON.stringify(fn.name)}, (props: ${inputType}): ${outputType} => {`,
    `  throw new Error(${JSON.stringify(`Not implemented: ${fn.name} (see the precondition/postcondition comment above).`)});`,
    '});',
    '',
  ].join('\n');
}

/**
 * Generate the workflow (with the typed state union and named guard stubs) and one function stub
 * per `functions[]` entry from an ACCEPTED machine-spec.v1 -- the caller must have already run
 * `validateMachineSpec` and refused anything that failed. Never overwrites an existing file (same
 * policy as #497's `scaffoldProject`): a target that already exists is left untouched and reported
 * under `skipped`, so a second call with the same spec against the same project writes nothing new.
 *
 * @param {string} root Project root.
 * @param {object} spec A machine-spec.v1 object that passed `validateMachineSpec`.
 * @param {{feature?: string}} [options] `feature` is used only when `spec.feature` is absent.
 * @returns {{feature: string, written: string[], skipped: string[], workflow: {file: string, stateFile?: string, events: string[]}|null, functions: string[]}} Project-relative paths, and which functions actually got a fresh stub (as opposed to being skipped).
 * @throws {ConstructError} Usage error (exit code 2) when neither `spec.feature` nor `options.feature` is given, or when a function's input/output type string is not valid TypeScript.
 *
 * @example
 * const result = generateFromSpec(root, spec, { feature: 'auth' });
 * console.log(result.written, result.skipped);
 */
export function generateFromSpec(root, spec, { feature: featureArg } = {}) {
  const feature = spec.feature ?? featureArg;
  if (!feature) {
    throw usageError('No feature given: the spec has no "feature" field and --feature was not passed. Usage: construct research spec <file> --generate --feature <name>');
  }

  const config = loadConfig(root);
  const featureDir = path.join(root, config.features?.root || 'features', feature);
  const written = [];
  const skipped = [];

  // SLICE-001 (soc-enforcer.mjs) requires a feature to expose its full, predictable set of layer
  // folders once ANY of them exists -- a feature this command is the first to touch needs the same
  // scaffold `construct feature create` would give it, or `construct validate` fails on a
  // generated-but-incomplete slice. `createFeature` itself unconditionally overwrites types.ts/
  // index.ts, so it only runs when the feature does not exist yet (an existing feature's own files
  // are never touched here).
  if (!fs.existsSync(featureDir)) {
    createFeature(root, feature);
    written.push(rel(root, path.join(featureDir, 'types.ts')), rel(root, path.join(featureDir, 'index.ts')));
  }

  // ---- workflow (+ typed state union, + named guard stubs) --------------
  const workflowName = pascalCase(workflowBaseName(spec.name), 'Workflow');
  const workflowFile = path.join(featureDir, 'workflows', `${workflowName}Workflow.tsx`);
  const stateFile = path.join(featureDir, 'workflows', `${workflowName}WorkflowState.ts`);
  let workflow = null;
  if (fs.existsSync(workflowFile) || fs.existsSync(stateFile)) {
    for (const f of [workflowFile, stateFile]) if (fs.existsSync(f)) skipped.push(rel(root, f));
  } else {
    const descriptor = buildWorkflowDescriptor(spec);
    const result = generateWorkflow(root, workflowName, feature, descriptor, { stateUnion: true });
    workflow = { file: rel(root, result.file), events: result.events, ...(result.stateFile ? { stateFile: rel(root, result.stateFile) } : {}) };
    written.push(workflow.file);
    if (workflow.stateFile) written.push(workflow.stateFile);
  }

  // ---- one defineService(...) stub per function --------------------------
  const servicesDir = path.join(featureDir, 'services');
  const functionsWritten = [];
  const functionFiles = [];
  for (const fn of spec.functions) {
    const file = path.join(servicesDir, `${fn.name}.ts`);
    if (fs.existsSync(file)) { skipped.push(rel(root, file)); continue; }
    write(file, functionStubSource(spec, fn, servicesDir));
    written.push(rel(root, file));
    functionsWritten.push(fn.name);
    functionFiles.push(file);
  }
  if (functionFiles.length) selfCheck(root, functionFiles);

  return { feature, written, skipped, workflow, functions: functionsWritten };
}
