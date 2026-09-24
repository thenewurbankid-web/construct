// #543 -- the uniform block contract: `{ id, writes, declaredScope, actions, run }`.
//
// The framework is a state machine the user navigates (epic #542): they pick WHAT they do, which invokes a block, and
// inside it they are offered only the few legal next actions for that state. This file is the shape every block has,
// so a screen, a plan step, the engine and (later) an MCP tool can all treat "a block" the same way.
//
//   id             stable dotted id (`create.unit`, `validate`, `process.lifecycle`).
//   writes         does it change project files? A block with `writes: false` is read-only and its scope is empty.
//   declaredScope  `(args, ctx) => { features, files } | null` -- the files/features the block may touch. It is EXACTLY
//                  a plan step's `touches` (plan.mjs), so it drops into a step unchanged. `null` means "a writing block
//                  whose files cannot be derived from its arguments alone"; the plan step must declare them, and the
//                  approval gate refuses anything outside them (approvalGate.mjs OUTSIDE_TOUCHES).
//   actions        `(state, ctx) => BlockAction[]` -- the legal next actions at `state`, DERIVED by `deriveActions()`
//                  from a rule table plus the state, never a hand-listed menu per screen.
//   run            `(scope, args, ctx) => { changedFiles }` -- deterministic execution. `runBlock()` checks the result.
//
// An action has a `kind`:
//   mechanical  a deterministic block runs;
//   ai          a model fills something in (output lands only as a reviewable diff);
//   free        an explicit, labelled exit to open-ended work (research text, Notes, "Edit code").
// `ai` and `free` actions must carry every guardrail in GUARDRAILS in `gates`; the validator rejects an action that
// leaves one out, so open-ended editing never becomes a way around containment, approval, the session gate or the
// deterministic checks. Decision record: docs/BLOCK-CONTRACT.md.
//
// Pure: no clock, no filesystem, no model. `runBlock` awaits whatever `run` does but adds nothing of its own.
import path from 'node:path';
import { validateTouches } from './plan.mjs';

/** The three kinds of action a block can offer. */
export const ACTION_KINDS = Object.freeze(['mechanical', 'ai', 'free']);

/**
 * The guardrails that never switch off, by the name each has in the code:
 * `containment` (paths stay inside the project root), `approval` (per-diff approval, approvalGate.mjs), `sessionGate`
 * (the Cockpit server's session check in front of every route) and `checks` (deterministic validation of the staged
 * tree before AI or free output lands).
 */
export const GUARDRAILS = Object.freeze(['containment', 'approval', 'sessionGate', 'checks']);

/** Every rejection the contract validator can produce, by name, so callers and tests match on a code, not on text. */
export const BLOCK_ERROR_CODES = Object.freeze({
  BLOCK_NOT_OBJECT: 'BLOCK_NOT_OBJECT',
  BLOCK_ID_INVALID: 'BLOCK_ID_INVALID',
  BLOCK_WRITES_INVALID: 'BLOCK_WRITES_INVALID',
  BLOCK_FIELD_NOT_FUNCTION: 'BLOCK_FIELD_NOT_FUNCTION',
  BLOCK_SCOPE_INVALID: 'BLOCK_SCOPE_INVALID',
  BLOCK_SCOPE_NOT_EMPTY: 'BLOCK_SCOPE_NOT_EMPTY',
  BLOCK_SCOPE_NULL: 'BLOCK_SCOPE_NULL',
  BLOCK_ACTIONS_INVALID: 'BLOCK_ACTIONS_INVALID',
  ACTION_NOT_OBJECT: 'ACTION_NOT_OBJECT',
  ACTION_ID_INVALID: 'ACTION_ID_INVALID',
  ACTION_ID_DUPLICATE: 'ACTION_ID_DUPLICATE',
  ACTION_KIND_INVALID: 'ACTION_KIND_INVALID',
  ACTION_LABEL_INVALID: 'ACTION_LABEL_INVALID',
  ACTION_FIELD_INVALID: 'ACTION_FIELD_INVALID',
  ACTION_WHY_MISSING: 'ACTION_WHY_MISSING',
  ACTION_GATES_MISSING: 'ACTION_GATES_MISSING',
  RUN_RESULT_INVALID: 'RUN_RESULT_INVALID',
  RUN_READONLY_WROTE: 'RUN_READONLY_WROTE',
});

