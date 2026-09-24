// #289 / #332 — Plan mode's server half. Deterministic blocks only; no model is called anywhere in this file.
//
// SECURITY, in one place. The plan arrives from the CLIENT, so nothing in it is trusted:
//   - `checkPlan()` re-runs core's `validatePlan()` (the single source of truth for the plan contract) and then
//     the Cockpit's own stricter checks below. `run()` refuses on any error and starts nothing.
//   - only the flows of `PLAN_FLOWS` (the whitelist) can ever run, and only through `planToCommand()`: an argv
//     ARRAY for `bin/construct.mjs`, never a shell string. `pipeline.run` (an opaque envelope) is not offered.
//   - every path-valued argument must be project-relative: no `..`, no absolute path, no URL, no symlink out of
//     the project (checked lexically AND with realpath on the deepest existing ancestor).
//   - no string argument may start with `-` (it would be read as an option) or hold a control character.
//   - #407: a block (flow) turned off for this project in Features > Blocks is refused (COCKPIT_BLOCK_DISABLED), by the
//     same check that refuses everything else here, so it is enforced on the server and not merely hidden in the UI.
//   - the only model a step may name is `ollama` (local); `llm: claude` is refused. A model runs only on a step
//     the plan tags `local-model`, which `validatePlan()` already enforces for `deterministic`.
//   - the project is always the server's current one. Nothing here reads a project path from a request.
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../../../packages/core/config.mjs';
import { PLAN_FLOWS, planFlow, validatePlan, planToCommand, planTouches } from '../../../packages/core/plan.mjs';
import { expectedFiles } from '../../../packages/core/plan-touches.mjs';
import { analyzeImpact, proposeSeedsFromText } from '../../../packages/engine/impact.mjs';
import { listUnits } from '../../../packages/engine/unitSummary.mjs';

/** The one model provider a Cockpit step may name (a local Ollama); anything else is refused (COCKPIT_LLM_PROVIDER). */
export const LOCAL_PROVIDER = 'ollama';
export const MAX_STEPS = 50;
export const MAX_TEXT = 20_000;
export const MAX_SEEDS = 50;
const MAX_ARG = 300;

/** Flows the Cockpit will not run from a browser-supplied plan, with the reason a person can read. */
export const NOT_OFFERED = Object.freeze({
  'pipeline.run': 'Running a raw Context Envelope is not offered in the Cockpit: an envelope is an opaque program of generator steps, not something a plan review can show plainly.',
});

/** Which arguments hold a file path, per flow. Every one must be project-relative. The drift guard in
 * planService.test.mjs fails if a flow gains a path-looking argument that is not listed here. */
export const PATH_ARGS = Object.freeze({
  'project.init': ['dir'],
  'create.page.from': ['from'],
  'create.workflow.from': ['from'],
  'create.controller.bind': ['envelope'],
  'create.service.openapi': ['openapi'],
  'import.unit': ['from'],
  'research.workflow': ['file'],
});
/** `dir` (target a Construct project nested in a subdirectory) exists on most flows and is always a path. */
const isPathArg = (flowId, name) => name === 'dir' || (PATH_ARGS[flowId] || []).includes(name);
/** `route` is a URL or a folder; it must at least stay inside the project. */
const ROUTE_ARGS = new Set(['route']);

const err = (code, at, message) => ({ code, path: at, message });

/** Returns a plain reason the value is not a safe project-relative path, or null when it is. */
export function unsafePathReason(root, value) {
  if (typeof value !== 'string' || !value) return 'must be a non-empty path.';
  if (/[\0\r\n]/.test(value)) return 'must not contain control characters.';
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return 'must be a path inside the project, not a URL.';
  if (path.isAbsolute(value) || /^[A-Za-z]:[\\/]/.test(value) || value.startsWith('~')) return 'must be relative to the project, not an absolute path.';
  if (value.includes('\\')) return 'must use forward slashes.';
  if (value.split('/').includes('..')) return 'must stay inside the project (no "..").';
  const base = fs.realpathSync(root);
  const target = path.resolve(base, value);
  const rel = path.relative(base, target);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return 'must stay inside the project.';
  // A symlink inside the project could still lead out of it: check the deepest ancestor that exists.
  let probe = target;
  while (!fs.existsSync(probe)) {
    const parent = path.dirname(probe);
    if (parent === probe) break;
    probe = parent;
  }
  let real;
  try { real = fs.realpathSync(probe); } catch { return 'could not be resolved inside the project.'; }
  const back = path.relative(base, real);
  if (back.startsWith('..') || path.isAbsolute(back)) return 'leads outside the project through a symbolic link.';
  return null;
}

