// #617 (epic #616) -- a chooser block asks ONE closed question with 2-5 options. Every option is a fixed PLAN_FLOWS flow
// plus fixed args (an enum in effect: the author wrote them, nobody types them), and the answers of a chain of choosers
// compile to an ordinary plan { version, ticket, steps }, so approval, containment and `validatePlan` apply unchanged.
//
//   defineChooser(spec)               validates and freezes a chooser; the only constructor.
//   chooserSummary(chooser, state)    the small fixed-size object a person, an LLM and a decision model all receive.
//   compileChain(choosers, answers)   answers -> { ok, plan, decisions, errors }; the plan is checked by validatePlan.
//   (decision-provider.mjs)           `suggest(summary)` -- a rule-based or plugin suggestion, never an execution.
//
// Every chooser has one honest exit: `manual.task` (a person does it by hand) or an `ai` action that carries every
// GUARDRAIL (output lands as a reviewable diff). Nothing here calls a model or reads a file; `compileChain` only derives
// each step's `touches` from block-flows.mjs (which reads architecture.yml when it needs the features folder).
// PLAN_FLOWS, `validatePlan` and `planToCommand` are used as they are. Decision record: docs/BLOCK-CONTRACT.md.
import { planFlow, validatePlan } from './plan.mjs';
import { BLOCK_ID_RE, GUARDRAILS, emptyScope, validateAction, validateScope } from './block-contract.mjs';
import { argProblem, flowBlock, flowScopeKind } from './block-flows.mjs';

/** Sizes fixed so a summary is always small: 2-5 options, capped text. */
export const CHOOSER_LIMITS = Object.freeze({ minOptions: 2, maxOptions: 5, question: 160, label: 60, why: 120 });

/** The reserved answer that takes the chooser's exit instead of an option. */
export const EXIT_ANSWER = 'exit';

/** Who made a choice, as recorded beside the compiled plan. */
export const DECISION_SOURCES = Object.freeze(['person', 'llm', 'decision-model']);

/** Every rejection a chooser or a chain can produce, by name, so callers and tests match on a code, not on text. */
export const CHOOSER_ERROR_CODES = Object.freeze({
  CHOOSER_NOT_OBJECT: 'CHOOSER_NOT_OBJECT',
  CHOOSER_ID_INVALID: 'CHOOSER_ID_INVALID',
  CHOOSER_QUESTION_INVALID: 'CHOOSER_QUESTION_INVALID',
  CHOOSER_OPTIONS_COUNT: 'CHOOSER_OPTIONS_COUNT',
  CHOOSER_OPTION_NOT_OBJECT: 'CHOOSER_OPTION_NOT_OBJECT',
  CHOOSER_OPTION_ID_INVALID: 'CHOOSER_OPTION_ID_INVALID',
  CHOOSER_OPTION_ID_DUPLICATE: 'CHOOSER_OPTION_ID_DUPLICATE',
  CHOOSER_OPTION_LABEL_INVALID: 'CHOOSER_OPTION_LABEL_INVALID',
  CHOOSER_OPTION_FIELD_INVALID: 'CHOOSER_OPTION_FIELD_INVALID',
  CHOOSER_OPTION_FLOW_UNKNOWN: 'CHOOSER_OPTION_FLOW_UNKNOWN',
  CHOOSER_OPTION_ARGS_INVALID: 'CHOOSER_OPTION_ARGS_INVALID',
  CHOOSER_OPTION_TOUCHES_INVALID: 'CHOOSER_OPTION_TOUCHES_INVALID',
  CHOOSER_OPTION_TOUCHES_REQUIRED: 'CHOOSER_OPTION_TOUCHES_REQUIRED',
  CHOOSER_EXIT_INVALID: 'CHOOSER_EXIT_INVALID',
  CHAIN_EMPTY: 'CHAIN_EMPTY',
  CHAIN_CHOOSER_INVALID: 'CHAIN_CHOOSER_INVALID',
  CHAIN_CHOOSER_DUPLICATE: 'CHAIN_CHOOSER_DUPLICATE',
  CHAIN_ANSWERS_INVALID: 'CHAIN_ANSWERS_INVALID',
  CHAIN_ANSWER_MISSING: 'CHAIN_ANSWER_MISSING',
  CHAIN_ANSWER_UNKNOWN_CHOOSER: 'CHAIN_ANSWER_UNKNOWN_CHOOSER',
  CHAIN_ANSWER_UNKNOWN_OPTION: 'CHAIN_ANSWER_UNKNOWN_OPTION',
  CHAIN_ANSWER_DISABLED: 'CHAIN_ANSWER_DISABLED',
  CHAIN_ANSWER_EXIT_UNSUPPORTED: 'CHAIN_ANSWER_EXIT_UNSUPPORTED',
  CHAIN_ATTRIBUTION_INVALID: 'CHAIN_ATTRIBUTION_INVALID',
  CHAIN_TOUCHES_UNKNOWN: 'CHAIN_TOUCHES_UNKNOWN',
  CHAIN_PLAN_INVALID: 'CHAIN_PLAN_INVALID',
});

