// #759 (epic #395) -- the open-core primitive behind the Cockpit's Envelopes composer: a named,
// reusable sequence of PLAN_FLOWS steps, persisted inside the project so it travels with the repo
// and stays workspace-contained (#365). Reuses plan.mjs wholesale (PLAN_VERSION, validatePlan,
// planToCommand) rather than inventing a second step format -- a saved flow IS a plan whose
// `ticket` is synthetic, so every existing plan tool (materializeCommand, the process engine)
// already knows how to run one. The composer UI itself is Cockpit/proprietary; this file is not.
import fs from 'node:fs';
import path from 'node:path';
import { PLAN_VERSION, createPlan, validatePlan, formatPlanErrors } from './plan.mjs';
import { ensureDir, write } from './fs.mjs';

/** Where saved flows live inside a project: `<root>/.construct/flows/<name>.json`. Inside the
 * project root (not the external state dir traces use) so a flow is workspace-contained and
 * reviewable like any other file the Cockpit writes. */
export const FLOWS_DIR = path.join('.construct', 'flows');

const NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/;

/**
 * Is `name` a safe flow name? Alphanumeric (plus `. _ -`), 1-64 chars, no path separators or
 * `..` -- so a flow name can never escape `FLOWS_DIR` (#365 containment).
 *
 * @param {string} name
 * @returns {boolean}
 */
export function isValidFlowName(name) {
  return typeof name === 'string' && NAME_RE.test(name);
}

/**
 * The absolute path a flow named `name` would be saved to under `root`.
 *
 * @param {string} root Project root.
 * @param {string} name Flow name (already validated).
 * @returns {string}
 */
export function flowPath(root, name) {
  return path.join(root, FLOWS_DIR, `${name}.json`);
}

/**
 * Validate an ordered list of flow steps the same way a plan's `steps` are validated: each step
 * must name a real `PLAN_FLOWS` id and supply the args that flow requires. Delegates entirely to
 * `validatePlan()` (via a synthetic ticket) so there is exactly one place step/arg validation
 * lives.
 *
 * @param {object[]} steps `[{ id, title, flow, args, executor }, ...]`.
 * @returns {{valid: boolean, errors: {code:string, path:string, message:string}[]}}
 *
 * @example
 * validateFlowSteps([{ id: 's1', title: 'Total', flow: 'create.unit', args: { layer: 'domain', name: 'Total', feature: 'checkout' }, executor: 'deterministic' }]);
 * // => { valid: true, errors: [] }
 */
export function validateFlowSteps(steps) {
  const plan = createPlan({ source: 'text', title: 'saved flow' }, steps);
  return validatePlan(plan);
}

/**
 * Save an ordered list of flow steps under `name`, validating them first. Never writes a flow
 * that would fail `validateFlowSteps` -- there is no such thing as an invalid saved flow.
 *
 * @param {string} root Project root.
 * @param {string} name Flow name.
 * @param {object[]} steps See `validateFlowSteps`.
 * @returns {{ok: boolean, path?: string, errors?: string[]}}
 *
 * @example
 * saveFlow('/work/app', 'scaffold-checkout', steps); // => { ok: true, path: '/work/app/.construct/flows/scaffold-checkout.json' }
 */
export function saveFlow(root, name, steps) {
  if (!isValidFlowName(name)) {
    return { ok: false, errors: [`"${name}" is not a valid flow name (letters, digits, ".", "_", "-", 1-64 chars).`] };
  }
  const { valid, errors } = validateFlowSteps(steps);
  if (!valid) return { ok: false, errors: formatPlanErrors(errors) };

  const record = { version: PLAN_VERSION, name, steps, savedAt: new Date().toISOString() };
  const target = flowPath(root, name);
  write(target, `${JSON.stringify(record, null, 2)}\n`);
  return { ok: true, path: target };
}

/**
 * Load a previously saved flow.
 *
 * @param {string} root Project root.
 * @param {string} name Flow name.
 * @returns {{ok: boolean, steps?: object[], savedAt?: string, errors?: string[]}}
 *
 * @example
 * loadFlow('/work/app', 'scaffold-checkout'); // => { ok: true, steps: [...], savedAt: '...' }
 */
export function loadFlow(root, name) {
  if (!isValidFlowName(name)) {
    return { ok: false, errors: [`"${name}" is not a valid flow name (letters, digits, ".", "_", "-", 1-64 chars).`] };
  }
  const target = flowPath(root, name);
  if (!fs.existsSync(target)) {
    return { ok: false, errors: [`No saved flow named "${name}" (looked in ${path.join(FLOWS_DIR, `${name}.json`)}).`] };
  }
  let record;
  try {
    record = JSON.parse(fs.readFileSync(target, 'utf8'));
  } catch (e) {
    return { ok: false, errors: [`"${name}" is not valid JSON: ${e.message}`] };
  }
  const { valid, errors } = validateFlowSteps(record.steps);
  if (!valid) return { ok: false, errors: formatPlanErrors(errors) };
  return { ok: true, steps: record.steps, savedAt: record.savedAt };
}

/**
 * The names of every flow saved under `root`, alphabetical. Empty when nothing has been saved
 * yet (no directory, no error).
 *
 * @param {string} root Project root.
 * @returns {string[]}
 */
export function listFlows(root) {
  const dir = path.join(root, FLOWS_DIR);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.slice(0, -'.json'.length))
    .sort();
}

/**
 * Remove a saved flow. A no-op (not an error) when it does not exist.
 *
 * @param {string} root Project root.
 * @param {string} name Flow name.
 * @returns {{ok: boolean, errors?: string[]}}
 */
export function deleteFlow(root, name) {
  if (!isValidFlowName(name)) {
    return { ok: false, errors: [`"${name}" is not a valid flow name (letters, digits, ".", "_", "-", 1-64 chars).`] };
  }
  const target = flowPath(root, name);
  if (fs.existsSync(target)) fs.unlinkSync(target);
  return { ok: true };
}

/**
 * Map a flow's `create.unit` steps down to the `{layer, name}` pairs `packages/engine/pipeline.mjs`'s
 * `runPipeline()` consumes -- the same shape `construct pipeline run` reads off stdin. Other flow
 * steps (e.g. `create.feature`, `add.env`) are not generator-layer renders and are skipped: they
 * have no envelope-step equivalent. Order is preserved, so a saved flow and the same steps run
 * inline one at a time produce identical envelope steps.
 *
 * @param {object[]} steps Saved flow steps (`validateFlowSteps`-shaped).
 * @returns {{layer: string, name: string}[]}
 *
 * @example
 * flowToEnvelopeSteps([{ flow: 'create.unit', args: { layer: 'domain', name: 'Total', feature: 'checkout' } }]);
 * // => [{ layer: 'domain', name: 'Total' }]
 */
export function flowToEnvelopeSteps(steps) {
  return (steps || [])
    .filter((step) => step.flow === 'create.unit')
    .map((step) => ({ layer: step.args.layer, name: step.args.name }));
}