function checkStringValue(value, at, name, push) {
  if (typeof value !== 'string') return;
  if (value.length > MAX_ARG) push(err('COCKPIT_ARG_TOO_LONG', at, `"${name}" is longer than ${MAX_ARG} characters.`));
  if (/[\0\r\n]/.test(value)) push(err('COCKPIT_ARG_CONTROL', at, `"${name}" must not contain control characters.`));
  if (value.startsWith('-')) push(err('COCKPIT_ARG_DASH', at, `"${name}" must not start with "-" (it would be read as a command option).`));
}

/**
 * The Cockpit's own checks on top of validatePlan(). Only steps that name a whitelisted flow are examined.
 *
 * @param {object} plan
 * @param {string} root The project root.
 * @param {{disabledFlows?: string[], blockSettingsUnreadable?: string|null}} [options] #407: the blocks turned off for
 *   this project. When the settings file cannot be read the check fails closed (every step is refused, by name).
 */
export function cockpitErrors(plan, root, { disabledFlows = [], blockSettingsUnreadable = null } = {}) {
  const out = [];
  const off = new Set(disabledFlows);
  const push = (e) => out.push(e);
  const steps = Array.isArray(plan?.steps) ? plan.steps : [];
  if (steps.length > MAX_STEPS) push(err('COCKPIT_TOO_MANY_STEPS', 'steps', `A plan run from the Cockpit may have at most ${MAX_STEPS} steps.`));
  if (typeof plan?.ticket?.body === 'string' && plan.ticket.body.length > MAX_TEXT) push(err('COCKPIT_TEXT_TOO_LONG', 'ticket.body', `The ticket text is longer than ${MAX_TEXT} characters.`));
  steps.forEach((step, i) => {
    if (!step || typeof step !== 'object' || typeof step.flow !== 'string') return;
    const flow = planFlow(step.flow);
    if (!flow) return; // validatePlan() names this one
    const at = `steps[${i}]`;
    if (off.has(step.flow)) push(err('COCKPIT_BLOCK_DISABLED', `${at}.flow`, `The block "${step.flow}" is turned off for this project (Features, Blocks tab). Turn it on there, or remove this step.`));
    if (blockSettingsUnreadable && !out.some((e) => e.code === 'COCKPIT_BLOCK_SETTINGS_UNREADABLE')) push(err('COCKPIT_BLOCK_SETTINGS_UNREADABLE', 'blocks', 'This project\'s block settings could not be read, so no plan can be checked against them. Open Features, Blocks tab, and save the settings again to reset them.'));
    if (Object.hasOwn(NOT_OFFERED, step.flow)) push(err('COCKPIT_FLOW_NOT_OFFERED', `${at}.flow`, NOT_OFFERED[step.flow]));
    const args = step.args && typeof step.args === 'object' && !Array.isArray(step.args) ? step.args : {};
    for (const [name, value] of Object.entries(args)) {
      const spec = flow.args[name];
      if (!spec) continue; // validatePlan() names unknown arguments
      const argAt = `${at}.args.${name}`;
      // `manual.task`'s instructions are free text for a person; every other string is an argument.
      if (step.flow !== 'manual.task') {
        if (spec.type === 'string') checkStringValue(value, argAt, name, push);
        if (spec.type === 'string[]' && Array.isArray(value)) value.forEach((v) => checkStringValue(v, argAt, name, push));
      }
      if (typeof value === 'string' && isPathArg(step.flow, name)) {
        const why = unsafePathReason(root, value);
        if (why) push(err('COCKPIT_ARG_PATH', argAt, `"${name}" ${why}`));
      }
      if (typeof value === 'string' && ROUTE_ARGS.has(name)) {
        if (value.split('/').includes('..') || /[\\\0]/.test(value)) push(err('COCKPIT_ARG_PATH', argAt, `"${name}" must stay inside the project (no "..").`));
      }
      if (name === 'llm' && typeof value === 'string' && value !== LOCAL_PROVIDER) {
        push(err('COCKPIT_LLM_PROVIDER', argAt, `The Cockpit only runs a local model (${LOCAL_PROVIDER}); "${value}" is not allowed on a step.`));
      }
    }
    if (step.flow === 'import.plan' && Array.isArray(args.plan?.units)) {
      args.plan.units.forEach((u, j) => {
        if (u && typeof u.from === 'string') {
          const why = unsafePathReason(root, u.from);
          if (why) push(err('COCKPIT_ARG_PATH', `${at}.args.plan.units[${j}].from`, `"from" ${why}`));
        }
      });
    }
  });
  return out;
}