/**
 * @typedef {{ id: string, label: string, flow: string, args: Record<string, unknown>, why?: string, requires?: string[], touches?: import('./block-contract.mjs').DeclaredScope }} ChooserOption
 * One answer: a PLAN_FLOWS flow and its fixed args. `touches` is required for a writing flow whose files cannot be
 * derived from its args (every `declared` flow); `requires` names facts (`state.facts`) that must hold for it to be offered.
 *
 * @typedef {{ flow: 'manual.task', args?: { instructions: string }, label?: string, touches?: import('./block-contract.mjs').DeclaredScope } | { id: string, kind: 'ai', label: string, enabled: boolean, gates: string[], why?: string }} ChooserExit
 * The one honest exit: a person does it by hand, or a model fills it in as a reviewable diff (an `ai` action).
 *
 * @typedef {{ id: string, question: string, options: ChooserOption[], exit: ChooserExit }} Chooser
 *
 * @typedef {{ id: string, question: string, options: { id: string, label: string, enabled: boolean, why: string }[], chosen: string | null }} ChooserSummary
 * What a person, an LLM and a decision model all receive: at most 5 options, capped text, no paths.
 *
 * @typedef {{ chosen?: string, facts?: string[], disabled?: Record<string, string> }} ChooserState
 * The state a summary reads: the option already chosen, the facts that hold (matched against `requires`), and options a
 * rule forbids here with the reason.
 *
 * @typedef {{ step: string, chooser: string, option: string, by: 'person'|'llm'|'decision-model', provider?: string }} Decision
 * Who chose what, per compiled step.
 */

const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const isNonEmptyString = (v) => typeof v === 'string' && v.trim().length > 0;
const isNonEmptyStringArray = (v) => Array.isArray(v) && v.every(isNonEmptyString);
const OPTION_ID_RE = /^[A-Za-z][A-Za-z0-9_-]*$/;

const defined = new WeakSet();

/** The executor a compiled step names: `deterministic` where the flow allows it, else its first model executor, else `user`. */
function executorFor(flowId) {
  const { executors } = planFlow(flowId);
  return executors.includes('deterministic') ? 'deterministic' : (executors.find((e) => e !== 'user') ?? 'user');
}

const defaultExit = (question) => ({
  flow: 'manual.task',
  label: 'None of these: do it by hand',
  args: { instructions: `None of the options for "${question}" fit. Do this step by hand.` },
});

/**
 * Validate a chooser spec without throwing.
 *
 * @param {any} spec `{ id, question, options, exit? }`.
 * @returns {{ valid: boolean, errors: { code: string, path: string, message: string }[] }} Every problem found, by code.
 *
 * @example
 * validateChooser({ id: 'page.data', question: 'Where does the data come from?', options: [] }).errors[0].code; // => 'CHOOSER_OPTIONS_COUNT'
 */
