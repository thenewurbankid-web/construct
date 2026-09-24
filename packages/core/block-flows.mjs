// #543 -- PLAN_FLOWS seen through the block contract (block-contract.mjs), by DERIVING a block from each flow entry rather
// than rewriting the registry: PLAN_FLOWS, validatePlan and planToCommand are untouched, so a plan means exactly what it
// meant before. `flowBlock('create.unit')` is a contract block whose
//   writes         is the flow's `writes`;
//   declaredScope  is `{ features, files }` for the flows plan-touches.mjs derives exactly (create.feature/unit/layer),
//                  the empty scope for a read-only flow, and `null` for any other writing flow (the plan step's own
//                  `touches` must declare it; nothing is guessed);
//   actions        are DERIVED from state + the flow's own rules (executors, argument validity, scope known) by
//                  `deriveActions`, never listed per screen;
//   run            hands the flow's real command (`planToCommand`) to a caller-supplied `ctx.exec`, exactly as the process
//                  engine's `executeStep` does, and reports the files that changed on disk.
// `processLifecycleBlock` does the same for the process state machine: its actions are `allowedEvents(state)`.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { PLAN_FLOWS, planFlow, validatePlan } from './plan.mjs';
import { expectedFiles, DERIVED_FLOWS } from './plan-touches.mjs';
import { defineBlock, deriveActions, emptyScope } from './block-contract.mjs';
import { materializeCommand } from '../engine/processEngine.mjs';
import { allowedEvents, PROCESS_EVENTS } from '../engine/processMachine.mjs';

/** How a flow's scope is known: `empty` (read-only), `derived` (plan-touches.mjs computes the files) or `declared` (the plan step must say). */
export const SCOPE_KINDS = Object.freeze(['empty', 'derived', 'declared']);

/**
 * Classify a flow by how its declared scope is known.
 *
 * @param {string} flowId A key of PLAN_FLOWS.
 * @returns {'empty'|'derived'|'declared'} `empty` for a read-only flow, `derived` when plan-touches derives its files, else `declared`.
 * @throws {TypeError} For an unknown flow.
 *
 * @example
 * flowScopeKind('create.unit'); // => 'derived'
 */
export function flowScopeKind(flowId) {
  const flow = planFlow(flowId);
  if (!flow) throw new TypeError(`Unknown flow "${flowId}".`);
  if (!flow.writes) return 'empty';
  return DERIVED_FLOWS.includes(flowId) ? 'derived' : 'declared';
}

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const featureOf = (flowId, args) => (flowId === 'create.feature' ? args.name : args.feature);

function scopeOf(flowId, args, ctx) {
  const kind = flowScopeKind(flowId);
  if (kind === 'empty') return emptyScope();
  if (kind === 'declared' || !ctx?.root) return null;
  const files = expectedFiles(ctx.root, flowId, isObj(args) ? args : {});
  if (!files) return null;
  const feature = featureOf(flowId, args);
  return { features: typeof feature === 'string' && feature ? [feature] : [], files };
}

/** First reason `args` is not runnable by `executor`, from validatePlan itself (so the menu and the validator cannot disagree), or null. */
function argProblem(flowId, args, executor, touches) {
  const flow = planFlow(flowId);
  const step = { id: 's1', title: flowId, flow: flowId, args: isObj(args) ? args : {}, executor };
  if (flow.writes) step.touches = touches ?? emptyScope(); // declaring scope is the gate's job; this asks about the arguments
  const { errors } = validatePlan({ version: 1, ticket: { source: 'text', title: flowId }, steps: [step] });
  return errors.length ? errors[0].message : null;
}

function actionRules(flowId) {
  const flow = planFlow(flowId);
  const has = (executor) => flow.executors.includes(executor);
  const scopeUnknown = (state) => {
    if (!flow.writes) return null;
    const scope = scopeOf(flowId, state.args ?? {}, { root: state.root });
    if (scope) return null;
    return flowScopeKind(flowId) === 'derived'
      ? argProblem(flowId, state.args, 'deterministic', state.touches) || 'The files it would write cannot be worked out from these arguments yet.'
      : (state.touches?.files?.length ? null : 'Its files are not known until the plan step declares what it touches.');
  };
  return [
    { id: 'run', kind: 'mechanical', label: 'Run', blockId: flowId, applies: () => has('deterministic'), blockedBy: (s) => argProblem(flowId, s.args, 'deterministic', s.touches) },
    { id: 'fill-with-ai', kind: 'ai', label: 'Fill with AI', blockId: flowId, applies: () => has('local-model'), blockedBy: (s) => argProblem(flowId, s.args, 'local-model', s.touches) },
    { id: 'view-code', kind: 'mechanical', label: 'View code', requires: ['scope'], applies: () => flow.writes && flow.cli !== null },
    { id: 'edit-code', kind: 'free', label: 'Edit code', requires: ['scope'], applies: () => flow.writes && flow.cli !== null, blockedBy: scopeUnknown },
    { id: 'do-by-hand', kind: 'free', label: 'Do it by hand', applies: () => has('user'), blockedBy: (s) => argProblem(flowId, s.args, 'user', s.touches) },
  ];
}