/** Plain-language text for a named error, shown next to the step. The code stays alongside so a test or a
 * script can match on it; the sentence is what a person reads. */
export function plainMessage(e) {
  switch (e.code) {
    case 'STEP_EXECUTOR_LLM_CONFLICT': return `${e.message} Either tag it "Local model" or remove the llm argument.`;
    case 'STEP_EXECUTOR_NOT_ALLOWED': return `${e.message} A model can only be used on a flow that has a model path.`;
    default: return e.message;
  }
}

/**
 * #470: declare, for every step the bot will run, the files that step will create, so the approval gate can match what
 * the bot wrote against what the plan said. Only files the step did not already declare are added (a person's own
 * declaration is never replaced), only for flows core derives exactly (`expectedFiles`), and never for a manual step.
 * Returns the same plan object when there is nothing to add.
 */
export function withExpectedFiles(plan, root) {
  if (!plan || typeof plan !== 'object' || !Array.isArray(plan.steps)) return plan;
  let changed = false;
  const steps = plan.steps.map((step) => {
    if (!step || typeof step !== 'object' || step.executor === 'user' || !planFlow(step.flow)?.writes) return step;
    const touches = step.touches === undefined ? { features: [] } : step.touches;
    const declared = touches?.files === undefined ? [] : touches?.files;
    if (!touches || typeof touches !== 'object' || Array.isArray(touches) || !Array.isArray(declared)) return step; // malformed: the validator reports it
    const args = step.args && typeof step.args === 'object' && !Array.isArray(step.args) ? step.args : {};
    const missing = (expectedFiles(root, step.flow, args) ?? []).filter((d) => !declared.some((f) => f?.path === d.path));
    if (!missing.length) return step;
    changed = true;
    return { ...step, touches: { ...touches, files: [...declared, ...missing] } };
  });
  return changed ? { ...plan, steps } : plan;
}

/** validatePlan() + the Cockpit checks + a preview of what each step would run. Pure over (plan, root, block settings). */
export function checkPlan(given, root, blockSettings = {}) {
  const plan = withExpectedFiles(given, root);
  const base = validatePlan(plan);
  const errors = [...base.errors];
  if (plan && typeof plan === 'object' && Array.isArray(plan.steps)) errors.push(...cockpitErrors(plan, root, blockSettings));
  const shaped = errors.map((e) => ({ ...e, plain: plainMessage(e) }));
  const steps = [];
  if (plan && Array.isArray(plan.steps)) {
    for (const step of plan.steps) {
      let cmd = null;
      try { if (step && planFlow(step.flow)) cmd = planToCommand(step); } catch { cmd = null; }
      steps.push({
        id: step?.id ?? null,
        manual: !!cmd?.manual,
        argv: cmd?.argv ? ['construct', ...cmd.argv] : null,
        stdin: cmd?.stdin ?? null,
        model: step?.executor === 'local-model',
        // #470: the files this step will write, declared or derived, so the card can say so before Run.
        files: (Array.isArray(step?.touches?.files) ? step.touches.files : []).filter((f) => typeof f?.path === 'string' && f.change !== 'read').map((f) => f.path),
      });
    }
  }
  return { valid: shaped.length === 0, errors: shaped, steps, touches: base.valid ? planTouches(plan) : { features: [], files: [] } };
}