/**
 * @typedef {{ features?: string[], files?: { path: string, change: 'create'|'modify'|'delete'|'move'|'read', layer?: string, why?: string }[] }} DeclaredScope
 * A block's declared scope; the same shape as a plan step's `touches` (packages/core/plan.mjs).
 *
 * @typedef {{ id: string, kind: 'mechanical'|'ai'|'free', label: string, enabled: boolean, why?: string, requires?: string[], blockId?: string, gates?: string[] }} BlockAction
 * One legal next action. `enabled: false` is an action shown disabled, with `why` (the rule that forbids it here);
 * `blockId` names the block it hands over to; `gates` lists the guardrails an `ai` or `free` action passes through.
 *
 * @typedef {{ id: string, writes: boolean, declaredScope: (args: any, ctx?: any) => DeclaredScope | null, actions: (state: any, ctx?: any) => BlockAction[], run: (scope: DeclaredScope | null, args: any, ctx?: any) => { changedFiles: string[] } | Promise<{ changedFiles: string[] }>, label?: string, summary?: string, meta?: object }} Block
 * The uniform block contract.
 *
 * @typedef {{ id: string, kind: 'mechanical'|'ai'|'free', label: string, requires?: string[], blockId?: string, applies?: (state: any) => boolean, blockedBy?: (state: any) => string | null | undefined }} ActionRule
 * One row of an action rule table. `applies` decides whether the action is offered at all in this state (default: yes);
 * `blockedBy` returns the reason it is offered but disabled, or a falsy value when it is available.
 */

const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const isNonEmptyString = (v) => typeof v === 'string' && v.length > 0;
/** The shape of a dotted block id (`create.unit`, `process.lifecycle`); choosers reuse it. */
export const BLOCK_ID_RE = /^[A-Za-z][A-Za-z0-9_-]*(\.[A-Za-z0-9_-]+)*$/;
const isAbsolutePath = (p) => path.isAbsolute(p) || /^[A-Za-z]:[\\/]/.test(p);

/**
 * The scope of a read-only block: no features, no files.
 *
 * @returns {DeclaredScope} A fresh empty scope, `{ features: [], files: [] }`.
 *
 * @example
 * emptyScope(); // => { features: [], files: [] }
 */
export function emptyScope() {
  return { features: [], files: [] };
}

/**
 * True when a scope names nothing at all (what a read-only block declares).
 *
 * @param {DeclaredScope | null | undefined} scope A declared scope.
 * @returns {boolean} `true` for an object with no features and no files; `false` for `null` (an unknown scope is not an empty one).
 *
 * @example
 * isEmptyScope({ features: [], files: [] }); // => true
 */
export function isEmptyScope(scope) {
  return isPlainObject(scope) && !(scope.features?.length) && !(scope.files?.length);
}

/**
 * Validate a declared scope with the plan validator's own `touches` rules (unknown keys, relative paths, known change
 * kinds), so a scope that passes here is accepted as a step's `touches` by `validatePlan`.
 *
 * @param {any} scope The value to check.
 * @param {string} [at] Path prefix for error paths.
 * @returns {{ valid: boolean, errors: { code: string, path: string, message: string }[] }} Every problem found; never throws.
 *
 * @example
 * validateScope({ features: ['cart'], files: [{ path: 'features/cart/types.ts', change: 'create' }] }).valid; // => true
 */
