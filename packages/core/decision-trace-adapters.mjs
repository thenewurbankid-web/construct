// #643 -- turn what the chain blocks already return into the `choices` `recordChoices` (decision-trace-store.mjs) records:
//
//   choicesFromChain(choosers, decisions, ctx)          the `decisions` `compileChain` returns beside its plan (chooser.mjs)
//   choiceFromCardQuestion(card, item, option, by)      one answered open question of a requirement card (requirement-card.mjs)
//   choicesFromPlacement(card, placeOptions, placement) the `decisions` of a `placeCard` result, each with the question AS IT
//                                                       WAS OFFERED (placement.mjs: open questions and the `q-shape` offer)
//   choicesFromWiring(planned)                          the answered `q-route`, `q-dependency` and `q-source` of a `planFromBlocks` result (#654, #621)
//   choiceFromProofOptions(feature, summary, chosen, by) what a person did about the proof of a screen (#653): the closed options of
//                                                       `proofSummary` (proof.mjs) as offered, and the one chosen (run or skip)
//
// Pure: no filesystem, no clock, no network. The summary of each choice is the fixed-size object that was offered, with
// `chosen` null and every path hidden; a choice that cannot be rebuilt (its question is gone) is left out, never guessed.
import { chooserSummary } from './chooser.mjs';
import { openQuestion } from './requirement-card.mjs';
import { placeCard, SHAPE_QUESTION_ID } from './placement.mjs';
import { hidePathsDeep } from './redaction.mjs';

const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * The trace chooser id of a placement question: its KIND, not its instance number (`q-v1` is "the ambiguity of verb 1"), so
 * per-chooser statistics group like with like.
 *
 * @param {string} questionId A placement question id (`q-v1`, `q-c2`, `q-server`, `q-shape`).
 * @returns {string} `requirement.placement.ambiguity`, `.check`, `.server-check`, `.shape` or `.other`.
 *
 * @example
 * placementChooserId('q-v1'); // => 'requirement.placement.ambiguity'
 */
export function placementChooserId(questionId) {
  if (questionId === SHAPE_QUESTION_ID) return 'requirement.placement.shape';
  if (questionId === 'q-server') return 'requirement.placement.server-check';
  if (/^q-v\d+$/.test(questionId)) return 'requirement.placement.ambiguity';
  if (/^q-c\d+$/.test(questionId)) return 'requirement.placement.check';
  return 'requirement.placement.other';
}

/** A question `{ id, question, options: [{ id, label, enabled, why }] }` as the fixed summary that was offered (`chosen` null, paths hidden). */
const offered = (q) => hidePathsDeep({
  id: q.id,
  question: q.question,
  options: (q.options ?? []).map((o) => ({ id: o.id, label: o.label, enabled: o.enabled !== false, why: o.why ?? '' })),
  chosen: null,
});

/**
 * The choice of one answered open question of a card: the question as it stood on the card BEFORE the answer, and the option.
 *
 * @param {import('./requirement-card.mjs').RequirementCard} card The card as it was when the question was asked.
 * @param {import('./requirement-card.mjs').CardOpen} item An entry of `card.open`.
 * @param {string} option The option the person chose.
 * @param {'person'|'llm'|'decision-model'} [by] Who chose (default `person`).
 * @returns {{ chooser: { id: string, question: string }, summary: object, chosen: string, by: string }} A choice for `recordChoices`.
 *
 * @example
 * choiceFromCardQuestion(card, card.open[0], 'entity').chooser.id; // => 'requirement.card.noun'
 */
export function choiceFromCardQuestion(card, item, option, by = 'person') {
  const summary = offered(openQuestion(card, item));
  return { chooser: { id: `requirement.card.${item.slot}`, question: summary.question }, summary, chosen: option, by };
}

/**
 * The choices behind a placement: for each recorded decision, place the card again WITHOUT that answer and take the question
 * (an open question or the `q-shape` offer) exactly as it was offered. Attribution (`by`, `provider`) is carried over.
 *
 * @param {import('./requirement-card.mjs').RequirementCard} card The card that was placed.
 * @param {Parameters<typeof placeCard>[1]} placeOptions The options it was placed with (including the `answers`).
 * @param {{ decisions?: import('./placement.mjs').PlacementDecision[] }} placement The result of `placeCard` with those options.
 * @returns {object[]} Choices for `recordChoices`, in the placement's decision order.
 *
 * @example
 * choicesFromPlacement(card, { answers: { 'q-shape': 'list' } }, placement)[0].chooser.id; // => 'requirement.placement.shape'
 */
export function choicesFromPlacement(card, placeOptions, placement) {
  const out = [];
  const opts = isPlainObject(placeOptions) ? placeOptions : {};
  for (const d of placement?.decisions ?? []) {
    const rest = { ...(isPlainObject(opts.answers) ? opts.answers : {}) };
    delete rest[d.question];
    const before = placeCard(card, { ...opts, answers: rest });
    const q = [...(before.open ?? []), ...(before.offers ?? [])].find((x) => x.id === d.question);
    if (!q) continue;
    const summary = offered(q);
    out.push({ chooser: { id: placementChooserId(d.question), question: summary.question }, summary, chosen: d.option, by: d.by, ...(d.provider ? { provider: d.provider } : {}) });
  }
  return out;
}