/** The flow catalogue the review UI adds steps from: every whitelisted flow, its arguments and executors. */
export function flowCatalogue({ disabledFlows = [] } = {}) {
  const off = new Set(disabledFlows);
  return Object.entries(PLAN_FLOWS).map(([id, f]) => ({
    id,
    summary: f.summary,
    enabled: !off.has(id),
    writes: !!f.writes,
    executors: [...f.executors],
    offered: !Object.hasOwn(NOT_OFFERED, id),
    ...(Object.hasOwn(NOT_OFFERED, id) ? { notOffered: NOT_OFFERED[id] } : {}),
    args: Object.entries(f.args).map(([name, s]) => ({
      name,
      type: s.type,
      required: !!s.required,
      ...(s.enum ? { enum: [...s.enum] } : {}),
      ...(s.description ? { description: s.description } : {}),
      path: isPathArg(id, name),
    })),
  }));
}

/** Constraints as the project's own architecture.yml states them: layers, active rules, frozen regions. */
export function readConstraints(root) {
  const cfg = loadConfig(root);
  return {
    framework: cfg.project?.framework ?? null,
    featuresRoot: cfg.features?.root ?? 'features',
    layers: Object.entries(cfg.layers || {}).map(([name, l]) => ({ name, canImport: [...(l.canImport || [])] })),
    rules: Object.entries(cfg.rules || {})
      .filter(([, r]) => r && r.severity && r.severity !== 'off')
      .map(([id, r]) => ({ id, severity: r.severity })),
    frozen: (cfg.frozen || []).map((f) => (typeof f === 'string' ? f : f.pattern || f.path || JSON.stringify(f))),
    exceptions: (cfg.exceptions || []).length,
  };
}

const fail = (status, error, extra = {}) => ({ status, body: { ok: false, error, ...extra } });
const refOk = (r) => typeof r === 'string' && r.length > 0 && r.length <= 200 && !/[\0\r\n\\]/.test(r) && !r.split(/[/:]/).includes('..') && !path.isAbsolute(r.replace(/^[a-z]+:/, ''));

/**
 * @param {object} o
 * @param {() => string|null} o.getRoot the current project's root (never from a request)
 * @param {(plan: object) => {ok: boolean, processId?: string, status?: number, error?: string}} o.startPlan
 *   starts a validated plan; injected so tests can watch that nothing starts on refusal
 * @param {(root: string) => {flows: string[], unreadable?: string|null}} [o.getBlockSettings]
 *   #407: the blocks turned off for the project at `root`. Read on EVERY check and run (never cached), so turning a block
 *   off takes effect at once; a reader that throws is treated as unreadable and fails closed.
 * @param {(started: {noteId: string, plan: object, processId: string}) => void} [o.onStarted]
 *   #609: called once a plan that named a note (`noteId`) has started, to mark that note ran. A failure here never
 *   undoes the run (the process exists); it is reported as `noteRan: false` so the screen can say so.
 */
