// #812 (epic #616, decided on #524 -- https://github.com/thenewurbankid-web/construct/issues/524#issuecomment-5901365512)
// -- a harness compiles a `harness.v1` step graph over existing Choosers into an ordinary plan, so the two worked
// examples (requirement-to-screen, debug) share one engine instead of bespoke glue per chain.
//
//   { version: 1, id, steps: [{ chooser, next?, onResult?, approval? }] }
//
//   - a step names an existing Chooser by id (chooser.mjs's defineChooser); `next` is the default forward edge to
//     another step's chooser id.
//   - `onResult` is conditional edges keyed on facts a caller observed after running a step's chosen flow (the same
//     vocabulary chooser.mjs already uses for an option's `requires`); each entry is `{ when, next, maxRepeats? }`.
//     A back-edge (the target step occurs at or before the source step in `steps`) must declare `maxRepeats`, so a
//     repeat-until-pass loop is always bounded.
//   - `approval: true` on a step inserts a human gate (an ordinary `manual.task` step) before leaving it, compiled
//     the same way `compileChain` compiles any other step -- no new guardrail, no new executor.
//
// No change to Chooser, ChooserExit or compileChain: `compileHarness` walks the document one visit at a time and
// calls `compileChain` per visit (a chain of length one), then stitches the resulting steps into one accumulated
// plan, checked once by `validatePlan`. A visited chooser can repeat (a back-edge), which `compileChain` alone
// cannot express because it rejects a chain with a duplicate chooser id.
import { compileChain, chooserSummary } from './chooser.mjs';
import { emptyScope } from './block-contract.mjs';
import { validatePlan } from './plan.mjs';
import { PATH_LIKE_PATTERN } from './redaction.mjs';

/** The record format's version, written into every harness document. */
export const HARNESS_VERSION = 1;

/** Sizes fixed so a harness stays small and a summary stays fixed-size. */
export const HARNESS_LIMITS = Object.freeze({ minSteps: 1, maxSteps: 20, maxRepeats: 20, when: 80, title: 60 });

/** Every rejection a harness document, a compile or a trace can produce, by name. */
export const HARNESS_ERROR_CODES = Object.freeze({
  HARNESS_NOT_OBJECT: 'HARNESS_NOT_OBJECT',
  HARNESS_VERSION_INVALID: 'HARNESS_VERSION_INVALID',
  HARNESS_ID_INVALID: 'HARNESS_ID_INVALID',
  HARNESS_STEPS_COUNT: 'HARNESS_STEPS_COUNT',
  HARNESS_STEP_NOT_OBJECT: 'HARNESS_STEP_NOT_OBJECT',
  HARNESS_STEP_CHOOSER_INVALID: 'HARNESS_STEP_CHOOSER_INVALID',
  HARNESS_STEP_CHOOSER_DUPLICATE: 'HARNESS_STEP_CHOOSER_DUPLICATE',
  HARNESS_STEP_NEXT_UNKNOWN: 'HARNESS_STEP_NEXT_UNKNOWN',
  HARNESS_STEP_APPROVAL_INVALID: 'HARNESS_STEP_APPROVAL_INVALID',
  HARNESS_ONRESULT_NOT_ARRAY: 'HARNESS_ONRESULT_NOT_ARRAY',
  HARNESS_ONRESULT_ENTRY_INVALID: 'HARNESS_ONRESULT_ENTRY_INVALID',
  HARNESS_ONRESULT_NEXT_UNKNOWN: 'HARNESS_ONRESULT_NEXT_UNKNOWN',
  HARNESS_ONRESULT_MAXREPEATS_REQUIRED: 'HARNESS_ONRESULT_MAXREPEATS_REQUIRED',
  HARNESS_ONRESULT_MAXREPEATS_INVALID: 'HARNESS_ONRESULT_MAXREPEATS_INVALID',
  HARNESS_CHOOSERS_MISSING: 'HARNESS_CHOOSERS_MISSING',
  HARNESS_TRACE_EMPTY: 'HARNESS_TRACE_EMPTY',
  HARNESS_TRACE_ENTRY_INVALID: 'HARNESS_TRACE_ENTRY_INVALID',
  HARNESS_TRACE_FIRST_STEP: 'HARNESS_TRACE_FIRST_STEP',
  HARNESS_TRACE_EDGE_UNKNOWN: 'HARNESS_TRACE_EDGE_UNKNOWN',
  HARNESS_TRACE_REPEATS_EXCEEDED: 'HARNESS_TRACE_REPEATS_EXCEEDED',
  HARNESS_VISIT_INVALID: 'HARNESS_VISIT_INVALID',
  HARNESS_PLAN_INVALID: 'HARNESS_PLAN_INVALID',
});