export function validateChooser(spec) {
  const errors = [];
  const push = (code, path, message) => errors.push({ code: CHOOSER_ERROR_CODES[code], path, message });
  if (!isPlainObject(spec)) {
    push('CHOOSER_NOT_OBJECT', '', 'A chooser must be an object { id, question, options, exit? }.');
    return { valid: false, errors };
  }
  if (!isNonEmptyString(spec.id) || !BLOCK_ID_RE.test(spec.id)) push('CHOOSER_ID_INVALID', 'id', '"id" must be a dotted identifier such as page.data-source.');
  if (!isNonEmptyString(spec.question)) push('CHOOSER_QUESTION_INVALID', 'question', '"question" must be a non-empty string: the one closed question this block asks.');

  const { minOptions, maxOptions } = CHOOSER_LIMITS;
  if (!Array.isArray(spec.options) || spec.options.length < minOptions || spec.options.length > maxOptions) {
    push('CHOOSER_OPTIONS_COUNT', 'options', `A chooser offers ${minOptions}-${maxOptions} options (got ${Array.isArray(spec.options) ? spec.options.length : typeof spec.options}).`);
  }
  const seen = new Set();
  (Array.isArray(spec.options) ? spec.options : []).forEach((option, i) => {
    const at = `options[${i}]`;
    if (!isPlainObject(option)) {
      push('CHOOSER_OPTION_NOT_OBJECT', at, 'An option must be an object { id, label, flow, args }.');
      return;
    }
    if (!isNonEmptyString(option.id) || !OPTION_ID_RE.test(option.id) || option.id === EXIT_ANSWER) {
      push('CHOOSER_OPTION_ID_INVALID', `${at}.id`, `"id" must be a plain identifier such as new-feature, and not "${EXIT_ANSWER}" (that answer is the exit).`);
    } else if (seen.has(option.id)) {
      push('CHOOSER_OPTION_ID_DUPLICATE', `${at}.id`, `Duplicate option id "${option.id}".`);
    } else {
      seen.add(option.id);
    }
    if (!isNonEmptyString(option.label)) push('CHOOSER_OPTION_LABEL_INVALID', `${at}.label`, '"label" must be a non-empty string; it is what a person reads.');
    if ('why' in option && typeof option.why !== 'string') push('CHOOSER_OPTION_FIELD_INVALID', `${at}.why`, '"why" must be a string.');
    if ('requires' in option && !isNonEmptyStringArray(option.requires)) push('CHOOSER_OPTION_FIELD_INVALID', `${at}.requires`, '"requires" must be an array of non-empty strings.');

    const flow = isNonEmptyString(option.flow) ? planFlow(option.flow) : undefined;
    if (!flow) {
      push('CHOOSER_OPTION_FLOW_UNKNOWN', `${at}.flow`, `"flow" must name a PLAN_FLOWS flow (got ${JSON.stringify(option.flow)}).`);
      return;
    }
    let touchesOk = true;
    if ('touches' in option) {
      const shaped = validateScope(option.touches, `${at}.touches`);
      if (!shaped.valid) {
        touchesOk = false;
        for (const e of shaped.errors) push('CHOOSER_OPTION_TOUCHES_INVALID', e.path, e.message);
      }
    } else if (flow.writes && flowScopeKind(option.flow) === 'declared') {
      push('CHOOSER_OPTION_TOUCHES_REQUIRED', `${at}.touches`, `Flow "${option.flow}" writes files that cannot be derived from its arguments, so the option must declare "touches".`);
    }
    if (touchesOk) {
      const problem = argProblem(option.flow, option.args, executorFor(option.flow), option.touches);
      if (problem) push('CHOOSER_OPTION_ARGS_INVALID', `${at}.args`, problem);
    }
  });

  if ('exit' in spec && spec.exit !== undefined) validateExit(spec.exit, push);
  return { valid: errors.length === 0, errors };
}