export function createPlanService({ getRoot, startPlan, onStarted, getBlockSettings }) {
  const withRoot = (fn) => {
    const root = getRoot();
    if (!root) return fail(409, 'No Construct project found for the current project directory. Pick a project first.');
    return fn(root);
  };
  const blockSettingsFor = (root) => {
    if (!getBlockSettings) return {};
    try {
      const s = getBlockSettings(root);
      return { disabledFlows: Array.isArray(s?.flows) ? s.flows : [], blockSettingsUnreadable: s?.unreadable ?? null };
    } catch (e) {
      return { disabledFlows: [], blockSettingsUnreadable: String(e?.message || e) };
    }
  };
  return {
    context() {
      return withRoot((root) => {
        const units = listUnits(root, { kind: 'feature' });
        return {
          status: 200,
          body: { ok: true, project: path.basename(root), constraints: readConstraints(root), features: units.ok ? units.units.map((u) => ({ ref: u.ref, name: u.name })) : [], flows: flowCatalogue({ disabledFlows: blockSettingsFor(root).disabledFlows }) },
        };
      });
    },
    /** Proposals only. Nothing is analysed and no model is called: a heuristic text match with evidence. */
    propose(body) {
      return withRoot((root) => {
        const text = body?.text;
        if (typeof text !== 'string' || !text.trim()) return fail(400, 'Write the ticket text first.');
        if (text.length > MAX_TEXT) return fail(400, `The ticket text is longer than ${MAX_TEXT} characters.`);
        const r = proposeSeedsFromText(root, text);
        if (!r.ok) return fail(400, r.error?.message || 'The ticket could not be read.');
        return { status: 200, body: { ok: true, method: r.method, note: r.note, seeds: r.seeds } };
      });
    },
    /** `seeds`: unit refs the user picked (explicit). `accepted`: refs the user confirmed from the proposals;
     * they are recomputed from `text` here, so they keep their evidence and stay `inferred`. */
    impact(body) {
      return withRoot((root) => {
        const picked = Array.isArray(body?.seeds) ? body.seeds : [];
        const accepted = Array.isArray(body?.accepted) ? body.accepted : [];
        if (picked.length + accepted.length > MAX_SEEDS) return fail(400, `At most ${MAX_SEEDS} seeds.`);
        if (![...picked, ...accepted].every(refOk)) return fail(400, 'Each seed must be a unit reference such as "feature:billing", with no ".." or absolute path.');
        const seeds = picked.map((ref) => ({ ref, provenance: 'explicit', method: 'user' }));
        if (accepted.length) {
          const text = typeof body?.text === 'string' ? body.text.slice(0, MAX_TEXT) : '';
          const proposed = text.trim() ? proposeSeedsFromText(root, text) : { ok: false };
          const byRef = new Map((proposed.ok ? proposed.seeds : []).map((s) => [s.ref, s]));
          for (const ref of accepted) {
            const s = byRef.get(ref);
            if (!s) return fail(400, `"${ref}" was not one of the proposals for this ticket text.`);
            seeds.push(s);
          }
        }
        if (!seeds.length) return fail(400, 'Pick at least one unit, or confirm a proposal, before analysing.');
        const depth = Number.isInteger(body?.depth) && body.depth >= 0 && body.depth <= 6 ? body.depth : 2;
        const report = analyzeImpact(root, { seeds, depth });
        if (!report.ok) return fail(400, report.error?.message || 'The impact could not be computed.');
        return { status: 200, body: { ok: true, report } };
      });
    },
    validate(body) {
      return withRoot((root) => ({ status: 200, body: { ok: true, ...checkPlan(body?.plan, root, blockSettingsFor(root)) } }));
    },
    /** Re-validates, then starts. On ANY error nothing is created and nothing is started. */
    run(body) {
      return withRoot((root) => {
        // The plan that starts is the plan with its derived files declared (#470), the one the record and the gate see.
        const plan = withExpectedFiles(body?.plan, root);
        const checked = checkPlan(plan, root, blockSettingsFor(root));
        if (!checked.valid) return fail(400, 'The plan is not valid, so it was not run.', { errors: checked.errors });
        const started = startPlan(plan);
        if (!started?.ok) return fail(started?.status || 500, started?.error || 'The plan could not be started.');
        const noteId = typeof body?.noteId === 'string' && body.noteId ? body.noteId : null;
        let noteRan = null;
        if (noteId && onStarted) {
          try {
            onStarted({ noteId, plan, processId: started.processId });
            noteRan = true;
          } catch {
            noteRan = false;
          }
        }
        return { status: 200, body: { ok: true, processId: started.processId, models: plan.steps.filter((s) => s.executor === 'local-model').map((s) => s.id), ...(noteRan === null ? {} : { noteRan }) } };
      });
    },
  };
}