/**
 * @typedef {{ when: string, next: string, maxRepeats?: number }} HarnessEdge
 * A conditional edge: taken when `when` is in the facts observed after the source step ran.
 *
 * @typedef {{ chooser: string, next?: string, onResult?: HarnessEdge[], approval?: boolean }} HarnessStep
 * One node of the graph, named by the chooser id it runs.
 *
 * @typedef {{ version: 1, id: string, steps: HarnessStep[] }} HarnessDoc
 *
 * @typedef {{ chooser: string, option: string, by?: 'person'|'llm'|'decision-model', provider?: string, resultFacts?: string[] }} HarnessVisit
 * One step of an actual walk: which chooser, which option was answered, and the facts observed after running it
 * (used to pick the next edge). `resultFacts` on the last visit is never read.
 */

const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const isNonEmptyString = (v) => typeof v === 'string' && v.trim().length > 0;
const HARNESS_ID_RE = /^[A-Za-z][A-Za-z0-9_-]*$/;

function plain(text, max) {
  const clean = String(text ?? '').replace(PATH_LIKE_PATTERN, '[path]').replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

/**
 * Validate a harness document without throwing: shape, unique step ids (a step is named by its chooser id), every
 * `next`/`onResult[].next` pointing at a step that exists, and every back-edge (the target occurs at or before the
 * source in `steps`) carrying a positive integer `maxRepeats`.
 *
 * @param {any} doc A candidate `harness.v1` document.
 * @returns {{ valid: boolean, errors: { code: string, path: string, message: string }[] }}
 *
 * @example
 * validateHarness({ version: 1, id: 'x', steps: [] }).errors[0].code; // => 'HARNESS_STEPS_COUNT'
 */
export function validateHarness(doc) {
  const errors = [];
  const push = (code, path, message) => errors.push({ code: HARNESS_ERROR_CODES[code], path, message });
  if (!isPlainObject(doc)) {
    push('HARNESS_NOT_OBJECT', '', 'A harness document must be an object { version, id, steps }.');
    return { valid: false, errors };
  }
  if (doc.version !== HARNESS_VERSION) push('HARNESS_VERSION_INVALID', 'version', `"version" must be ${HARNESS_VERSION}.`);
  if (!isNonEmptyString(doc.id) || !HARNESS_ID_RE.test(doc.id)) push('HARNESS_ID_INVALID', 'id', '"id" must be a plain identifier.');

  const { minSteps, maxSteps, maxRepeats } = HARNESS_LIMITS;
  if (!Array.isArray(doc.steps) || doc.steps.length < minSteps || doc.steps.length > maxSteps) {
    push('HARNESS_STEPS_COUNT', 'steps', `A harness has ${minSteps}-${maxSteps} steps (got ${Array.isArray(doc.steps) ? doc.steps.length : typeof doc.steps}).`);
    return { valid: errors.length === 0, errors };
  }

  const idAt = new Map();
  doc.steps.forEach((s, i) => {
    const at = `steps[${i}]`;
    if (!isPlainObject(s)) { push('HARNESS_STEP_NOT_OBJECT', at, 'A step must be an object { chooser, next?, onResult?, approval? }.'); return; }
    if (!isNonEmptyString(s.chooser)) push('HARNESS_STEP_CHOOSER_INVALID', `${at}.chooser`, '"chooser" must name an existing Chooser id.');
    else if (idAt.has(s.chooser)) push('HARNESS_STEP_CHOOSER_DUPLICATE', `${at}.chooser`, `Chooser "${s.chooser}" is already step ${idAt.get(s.chooser)} of this harness.`);
    else idAt.set(s.chooser, i);
    if ('approval' in s && typeof s.approval !== 'boolean') push('HARNESS_STEP_APPROVAL_INVALID', `${at}.approval`, '"approval" must be a boolean.');
  });

  doc.steps.forEach((s, i) => {
    if (!isPlainObject(s)) return;
    const at = `steps[${i}]`;
    if ('next' in s && s.next !== undefined) {
      if (!isNonEmptyString(s.next) || !idAt.has(s.next)) push('HARNESS_STEP_NEXT_UNKNOWN', `${at}.next`, `"next" must name another step's chooser id (got ${JSON.stringify(s.next)}).`);
    }
    if ('onResult' in s && s.onResult !== undefined) {
      if (!Array.isArray(s.onResult)) { push('HARNESS_ONRESULT_NOT_ARRAY', `${at}.onResult`, '"onResult" must be an array of { when, next, maxRepeats? }.'); return; }
      s.onResult.forEach((edge, j) => {
        const eat = `${at}.onResult[${j}]`;
        if (!isPlainObject(edge) || !isNonEmptyString(edge.when) || !isNonEmptyString(edge.next)) {
          push('HARNESS_ONRESULT_ENTRY_INVALID', eat, 'An onResult entry must be { when: non-empty string, next: chooser id, maxRepeats?: positive integer }.');
          return;
        }
        if (!idAt.has(edge.next)) { push('HARNESS_ONRESULT_NEXT_UNKNOWN', `${eat}.next`, `"next" must name another step's chooser id (got ${JSON.stringify(edge.next)}).`); return; }
        const isBackEdge = idAt.get(edge.next) <= i;
        if ('maxRepeats' in edge && edge.maxRepeats !== undefined) {
          if (!Number.isInteger(edge.maxRepeats) || edge.maxRepeats < 1 || edge.maxRepeats > maxRepeats) {
            push('HARNESS_ONRESULT_MAXREPEATS_INVALID', `${eat}.maxRepeats`, `"maxRepeats" must be an integer between 1 and ${maxRepeats}.`);
          }
        } else if (isBackEdge) {
          push('HARNESS_ONRESULT_MAXREPEATS_REQUIRED', `${eat}.maxRepeats`, `A back-edge to an earlier step ("${edge.next}") must declare "maxRepeats" so the loop is bounded.`);
        }
      });
    }
  });

  return { valid: errors.length === 0, errors };
}

/**
 * The fixed-size summary of a harness at one point in a walk: the current step's own `chooserSummary` plus where it
 * sits in the graph (index, total, whether it is a repeat visit). Same audience as `chooserSummary`: a person, an
 * LLM's tool result and a decision model's input.
 *
 * @param {HarnessDoc} doc A valid harness document.
 * @param {import('./chooser.mjs').Chooser} currentChooser The chooser named by the current step.
 * @param {{ facts?: string[], disabled?: Record<string, string>, chosen?: string, visits?: number }} [state] Chooser state plus how many times this step has been visited so far (1 for the first visit).
 * @returns {{ id: string, question: string, options: object[], chosen: string | null, stepIndex: number, stepCount: number, visit: number }}
 *
 * @example
 * harnessSummary(doc, isolate, { visits: 2 }).visit; // => 2
 */
export function harnessSummary(doc, currentChooser, state = {}) {
  const stepIndex = doc.steps.findIndex((s) => s.chooser === currentChooser.id);
  return {
    ...chooserSummary(currentChooser, state),
    stepIndex: stepIndex < 0 ? null : stepIndex,
    stepCount: doc.steps.length,
    visit: Number.isInteger(state.visits) && state.visits > 0 ? state.visits : 1,
  };
}

function approvalStep(id, dependsOn) {
  return {
    id,
    title: plain('Human approval gate', HARNESS_LIMITS.title),
    flow: 'manual.task',
    args: { instructions: 'Confirm before continuing to the next step of this harness.' },
    executor: 'user',
    touches: emptyScope(),
    ...(dependsOn ? { dependsOn: [dependsOn] } : {}),
  };
}

/** The edge a walk actually takes leaving `fromStep`, given the facts observed after it ran: the first matching `onResult` entry, else `next`, else none (the walk ends). */
function edgeFrom(fromStep, resultFacts) {
  const facts = Array.isArray(resultFacts) ? resultFacts : [];
  const matched = (fromStep.onResult ?? []).find((e) => facts.includes(e.when));
  if (matched) return { next: matched.next, maxRepeats: matched.maxRepeats, conditional: true };
  if (fromStep.next) return { next: fromStep.next, conditional: false };
  return null;
}

/**
 * Compile an actual walk of a harness document into one ordinary plan, by compiling each visit with `compileChain`
 * (a chain of length one, so a repeated chooser never collides with itself) and stitching the results together with
 * `dependsOn`, inserting a `manual.task` approval step wherever the document marks the step left behind `approval:
 * true`. The plan is checked once by `validatePlan`; user input never throws.
 *
 * @param {HarnessDoc} doc A `harness.v1` document.
 * @param {import('./chooser.mjs').Chooser[]} choosers Every chooser the document's steps name, from `defineChooser`.
 * @param {HarnessVisit[]} trace The walk actually taken, in order; `trace[0].chooser` must be `doc.steps[0].chooser`.
 * @param {{ root?: string, title?: string, by?: 'person'|'llm'|'decision-model', provider?: string }} [ctx] Forwarded to `compileChain` per visit.
 * @returns {{ ok: true, plan: object, decisions: import('./chooser.mjs').Decision[], errors: [] } | { ok: false, plan: null, decisions: [], errors: { code: string, path: string, message: string }[] }}
 *
 * @example
 * compileHarness(doc, [reproduce, isolate, fix, verify], [
 *   { chooser: 'debug.reproduce', option: 'playwright-test' },
 *   { chooser: 'debug.isolate', option: 'narrow' },
 * ], { root });
 */
export function compileHarness(doc, choosers, trace, ctx = {}) {
  /** @type {{ code: string, path: string, message: string }[]} */
  const errors = [];
  const push = (code, path, message) => errors.push({ code: HARNESS_ERROR_CODES[code], path, message });
  /** @returns {{ ok: false, plan: null, decisions: [], errors: { code: string, path: string, message: string }[] }} */
  const fail = () => ({ ok: false, plan: null, decisions: [], errors });

  const shape = validateHarness(doc);
  if (!shape.valid) return { ok: false, plan: null, decisions: [], errors: shape.errors };

  const chooserById = new Map();
  for (const c of Array.isArray(choosers) ? choosers : []) if (isPlainObject(c) && isNonEmptyString(c.id)) chooserById.set(c.id, c);
  const stepByChooser = new Map(doc.steps.map((s) => [s.chooser, s]));
  const missing = doc.steps.map((s) => s.chooser).filter((id) => !chooserById.has(id));
  if (missing.length) push('HARNESS_CHOOSERS_MISSING', 'choosers', `Missing Chooser instance(s) for: ${missing.join(', ')}.`);
  if (errors.length) return fail();

  if (!Array.isArray(trace) || trace.length === 0) { push('HARNESS_TRACE_EMPTY', 'trace', 'A trace needs at least one visit.'); return fail(); }
  trace.forEach((v, i) => {
    if (!isPlainObject(v) || !isNonEmptyString(v.chooser) || !isNonEmptyString(v.option)) {
      push('HARNESS_TRACE_ENTRY_INVALID', `trace[${i}]`, 'A visit must be { chooser, option, by?, provider?, resultFacts? }.');
    } else if (!stepByChooser.has(v.chooser)) {
      push('HARNESS_TRACE_ENTRY_INVALID', `trace[${i}].chooser`, `"${v.chooser}" is not a step of this harness.`);
    }
  });
  if (errors.length) return fail();
  if (trace[0].chooser !== doc.steps[0].chooser) {
    push('HARNESS_TRACE_FIRST_STEP', 'trace[0].chooser', `A walk must start at "${doc.steps[0].chooser}" (got "${trace[0].chooser}").`);
    return fail();
  }

  const repeatCounts = new Map();
  const accumulated = [];
  const decisions = [];
  let previousDependsOn = null;

  for (let i = 0; i < trace.length; i += 1) {
    const visit = trace[i];
    const docStep = stepByChooser.get(visit.chooser);

    if (i > 0) {
      const prevVisit = trace[i - 1];
      const prevStep = stepByChooser.get(prevVisit.chooser);
      const edge = edgeFrom(prevStep, prevVisit.resultFacts);
      if (!edge || edge.next !== visit.chooser) {
        push('HARNESS_TRACE_EDGE_UNKNOWN', `trace[${i}]`, `No declared edge from "${prevVisit.chooser}" to "${visit.chooser}" for the observed facts.`);
        return fail();
      }
      if (edge.maxRepeats !== undefined) {
        const key = `${prevVisit.chooser}->${visit.chooser}`;
        const count = (repeatCounts.get(key) ?? 0) + 1;
        repeatCounts.set(key, count);
        if (count > edge.maxRepeats) {
          push('HARNESS_TRACE_REPEATS_EXCEEDED', `trace[${i}]`, `The edge "${key}" repeated ${count} times, over its cap of ${edge.maxRepeats}.`);
          return fail();
        }
      }
      if (prevStep.approval) {
        const gateId = `h${accumulated.length + 1}`;
        accumulated.push(approvalStep(gateId, previousDependsOn));
        previousDependsOn = gateId;
      }
    }

    const answer = visit.by || visit.provider ? { option: visit.option, ...(visit.by ? { by: visit.by } : {}), ...(visit.provider ? { provider: visit.provider } : {}) } : visit.option;
    const compiled = compileChain([chooserById.get(visit.chooser)], { [visit.chooser]: answer }, ctx);
    if (!compiled.ok) {
      for (const e of compiled.errors) push('HARNESS_VISIT_INVALID', `trace[${i}].${e.path}`, e.message);
      return fail();
    }

    const [compiledStep] = compiled.plan.steps;
    const newId = `h${accumulated.length + 1}`;
    const step = { ...compiledStep, id: newId, ...(previousDependsOn ? { dependsOn: [previousDependsOn] } : {}) };
    if (!previousDependsOn) delete step.dependsOn;
    accumulated.push(step);
    for (const d of compiled.decisions) decisions.push({ ...d, step: newId });
    previousDependsOn = newId;
    void docStep;
  }

  const title = isNonEmptyString(ctx.title) ? ctx.title : `Harness: ${doc.id}`;
  const plan = { version: 1, ticket: { source: 'text', title }, steps: accumulated };
  const checked = validatePlan(plan);
  if (!checked.valid) {
    for (const e of checked.errors) push('HARNESS_PLAN_INVALID', e.path, `${e.code}: ${e.message}`);
    return fail();
  }
  return { ok: true, plan, decisions, errors: [] };
}