function validateExit(exit, push) {
  if (!isPlainObject(exit)) {
    push('CHOOSER_EXIT_INVALID', 'exit', 'The exit must be { flow: "manual.task", args } or an "ai" action carrying every guardrail.');
  } else if ('flow' in exit) {
    if (exit.flow !== 'manual.task') push('CHOOSER_EXIT_INVALID', 'exit.flow', 'A flow exit must be "manual.task".');
    else if ('touches' in exit && !validateScope(exit.touches, 'exit.touches').valid) push('CHOOSER_EXIT_INVALID', 'exit.touches', 'The exit\'s "touches" must be a valid scope.');
    else {
      const problem = argProblem('manual.task', exit.args ?? {}, 'user', exit.touches);
      if (problem) push('CHOOSER_EXIT_INVALID', 'exit.args', problem);
    }
  } else if (exit.kind !== 'ai') {
    push('CHOOSER_EXIT_INVALID', 'exit.kind', `An action exit must be kind "ai" (got ${JSON.stringify(exit.kind)}); a hand-done exit is { flow: "manual.task" }.`);
  } else {
    const missing = GUARDRAILS.filter((g) => !(Array.isArray(exit.gates) && exit.gates.includes(g)));
    const shaped = validateAction(exit, 'exit');
    if (!shaped.valid || missing.length) {
      push('CHOOSER_EXIT_INVALID', 'exit', `The "ai" exit must be a valid action carrying every guardrail (missing: ${missing.join(', ') || 'none'}). ${shaped.errors.map((e) => e.message).join(' ')}`.trim());
    }
  }
}

const deepFreeze = (value) => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze(value[key]);
  }
  return value;
};

/**
 * Build a chooser: validate the spec, copy it, freeze it and return it. A malformed chooser fails where it is defined.
 * Without an `exit`, the exit is `manual.task` (do it by hand).
 *
 * @param {{ id: string, question: string, options: ChooserOption[], exit?: ChooserExit }} spec The chooser.
 * @returns {Chooser} The deep-frozen chooser.
 * @throws {TypeError} Listing every problem by code, when the spec is not valid (a definition is code, not user input).
 *
 * @example
 * const chooser = defineChooser({
 *   id: 'app.slice', question: 'What are you adding?',
 *   options: [
 *     { id: 'feature', label: 'A feature', flow: 'create.feature', args: { name: 'cart' } },
 *     { id: 'validate', label: 'Just check the project', flow: 'validate', args: {} },
 *   ],
 * });
 */
export function defineChooser(spec) {
  const { valid, errors } = validateChooser(spec);
  if (!valid) throw new TypeError(`Invalid chooser${isPlainObject(spec) && spec.id ? ` "${spec.id}"` : ''}: ${errors.map((e) => `${e.code}${e.path ? ` at ${e.path}` : ''}: ${e.message}`).join(' ')}`);
  const chooser = deepFreeze({ ...structuredClone(spec), exit: structuredClone(spec.exit ?? defaultExit(spec.question)) });
  defined.add(chooser);
  return chooser;
}