const TREE_SKIP = new Set(['.git', 'node_modules']);

/** `{ 'rel/path': sha1 }` of every regular file under `root` (skipping .git and node_modules). Read-only. */
function snapshot(root) {
  const out = {};
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (TREE_SKIP.has(entry.name)) continue;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(abs);
      else if (entry.isFile()) out[path.relative(root, abs).split(path.sep).join('/')] = crypto.createHash('sha1').update(fs.readFileSync(abs)).digest('hex');
    }
  };
  walk(root);
  return out;
}

const tag = (message, code) => Object.assign(new TypeError(message), { code });

/**
 * The contract block derived from one PLAN_FLOWS entry. `run(scope, args, ctx)` needs `ctx.root` (project root) and
 * `ctx.exec({ argv, stdin, cwd, step })` (the caller's executor, sync or async, the same seam as the process engine's
 * `executeStep`); it reports the files whose content changed between a before and an after snapshot of the project, so
 * the answer does not depend on the executor's honesty. `ctx.executor` picks the step's executor tag (default
 * `deterministic`).
 *
 * @param {string} flowId A key of PLAN_FLOWS.
 * @returns {import('./block-contract.mjs').Block} A frozen block.
 * @throws {TypeError} For an unknown flow.
 *
 * @example
 * const block = flowBlock('create.unit');
 * block.declaredScope({ layer: 'domain', name: 'Cart', feature: 'cart' }, { root });
 */
export function flowBlock(flowId) {
  const flow = planFlow(flowId);
  if (!flow) throw new TypeError(`Unknown flow "${flowId}".`);
  const rules = actionRules(flowId);
  return defineBlock({
    id: flowId,
    writes: !!flow.writes,
    summary: flow.summary,
    label: flowId,
    meta: Object.freeze({ cli: flow.cli, executors: [...flow.executors], scope: flowScopeKind(flowId) }),
    declaredScope: (args, ctx) => scopeOf(flowId, args ?? {}, ctx),
    actions: (state) => deriveActions(rules, state ?? {}),
    async run(scope, args, ctx = {}) {
      if (flow.cli === null) throw tag(`${flowId} has no block behind it: a person does it by hand.`, 'BLOCK_MANUAL');
      if (!ctx.root || typeof ctx.exec !== 'function') throw tag(`${flowId}.run needs ctx.root and ctx.exec (the caller's executor).`, 'BLOCK_EXEC_MISSING');
      const step = { id: 's1', title: flowId, flow: flowId, args: args ?? {}, executor: ctx.executor ?? 'deterministic' };
      const command = materializeCommand(step);
      const before = snapshot(ctx.root);
      try {
        await ctx.exec({ argv: command.argv, stdin: command.stdin, cwd: ctx.root, step });
      } finally {
        command.cleanup();
      }
      const after = snapshot(ctx.root);
      return { changedFiles: Object.keys(after).filter((f) => after[f] !== before[f]).concat(Object.keys(before).filter((f) => !(f in after))) };
    },
  });
}

/**
 * Every PLAN_FLOWS entry as a contract block, keyed by flow id. Built once, in registry order.
 *
 * @returns {Record<string, import('./block-contract.mjs').Block>} A frozen map of flow id to block.
 *
 * @example
 * Object.keys(flowBlocks()).length === Object.keys(PLAN_FLOWS).length; // => true
 */
export function flowBlocks() {
  cache ??= Object.freeze(Object.fromEntries(Object.keys(PLAN_FLOWS).map((id) => [id, flowBlock(id)])));
  return cache;
}
let cache;

/** The lifecycle events a person can send, and what the button says. The rest (STEP_COMPLETED, YIELDED, ...) are the engine's. */
const PERSON_EVENTS = Object.freeze({ START: 'Start', PAUSE: 'Pause', RESUME: 'Resume', RETRY: 'Retry', CANCEL: 'Cancel' });

const lifecycleRules = Object.keys(PERSON_EVENTS).map((event) => ({
  id: event.toLowerCase(),
  kind: 'mechanical',
  label: PERSON_EVENTS[event],
  applies: (state) => allowedEvents(state.state, state.context ?? {}).includes(event),
}));

/**
 * The process lifecycle as a contract block: read-only (empty scope), and its actions are the person-facing events the
 * state machine accepts in `state.state` (`allowedEvents`), so the menu is the machine's own answer, never a copy of it.
 * `run(scope, { event, state, context })` refuses an event the machine does not accept there.
 *
 * @type {import('./block-contract.mjs').Block}
 */
export const processLifecycleBlock = defineBlock({
  id: 'process.lifecycle',
  writes: false,
  label: 'Process',
  summary: 'The process lifecycle: what a person can do next to a process in its current state.',
  declaredScope: () => emptyScope(),
  actions: (state) => deriveActions(lifecycleRules, state ?? {}),
  run(scope, args) {
    if (!PROCESS_EVENTS.includes(args?.event) || !allowedEvents(args?.state, args?.context ?? {}).includes(args.event)) {
      throw tag(`"${args?.event}" is not accepted in state "${args?.state}".`, 'BLOCK_EVENT_REFUSED');
    }
    return { changedFiles: [] };
  },
});