/**
 * The trace chooser id of a wiring question of a shaped plan (#654, #621): `q-dependency`, `q-route` (or `q-route-<name>`) and `q-source` (or `q-source-<name>`).
 *
 * @param {string} questionId A wiring question id.
 * @returns {string} `requirement.plan.dependency`, `requirement.plan.route`, `requirement.plan.source`, `requirement.plan.env` (#632: `q-env`, `q-env-<name>`), `requirement.plan.verify` (#632: `q-verify`), `requirement.plan.steps` (#659: `q-steps`, `q-steps-<name>`), `requirement.plan.states` (#622: `q-states`, `q-states-<name>`) or `requirement.plan.other`.
 *
 * @example
 * wiringChooserId('q-route'); // => 'requirement.plan.route'
 */
export function wiringChooserId(questionId) {
  if (questionId === 'q-dependency') return 'requirement.plan.dependency';
  if (/^q-route(-|$)/.test(questionId)) return 'requirement.plan.route';
  if (/^q-source(-|$)/.test(questionId)) return 'requirement.plan.source';
  if (/^q-env(-|$)/.test(questionId)) return 'requirement.plan.env';
  if (questionId === 'q-verify') return 'requirement.plan.verify';
  if (/^q-steps(-|$)/.test(questionId)) return 'requirement.plan.steps';
  if (/^q-states(-|$)/.test(questionId)) return 'requirement.plan.states';
  return 'requirement.plan.other';
}

/**
 * The choices behind the wiring of a shaped plan: each answered `q-route` / `q-dependency` / `q-source` of a `planFromBlocks` result, with the
 * question as it was offered (`chosen` null, paths hidden) and the attribution it was answered with. An unanswered question records
 * nothing (its default was applied, nobody chose).
 *
 * @param {{ offers?: object[], decisions?: import('./placement.mjs').PlacementDecision[] }} planned The result of `planFromBlocks`.
 * @returns {object[]} Choices for `recordChoices`, in the plan's decision order.
 *
 * @example
 * choicesFromWiring(planFromBlocks(blocks, { feature, root, answers: { 'q-dependency': 'skip' } }))[0].chooser.id; // => 'requirement.plan.dependency'
 */
export function choicesFromWiring(planned) {
  const out = [];
  for (const d of planned?.decisions ?? []) {
    const q = (planned?.offers ?? []).find((x) => x.id === d.question);
    if (!q) continue;
    const summary = offered(q);
    out.push({ chooser: { id: wiringChooserId(d.question), question: summary.question }, summary, chosen: d.option, by: d.by, ...(d.provider ? { provider: d.provider } : {}) });
  }
  return out;
}

/**
 * The choices behind a compiled chain: each decision of `compileChain` with the chooser's summary as offered (its state
 * without `chosen`), and the attribution it was compiled with.
 *
 * @param {import('./chooser.mjs').Chooser[]} choosers The chain's choosers (from `defineChooser`).
 * @param {import('./chooser.mjs').Decision[]} decisions The `decisions` returned beside the plan.
 * @param {{ states?: Record<string, import('./chooser.mjs').ChooserState> }} [ctx] The per-chooser states the chain was compiled with.
 * @returns {object[]} Choices for `recordChoices`; a decision whose chooser is not in `choosers` is left out.
 *
 * @example
 * await recordChoices(root, choicesFromChain(choosers, result.decisions), { outcome: { planValidated: true } });
 */
export function choicesFromChain(choosers, decisions, ctx = {}) {
  const out = [];
  for (const d of Array.isArray(decisions) ? decisions : []) {
    const chooser = (Array.isArray(choosers) ? choosers : []).find((c) => c.id === d.chooser);
    if (!chooser) continue;
    const state = { ...(isPlainObject(ctx.states?.[chooser.id]) ? ctx.states[chooser.id] : {}) };
    delete state.chosen;
    const summary = hidePathsDeep(chooserSummary(chooser, state));
    out.push({ chooser: { id: chooser.id, question: summary.question }, summary, chosen: d.option, by: d.by, ...(d.provider ? { provider: d.provider } : {}) });
  }
  return out;
}

/**
 * What a person chose to do about the proof of a screen: the closed options of a `proofSummary` (2 to 5, as offered) and the one
 * chosen (`run-proof`, `skip-proof`...). The chooser is the same for every feature, so statistics group like with like.
 *
 * @param {string} feature The feature whose screen the proof is of.
 * @param {{ options: { id: string, label: string, why?: string }[] }} summary A `proofSummary` (proof.mjs).
 * @param {string} chosen One of the option ids of `summary`.
 * @param {'person'|'llm'|'decision-model'} [by] Who chose (default `person`).
 * @returns {{ chooser: { id: string, question: string }, summary: object, chosen: string, by: string }} A choice for `recordChoices`.
 *
 * @example
 * choiceFromProofOptions('products', proofSummary(null), 'skip-proof').chooser.id; // => 'requirement.proof.next'
 */
export function choiceFromProofOptions(feature, summary, chosen, by = 'person') {
  const question = `What next for the proof of the ${String(feature).slice(0, 80)} screen?`;
  const shown = hidePathsDeep({ id: 'requirement.proof.next', question, options: (summary?.options ?? []).map((o) => ({ id: o.id, label: o.label, enabled: true, why: o.why ?? '' })), chosen: null });
  return { chooser: { id: 'requirement.proof.next', question }, summary: shown, chosen, by };
}