/** Collapse whitespace, hide anything that looks like an absolute or traversing path, and cap the length with an ellipsis. */
function plain(text, max) {
  const clean = String(text ?? '')
    .replace(/(?<![\w.-])(?:[A-Za-z]:[\\/]|~?\/|\.\.?\/)[^\s'"`),;]+/g, '[path]')
    .replace(/\s+/g, ' ')
    .trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

/** Is `option` on offer in `state`, and if not, why. The one rule the summary and `compileChain` share. */
function optionStatus(option, state) {
  const reason = state.disabled?.[option.id];
  if (typeof reason === 'string' && reason) return { enabled: false, why: reason };
  const facts = Array.isArray(state.facts) ? state.facts : [];
  const missing = (option.requires ?? []).filter((r) => !facts.includes(r));
  if (missing.length) return { enabled: false, why: `Needs: ${missing.join(', ')}.` };
  return { enabled: true, why: option.why ?? '' };
}

const stateOf = (state) => (isPlainObject(state) ? state : {});

/**
 * The summary of a chooser at a state: id, question, every option with whether it is on offer and why, and what was
 * chosen. A fixed shape and size (at most 5 options, capped text, absolute paths redacted), deterministic, and the
 * same object a person's screen, an LLM's tool result and a decision model's input are built from.
 *
 * @param {Chooser} chooser A chooser from `defineChooser`.
 * @param {ChooserState} [state] What holds now.
 * @returns {ChooserSummary} The summary; a `chosen` that names no option is `null`.
 * @throws {TypeError} When `chooser` did not come from `defineChooser`.
 *
 * @example
 * chooserSummary(chooser, { facts: [] }).options.map((o) => o.id); // => ['feature', 'validate']
 */
export function chooserSummary(chooser, state = {}) {
  if (!defined.has(chooser)) throw new TypeError('chooserSummary needs a chooser from defineChooser.');
  const st = stateOf(state);
  const { question: q, label: l, why: w } = CHOOSER_LIMITS;
  const options = chooser.options.slice(0, CHOOSER_LIMITS.maxOptions).map((option) => {
    const { enabled, why } = optionStatus(option, st);
    return { id: option.id, label: plain(option.label, l), enabled, why: plain(why, w) };
  });
  return { id: chooser.id, question: plain(chooser.question, q), options, chosen: options.some((o) => o.id === st.chosen) ? st.chosen : null };
}

function step(index, title, flow, args, executor, touches, why) {
  const out = { id: `s${index + 1}`, title, flow, args: structuredClone(args ?? {}), executor };
  if (touches) out.touches = structuredClone(touches);
  if (why) out.rationale = why;
  return out;
}

/** `{ features, files }` for an option: its declared touches, else what block-flows derives from the args and `root`, else null. */
function touchesFor(option, root) {
  if (option.touches) return option.touches;
  return flowBlock(option.flow).declaredScope(option.args, { root });
}

/**
 * Compile the answers to a chain of choosers into an ordinary plan. Each answer becomes one step (the option's flow and
 * fixed args, `deterministic` where the flow allows it), each depending on the previous one, with `touches` from the
 * option or from block-flows (`declaredScope` with `ctx.root`). The plan is checked by `validatePlan`; it is returned
 * only when that reports zero errors. User input never throws: every problem comes back as a typed error.
 *
 * `answers` is an object keyed by chooser id; a value is the option id, or `{ option, by?, provider? }` to attribute one
 * answer differently. `'exit'` takes the chooser's exit: a `manual.task` step, or `CHAIN_ANSWER_EXIT_UNSUPPORTED` for
 * an `ai` exit (that fill is delivered as a reviewable diff by its own flow, not compiled into a step).
 *
 * Attribution is returned beside the plan as `decisions`, because `validatePlan` rejects unknown top-level plan fields
 * and is not changed for this.
 *
 * @param {Chooser[]} choosers The chain, in order; ids must be unique.
 * @param {Record<string, string | { option: string, by?: string, provider?: string }>} answers One answer per chooser.
 * @param {{ root?: string, title?: string, by?: 'person'|'llm'|'decision-model', provider?: string, states?: Record<string, ChooserState> }} [ctx]
 *   `root` (project root, needed to derive `touches`), the ticket `title`, the default attribution (default `person`) and
 *   per-chooser states (so a disabled option cannot be answered).
 * @returns {{ ok: true, plan: object, decisions: Decision[], errors: [] } | { ok: false, plan: null, decisions: [], errors: { code: string, path: string, message: string }[] }}
 *   The plan and who chose what, or every problem found.
 *
 * @example
 * compileChain([featureChooser, unitChooser], { 'app.feature': 'cart', 'app.unit': 'domain' }, { root });
 */
export function compileChain(choosers, answers, ctx = {}) {
  const errors = [];
  const push = (code, path, message) => errors.push({ code: CHOOSER_ERROR_CODES[code], path, message });
  const fail = () => ({ ok: false, plan: null, decisions: [], errors });
  const c = isPlainObject(ctx) ? ctx : {};

  if (!Array.isArray(choosers) || choosers.length === 0) {
    push('CHAIN_EMPTY', 'choosers', 'A chain needs at least one chooser.');
    return fail();
  }
  const ids = new Set();
  choosers.forEach((chooser, i) => {
    if (!defined.has(chooser)) push('CHAIN_CHOOSER_INVALID', `choosers[${i}]`, 'Every chooser must come from defineChooser.');
    else if (ids.has(chooser.id)) push('CHAIN_CHOOSER_DUPLICATE', `choosers[${i}].id`, `Chooser "${chooser.id}" appears twice in the chain.`);
    else ids.add(chooser.id);
  });
  if (!isPlainObject(answers)) push('CHAIN_ANSWERS_INVALID', 'answers', 'answers must be an object keyed by chooser id.');
  const defaultBy = c.by ?? 'person';
  if (!DECISION_SOURCES.includes(defaultBy)) push('CHAIN_ATTRIBUTION_INVALID', 'ctx.by', `"by" must be one of: ${DECISION_SOURCES.join(', ')}.`);
  if (c.provider !== undefined && !isNonEmptyString(c.provider)) push('CHAIN_ATTRIBUTION_INVALID', 'ctx.provider', '"provider" must be a non-empty string.');
  if (errors.length) return fail();

  for (const key of Object.keys(answers)) {
    if (!ids.has(key)) push('CHAIN_ANSWER_UNKNOWN_CHOOSER', `answers.${key}`, `No chooser "${key}" in this chain.`);
  }

  const steps = [];
  const decisions = [];
  for (const chooser of choosers) {
    const at = `answers.${chooser.id}`;
    const raw = answers[chooser.id];
    if (raw === undefined) {
      push('CHAIN_ANSWER_MISSING', at, `No answer for "${chooser.id}" (${chooser.question}).`);
      continue;
    }
    const answer = isPlainObject(raw) ? raw : { option: raw };
    const by = answer.by ?? defaultBy;
    const provider = answer.provider ?? c.provider;
    if (!DECISION_SOURCES.includes(by) || (provider !== undefined && !isNonEmptyString(provider))) {
      push('CHAIN_ATTRIBUTION_INVALID', at, `"by" must be one of: ${DECISION_SOURCES.join(', ')}, and "provider" a non-empty string.`);
      continue;
    }
    const record = (optionId) => decisions.push({ step: `s${steps.length}`, chooser: chooser.id, option: optionId, by, ...(provider ? { provider } : {}) });

    if (answer.option === EXIT_ANSWER) {
      const { exit } = chooser;
      if (exit.flow !== 'manual.task') {
        push('CHAIN_ANSWER_EXIT_UNSUPPORTED', at, `The exit of "${chooser.id}" is an AI fill, delivered as a reviewable diff; it does not compile into a plan step.`);
        continue;
      }
      steps.push(step(steps.length, plain(exit.label ?? 'Do it by hand', CHOOSER_LIMITS.label), 'manual.task', exit.args, 'user', exit.touches ?? emptyScope(), null));
      if (steps.length > 1) steps.at(-1).dependsOn = [steps.at(-2).id];
      record(EXIT_ANSWER);
      continue;
    }
    const option = chooser.options.find((o) => o.id === answer.option);
    if (!option) {
      push('CHAIN_ANSWER_UNKNOWN_OPTION', at, `"${chooser.id}" has no option ${JSON.stringify(answer.option)}. Options: ${chooser.options.map((o) => o.id).join(', ')}.`);
      continue;
    }
    const status = optionStatus(option, stateOf(c.states?.[chooser.id]));
    if (!status.enabled) {
      push('CHAIN_ANSWER_DISABLED', at, `Option "${option.id}" of "${chooser.id}" is not on offer: ${status.why}`);
      continue;
    }
    const touches = touchesFor(option, c.root);
    if (planFlow(option.flow).writes && !touches) {
      push('CHAIN_TOUCHES_UNKNOWN', at, `The files of "${option.id}" (${option.flow}) cannot be derived${c.root ? '' : ' without ctx.root'}; declare "touches" on the option.`);
      continue;
    }
    steps.push(step(steps.length, option.label, option.flow, option.args, executorFor(option.flow), touches, option.why));
    if (steps.length > 1) steps.at(-1).dependsOn = [steps.at(-2).id];
    record(option.id);
  }
  if (errors.length) return fail();

  const title = isNonEmptyString(c.title) ? c.title : `Chain: ${choosers.map((x) => x.id).join(', ')}`;
  const plan = { version: 1, ticket: { source: 'text', title }, steps };
  const checked = validatePlan(plan);
  if (!checked.valid) {
    for (const e of checked.errors) push('CHAIN_PLAN_INVALID', e.path, `${e.code}: ${e.message}`);
    return fail();
  }
  return { ok: true, plan, decisions, errors: [] };
}