export function validateScope(scope, at = 'scope') {
  const errors = [];
  validateTouches(scope, at, (code, where, message) => errors.push({ code: BLOCK_ERROR_CODES.BLOCK_SCOPE_INVALID, path: where, message: `${message} (${code})` }));
  return { valid: errors.length === 0, errors };
}

/**
 * Validate one action. An `ai` or `free` action must list every guardrail in `gates`, and a disabled action must say why.
 *
 * @param {any} action The action to check.
 * @param {string} [at] Path prefix for error paths.
 * @returns {{ valid: boolean, errors: { code: string, path: string, message: string }[] }} Every problem found; never throws.
 *
 * @example
 * validateAction({ id: 'run', kind: 'mechanical', label: 'Run', enabled: true }).valid; // => true
 */
export function validateAction(action, at = 'action') {
  const errors = [];
  const push = (code, where, message) => errors.push({ code: BLOCK_ERROR_CODES[code], path: where, message });
  if (!isPlainObject(action)) {
    push('ACTION_NOT_OBJECT', at, 'An action must be an object.');
    return { valid: false, errors };
  }
  if (!isNonEmptyString(action.id)) push('ACTION_ID_INVALID', `${at}.id`, '"id" must be a non-empty string.');
  if (!ACTION_KINDS.includes(action.kind)) push('ACTION_KIND_INVALID', `${at}.kind`, `"kind" must be one of: ${ACTION_KINDS.join(', ')} (got ${JSON.stringify(action.kind)}).`);
  if (!isNonEmptyString(action.label)) push('ACTION_LABEL_INVALID', `${at}.label`, '"label" must be a non-empty string; it is what a person reads.');
  if (typeof action.enabled !== 'boolean') push('ACTION_FIELD_INVALID', `${at}.enabled`, '"enabled" must be a boolean.');
  if (action.enabled === false && !isNonEmptyString(action.why)) push('ACTION_WHY_MISSING', `${at}.why`, 'A disabled action must say why (the rule that forbids it in this state).');
  if ('requires' in action && !(Array.isArray(action.requires) && action.requires.every(isNonEmptyString))) push('ACTION_FIELD_INVALID', `${at}.requires`, '"requires" must be an array of non-empty strings.');
  if ('blockId' in action && !isNonEmptyString(action.blockId)) push('ACTION_FIELD_INVALID', `${at}.blockId`, '"blockId" must be a non-empty string.');
  if ((action.kind === 'ai' || action.kind === 'free')) {
    const gates = Array.isArray(action.gates) ? action.gates : [];
    const missing = GUARDRAILS.filter((g) => !gates.includes(g));
    if (missing.length) push('ACTION_GATES_MISSING', `${at}.gates`, `An "${action.kind}" action must pass every guardrail; missing: ${missing.join(', ')}.`);
  }
  return { valid: errors.length === 0, errors };
}

/**
 * Validate a list of actions: each one, plus unique ids.
 *
 * @param {any} actions The value `block.actions(state)` returned.
 * @param {string} [at] Path prefix for error paths.
 * @returns {{ valid: boolean, errors: { code: string, path: string, message: string }[] }} Every problem found; never throws.
 *
 * @example
 * validateActions([{ id: 'run', kind: 'mechanical', label: 'Run', enabled: true }]).valid; // => true
 */
export function validateActions(actions, at = 'actions') {
  if (!Array.isArray(actions)) return { valid: false, errors: [{ code: BLOCK_ERROR_CODES.BLOCK_ACTIONS_INVALID, path: at, message: 'actions must be an array.' }] };
  const errors = [];
  const seen = new Set();
  actions.forEach((action, i) => {
    errors.push(...validateAction(action, `${at}[${i}]`).errors);
    if (isPlainObject(action) && isNonEmptyString(action.id)) {
      if (seen.has(action.id)) errors.push({ code: BLOCK_ERROR_CODES.ACTION_ID_DUPLICATE, path: `${at}[${i}].id`, message: `Duplicate action id "${action.id}".` });
      seen.add(action.id);
    }
  });
  return { valid: errors.length === 0, errors };
}

/**
 * Turn a rule table and a state into the legal next actions -- the only way a block's menu is produced. A rule whose
 * `applies(state)` is false is not offered; one whose `blockedBy(state)` returns a reason is offered disabled with that
 * reason as `why`; `ai` and `free` actions are stamped with every guardrail in `gates`. Pure and order-preserving.
 *
 * @param {ActionRule[]} rules The block's rule table.
 * @param {any} [state] Whatever state the rules read (a process state, a step, a plan, ...).
 * @returns {BlockAction[]} The actions, in rule order.
 *
 * @example
 * deriveActions([{ id: 'run', kind: 'mechanical', label: 'Run', blockedBy: (s) => (s.ok ? null : 'Fix the arguments first.') }], { ok: false });
 * // => [{ id: 'run', kind: 'mechanical', label: 'Run', enabled: false, why: 'Fix the arguments first.' }]
 */
export function deriveActions(rules, state = {}) {
  const out = [];
  for (const rule of rules || []) {
    if (typeof rule.applies === 'function' && !rule.applies(state)) continue;
    const reason = typeof rule.blockedBy === 'function' ? rule.blockedBy(state) : null;
    const action = { id: rule.id, kind: rule.kind, label: rule.label, enabled: !reason };
    if (reason) action.why = String(reason);
    if (rule.requires?.length) action.requires = [...rule.requires];
    if (rule.blockId) action.blockId = rule.blockId;
    if (rule.kind === 'ai' || rule.kind === 'free') action.gates = [...GUARDRAILS];
    out.push(action);
  }
  return out;
}

/**
 * Validate a block's static shape: id, `writes`, the three functions. With `options.state`, also calls
 * `block.actions(state)` and validates what comes back (unique ids, kinds, disabled-with-why, guardrails on ai/free).
 * With `options.args`, also calls `declaredScope(args)` and checks it: valid `touches` shape, empty for a read-only
 * block, never `null` for one.
 *
 * @param {any} block The candidate block.
 * @param {{ state?: any, args?: any, ctx?: any }} [options] Optional state/args to exercise `actions` and `declaredScope` with.
 * @returns {{ valid: boolean, errors: { code: string, path: string, message: string }[] }} Every problem found; never throws (a throwing function is reported).
 *
 * @example
 * validateBlock(block, { state: { processState: 'queued' } }).errors;
 */
export function validateBlock(block, options = {}) {
  const errors = [];
  const push = (code, where, message) => errors.push({ code: BLOCK_ERROR_CODES[code], path: where, message });
  if (!isPlainObject(block)) {
    push('BLOCK_NOT_OBJECT', '', 'A block must be an object { id, writes, declaredScope, actions, run }.');
    return { valid: false, errors };
  }
  if (!isNonEmptyString(block.id) || !BLOCK_ID_RE.test(block.id)) push('BLOCK_ID_INVALID', 'id', '"id" must be a dotted identifier such as create.unit.');
  if (typeof block.writes !== 'boolean') push('BLOCK_WRITES_INVALID', 'writes', '"writes" must be a boolean: does the block change project files?');
  for (const key of ['declaredScope', 'actions', 'run']) {
    if (typeof block[key] !== 'function') push('BLOCK_FIELD_NOT_FUNCTION', key, `"${key}" must be a function.`);
  }
  if (errors.length) return { valid: false, errors };

  const attempt = (label, fn) => {
    try {
      return { value: fn() };
    } catch (e) {
      push(label === 'actions' ? 'BLOCK_ACTIONS_INVALID' : 'BLOCK_SCOPE_INVALID', label, `${label}() threw: ${e?.message ?? e}`);
      return null;
    }
  };
  if ('state' in options) {
    const got = attempt('actions', () => block.actions(options.state, options.ctx));
    if (got) errors.push(...validateActions(got.value, 'actions').errors);
  }
  if ('args' in options) {
    const got = attempt('declaredScope', () => block.declaredScope(options.args, options.ctx));
    if (got) errors.push(...checkScopeFor(block, got.value));
  }
  return { valid: errors.length === 0, errors };
}

function checkScopeFor(block, scope) {
  const errors = [];
  if (scope === null) {
    if (!block.writes) errors.push({ code: BLOCK_ERROR_CODES.BLOCK_SCOPE_NULL, path: 'declaredScope', message: `Read-only block "${block.id}" must declare an empty scope, not null.` });
    return errors;
  }
  const shaped = validateScope(scope, 'declaredScope');
  errors.push(...shaped.errors);
  if (shaped.valid && !block.writes && !isEmptyScope(scope)) {
    errors.push({ code: BLOCK_ERROR_CODES.BLOCK_SCOPE_NOT_EMPTY, path: 'declaredScope', message: `Read-only block "${block.id}" declared a scope; a block that writes nothing declares none.` });
  }
  return errors;
}

/**
 * Build a block: validate the spec, freeze it and return it. The only constructor, so a malformed block fails where it
 * is defined rather than where a screen first tries to read its menu.
 *
 * @param {Block} spec `{ id, writes, declaredScope, actions, run }` plus optional `label`, `summary`, `meta`.
 * @returns {Block} The frozen block.
 * @throws {TypeError} Listing every problem, when the spec does not satisfy the contract.
 *
 * @example
 * const block = defineBlock({ id: 'validate', writes: false, declaredScope: () => emptyScope(), actions: () => [], run: () => ({ changedFiles: [] }) });
 */
export function defineBlock(spec) {
  const { valid, errors } = validateBlock(spec);
  if (!valid) throw new TypeError(`Invalid block${isPlainObject(spec) && spec.id ? ` "${spec.id}"` : ''}: ${errors.map((e) => `${e.code}${e.path ? ` at ${e.path}` : ''}: ${e.message}`).join(' ')}`);
  return Object.freeze({ ...spec });
}

/**
 * Run a block through the contract: derive its scope from `args`, call `run(scope, args, ctx)`, and check the result is
 * `{ changedFiles: string[] }` of project-relative paths (a read-only block that reports a changed file is refused).
 * The changed files come back sorted and de-duplicated, so the same run yields the same list.
 *
 * @param {Block} block A block from `defineBlock`.
 * @param {any} [args] The arguments (a plan step's `args`).
 * @param {any} [ctx] Caller context passed to `declaredScope` and `run` (e.g. `{ root, exec }`).
 * @returns {Promise<{ scope: DeclaredScope | null, changedFiles: string[] }>} The scope the block declared and the files it reports changed.
 * @throws {TypeError} With a `code` from BLOCK_ERROR_CODES when the result breaks the contract.
 *
 * @example
 * const { scope, changedFiles } = await runBlock(block, { name: 'cart' }, { root });
 */
export async function runBlock(block, args = {}, ctx = {}) {
  const fail = (code, message) => Object.assign(new TypeError(`${block?.id}: ${message}`), { code: BLOCK_ERROR_CODES[code] });
  const scope = block.declaredScope(args, ctx);
  const result = await block.run(scope, args, ctx);
  if (!isPlainObject(result) || !Array.isArray(result.changedFiles) || !result.changedFiles.every((f) => isNonEmptyString(f) && !isAbsolutePath(f))) {
    throw fail('RUN_RESULT_INVALID', 'run() must return { changedFiles: string[] } of project-relative paths.');
  }
  const changedFiles = [...new Set(result.changedFiles)].sort();
  if (!block.writes && changedFiles.length) throw fail('RUN_READONLY_WROTE', `a read-only block reported changed files: ${changedFiles.join(', ')}.`);
  return { scope, changedFiles };
}
