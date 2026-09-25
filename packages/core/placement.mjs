// #641 (epic #616) -- the placement filter. Each verb of a requirement card (requirement-card.mjs, #640) is put through three
// fixed questions, in this order, and the answers decide where the code belongs:
//
//   1. Does it need a browser API (state, an effect, an event handler)?   YES -> a client leaf.
//   2. Does it touch a secret or a database?                              YES -> the server.
//   3. Does it change data on the backend?                                YES -> a mutation; NO -> a server read.
//   (no to 1 and 2: a presentational block, fed by props.)
//
// The answers are read off the card by the small rule tables below (data, not branches), never by a model. Each result is then
// mapped to the layers of the project (LAYER_TABLE), and the blocks compile to an ordinary plan.
//
//   placeCard(card, options)             card -> { blocks, open, notes, decisions, errors }; deterministic, pure.
//   resolvePlacementOpen(card, answers)  closed-question answers -> a NEW placement (typed errors, never a throw).
//   planFromBlocks(blocks, options)      blocks -> { ok, plan, decisions, files, proof, notes, errors }; the plan is checked by validatePlan.
//   checkPlacementImports(blocks, layers) the import-rule violations of a layer assignment (a page never imports a service).
//   blockSummary(result) / blockLines    the small fixed-size summary a person, an LLM and a decision model all receive.
//
// A case the tables cannot decide (a write with nothing to write to, a check the table does not know, a server check with no
// server block) is NOT guessed: it becomes an open question of 2-5 options in the shape of a chooser summary and of
// requirement-card.mjs's open questions, so a decision provider can suggest and a person confirms. Nothing here calls a model
// or the network; it imports only sibling modules (the card, the plan validator, the layer config, the flow blocks).
// Decision record and worked examples: docs/PLACEMENT.md.
import { CARD_LIMITS, defaultLexicon, validateCard } from './requirement-card.mjs';
import { DECISION_SOURCES } from './chooser.mjs';
import { DEFAULT_LAYERS, FRAMEWORKS } from './config.mjs';
import { LAYER_ORDER, LAYER_PREREQUISITES } from './generators.mjs';
import { validatePlan, PLAN_SHAPES } from './plan.mjs';
import { flowBlock } from './block-flows.mjs';
import { SHAPES, FORM_VERBS, singularOf, pluralOf, fieldsFromProperties, endpointOf } from './shapes.mjs';
import { DASHBOARD_WORDS } from './shape-dashboard.mjs';
import { DEFAULT_STEPS, WIZARD_WORDS, stepsOffer, STEPS_QUESTION_ID } from './shape-wizard.mjs';
import { detectPlaywright, PLAYWRIGHT_SHAPES } from './proof.mjs';
import { sourceOffer, operationOf, SOURCE_QUESTION_ID } from './shape-source.mjs';
import { routePathOf, routeOffer, syncTouches, dependencyOffer, ROUTE_QUESTION_ID, DEPENDENCY_QUESTION_ID, CONSTRUCT_CORE_PACKAGE } from './wiring.mjs';
import { secretsOfCard, envOffers, ENV_FILE } from './env.mjs';
import { verifyOffer, VERIFY_QUESTION_ID } from './verify.mjs';

/** The schema version string of a placement result. */
export const PLACEMENT_VERSION = 'placement.v1';

/**
 * The id of the closed question that offers the list shape (#619). It is stable, so an answer recorded once stays valid, and it
 * is asked at most once per card.
 */
export const SHAPE_QUESTION_ID = 'q-shape';

/**
 * The options of the shape question for a list card, `list` first so that the rules-only decision provider (the first enabled option)
 * suggests the list shape, which is the default for a plural data object. Nothing is applied until somebody answers: an
 * unanswered offer leaves the plan exactly as it was, with empty scaffold files. Kept for callers of the first shape; the offer of a
 * card is `SHAPE_OPTIONS_BY_SHAPE[shape]`.
 */
export const SHAPE_OPTIONS = Object.freeze([
  Object.freeze({ id: 'list', label: 'List shape', why: 'Real typed code: the list, its rows, and its loading, empty and error states.' }),
  Object.freeze({ id: 'scaffold', label: 'Scaffold only', why: 'Empty files with a TODO stub in each, for you to fill in.' }),
]);

const SCAFFOLD_OPTION = SHAPE_OPTIONS[1];

/**
 * The options of the shape question per card kind (#620, #626): a list read offers `list | scaffold`, a read of one item offers
 * `detail | scaffold`, a write with properties offers `form | scaffold`, a read worded as an overview (dashboard, overview, summary, report,
 * statistics) of one data object offers `dashboard | scaffold`, a flow worded as steps (wizard, steps, multi-step, step by step, signup, checkout,
 * onboarding) offers `wizard | scaffold`. The matching shape is always first, so it is the
 * rules-only default; every id is stable, so an answer recorded once stays valid.
 */
export const SHAPE_OPTIONS_BY_SHAPE = Object.freeze({
  list: SHAPE_OPTIONS,
  detail: Object.freeze([
    Object.freeze({ id: 'detail', label: 'Detail shape', why: 'Real typed code: one item by id, every field, and its loading, not-found and error states.' }),
    SCAFFOLD_OPTION,
  ]),
  form: Object.freeze([
    Object.freeze({ id: 'form', label: 'Form shape', why: 'Real typed code: an input per field, validation, a submit service, and its saving, saved and error states.' }),
    SCAFFOLD_OPTION,
  ]),
  dashboard: Object.freeze([
    Object.freeze({ id: 'dashboard', label: 'Dashboard shape', why: 'Real typed code: a titled overview with a row of tiles and panels from one typed summary, and its loading and error states.' }),
    SCAFFOLD_OPTION,
  ]),
  wizard: Object.freeze([
    Object.freeze({ id: 'wizard', label: 'Wizard shape', why: 'Real typed code: steps run by a state machine (next, back, submit, reset), a component per step, and a submit service.' }),
    SCAFFOLD_OPTION,
  ]),
});

/** The four results of the three questions. */
export const PLACEMENTS = Object.freeze(['client-leaf', 'server-read', 'mutation', 'presentational']);

/** Sizes fixed so a summary is always small. */
export const PLACEMENT_LIMITS = Object.freeze({ blocks: 8, verbs: 4, layers: 6, checks: 4, lines: 8, line: 140, why: 120, note: 160, notes: 3, question: 160, label: 60, options: 5 });

/** Every rejection placement can produce, by name, so callers and tests match on a code, not on text. */
export const PLACEMENT_ERROR_CODES = Object.freeze({
  PLACE_CARD_INVALID: 'PLACE_CARD_INVALID',
  PLACE_CARD_OPEN: 'PLACE_CARD_OPEN',
  PLACE_OPTIONS_INVALID: 'PLACE_OPTIONS_INVALID',
  PLACE_FRAMEWORK_UNKNOWN: 'PLACE_FRAMEWORK_UNKNOWN',
  PLACE_SCREEN_INVALID: 'PLACE_SCREEN_INVALID',
  PLACE_LAYER_MISSING: 'PLACE_LAYER_MISSING',
  PLACE_IMPORT_FORBIDDEN: 'PLACE_IMPORT_FORBIDDEN',
  PLACE_ANSWERS_INVALID: 'PLACE_ANSWERS_INVALID',
  PLACE_UNKNOWN_OPEN: 'PLACE_UNKNOWN_OPEN',
  PLACE_UNKNOWN_OPTION: 'PLACE_UNKNOWN_OPTION',
  PLACE_ATTRIBUTION_INVALID: 'PLACE_ATTRIBUTION_INVALID',
  PLAN_BLOCKS_INVALID: 'PLAN_BLOCKS_INVALID',
  PLAN_BLOCK_INVALID: 'PLAN_BLOCK_INVALID',
  PLAN_PLACEMENT_UNKNOWN: 'PLAN_PLACEMENT_UNKNOWN',
  PLAN_LAYER_INVALID: 'PLAN_LAYER_INVALID',
  PLAN_LAYER_UNSUPPORTED: 'PLAN_LAYER_UNSUPPORTED',
  PLAN_NAME_INVALID: 'PLAN_NAME_INVALID',
  PLAN_FEATURE_INVALID: 'PLAN_FEATURE_INVALID',
  PLAN_ROOT_REQUIRED: 'PLAN_ROOT_REQUIRED',
  PLAN_SOURCE_UNAVAILABLE: 'PLAN_SOURCE_UNAVAILABLE',
  PLAN_STEPS_UNAVAILABLE: 'PLAN_STEPS_UNAVAILABLE',
  PLAN_DECISIONS_INVALID: 'PLAN_DECISIONS_INVALID',
  PLAN_TOUCHES_UNKNOWN: 'PLAN_TOUCHES_UNKNOWN',
  PLAN_INVALID: 'PLAN_INVALID',
});

/**
 * @typedef {{ code: string, path: string, message: string }} PlacementError
 *
 * @typedef {{ browserApi: boolean, touchesSecretOrDb: boolean, changesBackend: boolean }} PlacementAnswers
 * The three answers, in the order the questions are asked.
 *
 * @typedef {{ layer: string, name: string, why: string, uses?: string[] }} PlacedLayer
 * One unit the block needs: its layer, its name, why, and the layers of the same block it imports (`uses`).
 *
 * @typedef {{ id: string, verbs: string[], nouns: string[], label: string, placement: 'client-leaf'|'server-read'|'mutation'|'presentational', answers: PlacementAnswers, layers: PlacedLayer[], checks: string[], checkNames: string[], why: string, shape?: BlockShape }} PlacementBlock
 *
 * @typedef {{ id: string, question: string, options: { id: string, label: string, enabled: boolean, why: string }[], chosen: string | null }} PlacementOpen
 * The same shape as a chooser summary and as a requirement-card open question.
 *
 * @typedef {{ question: string, option: string, by: 'person'|'llm'|'decision-model', provider?: string }} PlacementDecision
 * Who answered which open question.
 *
 * @typedef {{ name: 'list'|'detail'|'form'|'dashboard'|'wizard', entity: string, fields: string, steps?: string }} BlockShape
 * The shape a block was built with (#619): its name, the entity and the `--fields` text the units are generated from.
 *
 * @typedef {PlacementOpen & { block: string, shape: 'list'|'detail'|'form'|'dashboard'|'wizard', default: string, entity: string, fields: string, steps?: string, unit: string, suggestion: { option: string, reason: string, provider: 'rules' } }} PlacementOffer
 * A question that changes how a screen is built but never blocks the plan: the chooser-summary shape plus the block it is about,
 * the rules-only default, and the entity and fields the shape would use. Unanswered, the plan is the plain scaffold.
 *
 * @typedef {{ version: string, ok: boolean, complete: boolean, framework: string, variant: string, blocks: PlacementBlock[], open: PlacementOpen[], offers: PlacementOffer[], notes: string[], decisions: PlacementDecision[], errors: PlacementError[] }} PlacementResult
 */

const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const isNonEmptyString = (v) => typeof v === 'string' && v.trim().length > 0;
const asList = (v) => (Array.isArray(v) ? v : [v]);
const deepFreeze = (value) => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze(value[key]);
  }
  return value;
};

// ------------------------------------------------------------------------------------------------------------------ the rules

/** The three questions, in the order they are asked. */
export const PLACEMENT_QUESTIONS = deepFreeze([
  { id: 'browserApi', ask: 'Does it need a browser API (state, an effect, an event handler)?', yes: 'client leaf' },
  { id: 'touchesSecretOrDb', ask: 'Does it touch a secret or a database?', yes: 'server' },
  { id: 'changesBackend', ask: 'Does it change data on the backend?', yes: 'mutation', no: 'server read' },
]);

/**
 * The rule tables: one list of rules per question. A rule fires when EVERY condition of its `when` holds for a verb:
 * `verb` (the verb's kind is one of these), `target` (some noun the verb acts on has one of these kinds, and the `property`
 * when given), `session` (the card has a state noun carrying the property "session"), `check` (the card carries one of these
 * named checks). One firing rule answers its question "yes"; `why` is the reason shown to a person.
 */
export const ANSWER_RULES = deepFreeze({
  browserApi: [
    { when: { verb: 'interact' }, why: 'the person acts on the screen, which is an event handler in the browser' },
    { when: { target: 'ui-part', property: 'interactive' }, why: 'it works through an interactive part of the screen' },
  ],
  touchesSecretOrDb: [
    { when: { target: 'external' }, why: 'an outside service needs a secret that must stay on the server' },
    { when: { verb: 'write', target: 'entity' }, why: 'a stored data object is written to a database' },
    { when: { verb: 'read', target: 'entity', session: true }, why: 'data behind a signed-in session lives in a database' },
    { when: { verb: ['read', 'write'], target: 'entity', check: ['auth-session-check', 'server-only-secret', 'owner-only-access'] }, why: 'a server-side check guards this data' },
  ],
  changesBackend: [
    { when: { verb: 'write' }, why: 'a write verb changes stored data' },
  ],
});

/** Cases the rules cannot decide: a verb matching `when` becomes a closed question, never a guess. */
export const AMBIGUITY_RULES = deepFreeze([
  {
    id: 'write-no-target',
    when: { verb: 'write', noTarget: ['entity', 'external'] },
    question: 'What does "{text}" change?',
    options: [
      { id: 'mutation', label: 'Stored data on the server', why: 'A server action or write endpoint changes it.' },
      { id: 'client-leaf', label: 'Only what the screen holds', why: 'Browser state; nothing is saved on the backend.' },
    ],
  },
]);

/**
 * The named checks of the lexicon and where each applies: `appliesTo` (the placements whose blocks carry it) and `server`
 * (it needs code on the server, so a card with such a check and no server block is a contradiction, asked as a question).
 */
export const CHECK_RULES = deepFreeze({
  'auth-session-check': { appliesTo: ['server-read', 'mutation'], server: true },
  'server-only-secret': { appliesTo: ['server-read', 'mutation'], server: true },
  'validated-redirect': { appliesTo: ['mutation'], server: true },
  'owner-only-access': { appliesTo: ['server-read', 'mutation'], server: true },
  'latency-budget': { appliesTo: ['client-leaf', 'server-read', 'mutation', 'presentational'], server: false },
  'retry-and-error-state': { appliesTo: ['client-leaf', 'server-read', 'mutation'], server: false },
  'accessibility-check': { appliesTo: ['client-leaf', 'presentational'], server: false },
});

const UNKNOWN_CHECK_QUESTION = {
  question: 'Which blocks does "{text}" apply to?',
  options: [
    { id: 'server-blocks', label: 'The server blocks', why: 'Server reads and mutations carry it.', appliesTo: ['server-read', 'mutation'] },
    { id: 'screen-blocks', label: 'The screen blocks', why: 'Client leaves and presentational blocks carry it.', appliesTo: ['client-leaf', 'presentational'] },
    { id: 'every-block', label: 'Every block', why: 'All four kinds of block carry it.', appliesTo: ['client-leaf', 'server-read', 'mutation', 'presentational'] },
  ],
};

const SERVER_CHECK_QUESTION = {
  id: 'q-server',
  question: 'The checks {text} need code on the server. Where does it run?',
  options: [
    { id: 'mutation', label: 'A server action behind the interaction', why: 'The check guards a write the person triggers.' },
    { id: 'server-read', label: 'A server fetch before the screen shows', why: 'The check guards data fetched for the screen.' },
  ],
};

// ------------------------------------------------------------------------------------------------------------- layer table

/**
 * One row per placement, mapping it to this project's layers, for two variants. `default` is a project with no Server
 * Components or Server Actions (framework `react-spa`): a server read is a service called from a hook in the browser.
 * `app-router` (framework `nextjs`) is Next.js App Router: a client leaf is a "use client" leaf, a server read a Server
 * Component fetch, a mutation a Server Action. A row lists its units: `layer`, `name` (how the unit is named: `noun`
 * the data it works on, `action` the verb plus that noun, `screen` the screen the units are wired into), `uses` (the
 * layers of the same row it imports) and `why`. Every `uses` pair obeys `DEFAULT_LAYERS.canImport` (a test asserts it).
 */
export const LAYER_TABLE = deepFreeze({
  default: {
    'client-leaf': [
      { layer: 'hook', name: 'action', uses: [], why: 'Holds the state, effect or event handler the browser needs.' },
      { layer: 'controller', name: 'screen', uses: ['hook'], why: 'Wires the hook to the page; no logic of its own.' },
    ],
    'server-read': [
      { layer: 'domain', name: 'noun', uses: [], why: 'The shape of the data the screen shows.' },
      { layer: 'service', name: 'noun', uses: ['domain'], why: 'Owns the fetch, the external effect.' },
      { layer: 'hook', name: 'noun', uses: ['service', 'domain'], why: 'Runs the fetch in the browser: this project has no Server Components.' },
      { layer: 'controller', name: 'screen', uses: ['hook'], why: 'Wires the fetch hook to the page; no logic of its own.' },
    ],
    mutation: [
      { layer: 'service', name: 'action', uses: [], why: 'Owns the write, the external effect.' },
      { layer: 'workflow', name: 'action', uses: ['service'], why: 'The states of the write (idle, saving, saved, failed).' },
    ],
    presentational: [
      { layer: 'component', name: 'noun', uses: [], why: 'Shows the data from props; no data access.' },
      { layer: 'page', name: 'screen', uses: ['component'], why: 'Composes the components from props; imports no service.' },
    ],
  },
  variants: {
    'app-router': {
      'client-leaf': [
        { layer: 'hook', name: 'action', uses: [], why: 'Holds the state, effect or event handler of a "use client" leaf.' },
        { layer: 'controller', name: 'screen', uses: ['hook'], why: 'Wires the "use client" leaf to the page; no logic of its own.' },
      ],
      'server-read': [
        { layer: 'domain', name: 'noun', uses: [], why: 'The shape of the data the Server Component fetches.' },
        { layer: 'service', name: 'noun', uses: ['domain'], why: 'Owns the server-side fetch; the secret stays here.' },
        { layer: 'controller', name: 'screen', uses: ['service', 'domain'], why: 'The Server Component: awaits the fetch and renders the page.' },
      ],
      mutation: [
        { layer: 'service', name: 'action', uses: [], why: 'Owns the write: the Server Action body; the secret stays here.' },
        { layer: 'workflow', name: 'action', uses: ['service'], why: 'The states of the Server Action call (idle, pending, done, failed).' },
      ],
    },
  },
});

/** The layer-table variant each framework uses. */
export const VARIANT_OF_FRAMEWORK = Object.freeze({ nextjs: 'app-router', 'react-spa': 'default' });

const VARIANT_NOTES = deepFreeze({
  'app-router': [
    'App Router: a client leaf is a "use client" leaf, a server read a Server Component fetch, a mutation a Server Action. The generators do not write the "use client" and "use server" directives yet: add them by hand.',
    'The route entry (app/**/page.tsx) is not created by a plan step: it imports the controller (by hand or with `construct import --route`).',
  ],
  default: [
    'This project has no Server Components or Server Actions (framework react-spa): a server read is a service call made from a hook in the browser and a mutation is a service call to a write endpoint. A secret must stay behind that endpoint, never in the bundle.',
    'The route entry (src/App.tsx) is not created by a plan step: add the controller to its route table by hand.',
  ],
});

/** What each placement means, in the words of the three questions (a block's `why` and the phrase of its plain-English line). */
/** The phrase of a block built with a shape (#619, #620, #626), by shape and placement: a list or one item is fetched by a service in the browser and shown from props; a form submits through a service. */
const SHAPE_PHRASE = deepFreeze({
  list: { 'server-read': 'is a list fetched by a service', presentational: 'shows that list from props' },
  detail: { 'server-read': 'is one item fetched by id by a service', presentational: 'shows that item from props' },
  form: { mutation: 'is a form that submits through a service', presentational: 'shows that form from props' },
  dashboard: { 'server-read': 'is an overview fetched by a service', presentational: 'shows that overview from props' },
  wizard: { mutation: 'is a step-by-step flow run by a state machine', presentational: 'shows the step the machine is in, from props' },
});

const PLACEMENT_TEXT = deepFreeze({
  'client-leaf': { why: 'Client leaf: needs the browser.', line: 'runs in the browser' },
  'server-read': { why: 'Server read: fetched on the server, changes nothing.', line: 'is fetched on the server' },
  mutation: { why: 'Mutation: changes backend data on the server.', line: 'changes data on the backend' },
  presentational: { why: 'Presentational: shown from props.', line: 'is shown from props' },
});

// ------------------------------------------------------------------------------------------------------------------ evaluation

const propsOf = (noun) => noun.properties ?? [];

/** The nouns of `when` that made a rule fire, or null when a condition fails. */
function fires(when, ctx) {
  const used = [];
  if (when.verb && !asList(when.verb).includes(ctx.verb.kind)) return null;
  if (when.target) {
    const hits = ctx.targets.filter((n) => asList(when.target).includes(n.kind) && (!when.property || propsOf(n).includes(when.property)));
    if (!hits.length) return null;
    used.push(...hits);
  }
  if (when.noTarget && ctx.targets.some((n) => asList(when.noTarget).includes(n.kind))) return null;
  if (when.session) {
    if (!ctx.sessions.length) return null;
    used.push(...ctx.sessions);
  }
  if (when.check && !ctx.card.checks.some((c) => asList(when.check).includes(c.name))) return null;
  return used;
}

/** The three answers for one verb, with the reasons and nouns that decided each. */
function answerVerb(card, verb) {
  const byId = new Map(card.nouns.map((n) => [n.id, n]));
  const ctx = { card, verb, targets: verb.on.map((id) => byId.get(id)).filter(Boolean), sessions: card.nouns.filter((n) => n.kind === 'state' && propsOf(n).includes('session')) };
  const answers = {};
  const reasons = {};
  const nouns = new Set(ctx.targets.map((n) => n.id));
  for (const { id } of PLACEMENT_QUESTIONS) {
    const hits = ANSWER_RULES[id].map((rule) => ({ rule, used: fires(rule.when, ctx) })).filter((h) => h.used);
    answers[id] = hits.length > 0;
    reasons[id] = hits.map((h) => h.rule.why);
    if (id === 'touchesSecretOrDb') for (const h of hits) for (const n of h.used) if (n.kind === 'state') nouns.add(n.id);
  }
  const ambiguity = AMBIGUITY_RULES.find((rule) => fires(rule.when, ctx));
  return { ctx, answers, reasons, nouns, ambiguity };
}

/**
 * The placement the three answers cascade to, in question order: a browser API means a client leaf, else a secret or
 * database means a mutation (when it changes data) or a server read, else presentational.
 *
 * @param {PlacementAnswers} answers The three answers of one verb.
 * @returns {'client-leaf'|'server-read'|'mutation'|'presentational'} The placement.
 *
 * @example
 * placementOf({ browserApi: false, touchesSecretOrDb: true, changesBackend: true }); // => 'mutation'
 */
export function placementOf(answers) {
  if (answers.browserApi) return 'client-leaf';
  if (answers.touchesSecretOrDb) return answers.changesBackend ? 'mutation' : 'server-read';
  return 'presentational';
}

const words = (text) => String(text).split(/[^A-Za-z0-9]+/).filter(Boolean);
const pascal = (text) => {
  const out = words(text).map((w) => w[0].toUpperCase() + w.slice(1)).join('');
  return /^[A-Za-z]/.test(out) ? out : `X${out}`;
};

/** A noun as a unit name: modifiers such as "current" are dropped (`current subscription plan` is `SubscriptionPlan`). */
function nounName(text, modifiers) {
  const kept = words(text).filter((w) => !modifiers.has(w.toLowerCase()));
  return pascal((kept.length ? kept : words(text)).join(' '));
}

const KIND_RANK = { entity: 0, external: 1, 'ui-part': 2, state: 3 };
const primaryNoun = (nouns) => [...nouns].sort((a, b) => KIND_RANK[a.kind] - KIND_RANK[b.kind])[0];

const capText = (text, max) => {
  const clean = String(text ?? '').replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
};
const idOrder = (a, b) => Number(a.slice(1)) - Number(b.slice(1)) || a.localeCompare(b);

/** The screen name: an explicit one, else the first data object of the card without its modifiers, else `Screen`. */
function screenName(card, modifiers) {
  const noun = card.nouns.find((n) => n.kind === 'entity') ?? card.nouns.find((n) => n.kind === 'external');
  return noun ? nounName(noun.text, modifiers) : 'Screen';
}

/** The variant table row of a placement, with unit names resolved. */
function layersFor(table, placement, names) {
  return table[placement].map((row) => ({ layer: row.layer, name: names[row.name], why: row.why, ...(row.uses.length ? { uses: [...row.uses] } : {}) }));
}

const isAnswerObject = (v) => isPlainObject(v) && typeof v.option === 'string';

/** Who answered: a bare option id means `by` (default person); `{ option, by?, provider? }` attributes one answer. */
function readAnswer(raw, ctx, at, push) {
  const answer = isAnswerObject(raw) ? raw : { option: raw };
  const by = answer.by ?? ctx.by ?? 'person';
  const provider = answer.provider ?? ctx.provider;
  if (!DECISION_SOURCES.includes(by) || (provider !== undefined && !isNonEmptyString(provider))) {
    push('PLACE_ATTRIBUTION_INVALID', at, `"by" must be one of: ${DECISION_SOURCES.join(', ')}, and "provider" a non-empty string.`);
    return null;
  }
  return { option: answer.option, by, provider };
}

// -------------------------------------------------------------------------------------------------------------- list shape

/**
 * Whether a data object is named in the plural, by the lexicon alone: the words are not an entry as written (`billing details`
 * is one entry, not several) and the singular of the last word is (`products` is the entry `product`).
 */
function isPluralEntity(text, entities, modifiers) {
  const parts = words(text.toLowerCase()).filter((w) => !modifiers.has(w));
  if (!parts.length || Object.hasOwn(entities, parts.join(' '))) return false;
  const last = parts.at(-1);
  const singulars = [];
  if (/[^aeiou]ies$/.test(last)) singulars.push(`${last.slice(0, -3)}y`);
  if (/(?:s|x|z|ch|sh)es$/.test(last)) singulars.push(last.slice(0, -2));
  if (/s$/.test(last)) singulars.push(last.slice(0, -1));
  return singulars.some((s) => Object.hasOwn(entities, [...parts.slice(0, -1), s].join(' ')));
}

/**
 * The one list the card asks for, or null. The rule (data, not a guess): every block is presentational or a server read, the
 * card has exactly one verb (a read) and exactly one data object, that object is named in the plural, and the screen is named
 * after it. Anything richer (a search, a write, two data objects) is not offered the list shape.
 */
function listCandidate(card, blocks, screen, modifiers, entities) {
  if (!blocks.length || !blocks.every((b) => b.placement === 'presentational' || b.placement === 'server-read')) return null;
  const nouns = card.nouns.filter((n) => n.kind === 'entity');
  const [verb] = card.verbs;
  if (nouns.length !== 1 || card.verbs.length !== 1 || verb.kind !== 'read' || !verb.on.includes(nouns[0].id)) return null;
  const [noun] = nouns;
  if (!isPluralEntity(noun.text, entities, modifiers) || nounName(noun.text, modifiers) !== screen) return null;
  return { shape: 'list', noun, verb, entity: singularOf(screen), fields: fieldsFromProperties(noun.properties), unit: screen };
}

const POSSESSIVE_BEFORE = /\b(?:their|his|her|my|our|your|its)\s+$/i;

/**
 * The one item the card asks to see, or null (#620). The rule (data, not a guess): every block is presentational or a server read, the
 * card has exactly one verb (a read) and exactly one data object, that object is named in the singular, the screen is named after
 * it, and it is not "the person's own" (a possessive before it, or "current": those are found from the session, not by an id).
 */
function detailCandidate(card, blocks, screen, modifiers, entities) {
  if (!blocks.length || !blocks.every((b) => b.placement === 'presentational' || b.placement === 'server-read')) return null;
  const nouns = card.nouns.filter((n) => n.kind === 'entity');
  const [verb] = card.verbs;
  if (nouns.length !== 1 || card.verbs.length !== 1 || verb.kind !== 'read' || !verb.on.includes(nouns[0].id)) return null;
  const [noun] = nouns;
  if (isPluralEntity(noun.text, entities, modifiers) || nounName(noun.text, modifiers) !== screen) return null;
  if (words(noun.text.toLowerCase()).includes('current') || POSSESSIVE_BEFORE.test(String(card.source?.text ?? '').slice(0, noun.span[0]))) return null;
  if (card.nouns.some((n) => n.kind === 'ui-part' && ['list', 'table'].includes(n.text.toLowerCase()))) return null; // "the invoice list" is many, not one
  return { shape: 'detail', noun, verb, entity: screen, fields: fieldsFromProperties(noun.properties), unit: screen };
}

/** The base form of a write verb the form shape knows (`adds` and `added` are `add`), or null. */
function formVerbOf(text) {
  const low = String(text).toLowerCase();
  const forms = [low, low.replace(/s$/, ''), low.replace(/es$/, ''), low.replace(/ies$/, 'y'), low.replace(/ing$/, ''), low.replace(/ing$/, 'e'), low.replace(/ed$/, ''), low.replace(/d$/, '')];
  return forms.find((f) => FORM_VERBS.includes(f)) ?? null;
}

const capFirst = (text) => text.charAt(0).toUpperCase() + text.slice(1);

/**
 * The one form the card asks for, or null (#626). The rule (data, not a guess): the only block is a mutation, the card has exactly one
 * verb (a write: create, add, submit, save, register or update), and exactly one data object that has properties, named in the singular
 * and the target of that verb. The unit is named for the verb and the object (`AddProduct`).
 */
function formCandidate(card, blocks, screen, modifiers, entities) {
  if (blocks.length !== 1 || blocks[0].placement !== 'mutation') return null;
  const nouns = card.nouns.filter((n) => n.kind === 'entity');
  const [verb] = card.verbs;
  if (nouns.length !== 1 || card.verbs.length !== 1 || verb.kind !== 'write' || !verb.on.includes(nouns[0].id)) return null;
  const [noun] = nouns;
  const base = formVerbOf(verb.text);
  if (!base || !noun.properties?.length || isPluralEntity(noun.text, entities, modifiers) || nounName(noun.text, modifiers) !== screen) return null;
  return { shape: 'form', noun, verb, entity: screen, fields: fieldsFromProperties(noun.properties), unit: `${capFirst(base)}${screen}` };
}

/** The ui-part words that name the screen or a part of it rather than something to measure (`list`, `wizard`): they never become a field of a dashboard. */
const NOT_A_MEASURE = new Set(['list', 'table', 'detail', 'page', 'card', 'dialog', 'form', 'wizard', 'step', 'steps', 'multi-step', 'step by step', ...DASHBOARD_WORDS]);

/** The field name a ui-part word stands for on a dashboard: a single lower-case word, singular (`totals` is `total`), or null. */
function measureOf(noun) {
  const word = noun.text.toLowerCase();
  if (noun.kind !== 'ui-part' || noun.properties?.includes('interactive') || NOT_A_MEASURE.has(word) || !/^[a-z]+$/.test(word)) return null;
  return /s$/.test(word) && !/(?:ss|us|is)$/.test(word) ? word.slice(0, -1) : word;
}

/**
 * The one overview the card asks for, or null (#627). The rule (data, not a guess): every block is presentational or a server read, every verb is
 * a read, one of them is worded as an overview (`overview`, `dashboard`, `summary`, `report`, `statistics`) and acts on the one data object of the
 * card. The screen is `<Object>Dashboard`; its fields are the object's properties and the measures the card names (`with totals` is a `total`).
 */
function dashboardCandidate(card, blocks, screen, modifiers, entities) {
  if (!blocks.length || !blocks.every((b) => b.placement === 'presentational' || b.placement === 'server-read')) return null;
  const nouns = card.nouns.filter((n) => n.kind === 'entity');
  if (nouns.length !== 1 || !card.verbs.length || card.verbs.some((v) => v.kind !== 'read')) return null;
  const [noun] = nouns;
  const verb = card.verbs.find((v) => DASHBOARD_WORDS.includes(v.text.toLowerCase()) && v.on.includes(noun.id));
  if (!verb || nounName(noun.text, modifiers) !== screen) return null;
  const measures = card.nouns.map(measureOf).filter(Boolean);
  return { shape: 'dashboard', noun, verb, entity: isPluralEntity(noun.text, entities, modifiers) ? singularOf(screen) : screen, fields: fieldsFromProperties([...(noun.properties ?? []), ...measures]), unit: `${screen}Dashboard` };
}

/** The verbs that are a flow in themselves: a person signs up, checks out or is onboarded step by step. Their name is the screen (`Signup`). */
const FLOW_VERBS = new Set(['signup', 'checkout', 'onboard', 'onboarding']);

/**
 * The one step-by-step flow the card asks for, or null (#628). The rule (data, not a guess): the card has exactly one verb (an interaction or a
 * write), and it or a part of the screen it names is a wizard word (`wizard`, `step`, `multi-step`, `step by step`, `signup`, `checkout`,
 * `onboarding`), and the card has at most one data object. A verb that is a flow in itself (`signup`) names the screen (`Signup`); another
 * write verb needs its data object and names it like a form does (`AddProduct`). The steps are the default ones (`details,review,done`).
 */
function wizardCandidate(card, blocks, screen, modifiers, entities) {
  if (!blocks.length || card.verbs.length !== 1) return null;
  const [verb] = card.verbs;
  if (verb.kind !== 'interact' && verb.kind !== 'write') return null;
  const nouns = card.nouns.filter((n) => n.kind === 'entity');
  if (nouns.length > 1) return null;
  const asked = [verb.text, ...card.nouns.filter((n) => n.kind === 'ui-part').map((n) => n.text)].map((w) => w.toLowerCase());
  if (!asked.some((w) => WIZARD_WORDS.includes(w))) return null;
  const [noun] = nouns;
  const flow = FLOW_VERBS.has(verb.text.toLowerCase());
  const base = formVerbOf(verb.text);
  if (!flow && (!base || !noun)) return null;
  if (noun && isPluralEntity(noun.text, entities, modifiers)) return null;
  const unit = flow ? pascal(verb.text) : `${capFirst(base)}${nounName(noun.text, modifiers)}`;
  const entity = noun ? nounName(noun.text, modifiers) : unit;
  return { shape: 'wizard', noun: noun ?? verb, verb, entity, fields: fieldsFromProperties(noun?.properties), steps: DEFAULT_STEPS, unit };
}

/** The screen shape a card is offered, by fixed rules, or null: an overview, a step-by-step flow, a list, one item, or a form. Never more than one shape per card. */
function shapeCandidate(card, blocks, screen, modifiers, entities) {
  return dashboardCandidate(card, blocks, screen, modifiers, entities) ?? wizardCandidate(card, blocks, screen, modifiers, entities) ?? listCandidate(card, blocks, screen, modifiers, entities) ?? detailCandidate(card, blocks, screen, modifiers, entities) ?? formCandidate(card, blocks, screen, modifiers, entities);
}

const SHAPE_REASON = {
  list: (c) => `the data object "${c.noun.text}" is plural, so a list of ${c.entity} items is the usual screen`,
  detail: (c) => `the data object "${c.noun.text}" is one item that is only read, so its details by id are the usual screen`,
  form: (c) => `"${c.verb.text}" writes the data object "${c.noun.text}", which has properties, so a form with a field for each is the usual screen`,
  dashboard: (c) => `"${c.verb.text}" reads the data object "${c.noun.text}" as an overview, so tiles and panels from one summary are the usual screen`,
  wizard: (c) => `"${c.verb.text}" is asked for step by step, so a state machine with a step per screen is the usual flow`,
};

/** What a shaped screen needs from the person, as the note of the plan: the endpoint the generated service calls, and how the detail screen gets its id. */
const SHAPE_NOTE = {
  list: (c) => `The list shape reads its rows through a service: choose where they come from (q-source: a local store, the endpoint ${endpointOf(c.unit)}, or an OpenAPI operation).`,
  detail: (c) => `The detail shape reads one item by id through a service: choose where it comes from (q-source: a local store, the endpoint ${endpointOf(pluralOf(c.entity))}/<id>, or an OpenAPI operation). The id is the controller's id prop, else ?id= of the address.`,
  form: (c) => `The form shape submits the typed values through a service: choose where they go (q-source: a local store, POST ${endpointOf(pluralOf(c.entity))}, or an OpenAPI operation).`,
  wizard: (c) => `The wizard shape runs ${c.steps.split(',').length} steps (${c.steps}; --steps changes them) with an XState machine in the workflow layer (the project needs "xstate", which construct init adds) and submits the typed values through a service: choose where they go (q-source: a local store, POST ${endpointOf(pluralOf(c.entity))}, or an OpenAPI operation).`,
  dashboard: (c) => `The dashboard shape reads one typed summary through a service: choose where it comes from (q-source: a local store, the endpoint ${endpointOf(pluralOf(c.entity))}/summary, or an OpenAPI operation GET on a path ending in /${pluralOf(c.entity).toLowerCase()}/summary).`,
};

/** What the plan says about the data source each shaped screen got (#621): where it reads from, and what is left to do by hand. */
const SOURCE_NOTE = {
  local: ({ name }) => `The ${name} screen reads a typed in-memory store (seed rows in domain/${name}Store.domain.ts), so it works with no backend. There is no browser flow for it: a local source makes no request to mock. Replace the store with a real source when there is one.`,
  endpoint: ({ name, endpoint, verb }) => `The ${name} screen calls ${verb} ${endpoint}; that endpoint must exist in your app (a route handler or your backend), nothing in this plan creates it.`,
  openapi: ({ name, operation, verb }) => `The ${name} screen requests ${operation?.method ?? verb} ${operation?.url ?? ''}, the path of an operation in ${operation?.file ?? 'the OpenAPI file'}; the server behind that spec must serve it.`,
};

/** The shape question for a candidate, in the shape of a chooser summary, with the rules-only default and who suggested it. */
function shapeOffer(candidate, blockId, chosen) {
  const L = PLACEMENT_LIMITS;
  const options = SHAPE_OPTIONS_BY_SHAPE[candidate.shape];
  return {
    id: SHAPE_QUESTION_ID,
    question: capText(`How should the "${candidate.noun.text}" screen be built?`, L.question),
    options: options.map((o) => ({ id: o.id, label: capText(o.label, L.label), enabled: true, why: capText(o.why, L.why) })),
    chosen,
    block: blockId,
    shape: candidate.shape,
    default: candidate.shape,
    entity: candidate.entity,
    fields: candidate.fields,
    ...(candidate.steps ? { steps: candidate.steps } : {}),
    unit: candidate.unit,
    suggestion: { option: candidate.shape, reason: capText(SHAPE_REASON[candidate.shape](candidate), L.why), provider: 'rules' },
  };
}

const SHAPE_BLOCK_WHY = {
  list: (names) => ({ read: `List shape: the ${names.noun} list is fetched by a service and shown from props. Because the person asked for a list of a plural data object.`, view: 'List shape: it shows what the list fetch returns.' }),
  detail: (names, offer) => ({ read: `Detail shape: one ${offer.entity} is fetched by id by a service and shown from props. Because the person asked to see one data object.`, view: 'Detail shape: it shows what the item fetch returns.' }),
  form: (names, offer) => ({ read: `Form shape: the ${offer.entity} is validated in a domain unit and submitted by a service. Because the person asked to write a data object that has properties.`, view: 'Form shape: it shows the form and what its submit answers.' }),
  wizard: (names, offer) => ({ read: `Wizard shape: the ${offer.entity} is entered step by step (${offer.steps}), run by a state machine, and submitted by a service. Because the person asked for a step-by-step flow.`, view: 'Wizard shape: it shows the step the machine is in.' }),
  dashboard: (names, offer) => ({ read: `Dashboard shape: the ${offer.entity} summary is fetched by a service and turned into tiles and panels. Because the person asked for an overview of a data object.`, view: 'Dashboard shape: it shows the tiles and panels of the summary.' }),
};

/** The units of a wizard's first block: its domain (steps, validity, typed input), its submit service, its state machine (the workflow layer), the hook that runs the machine, and the controller. Same shape as a `LAYER_TABLE` row. */
const WIZARD_TABLE = deepFreeze({
  'server-read': [
    { layer: 'domain', name: 'noun', uses: [], why: 'The steps, what each step needs to be valid, and the typed values.' },
    { layer: 'service', name: 'noun', uses: ['domain'], why: 'Owns the submit, the external effect.' },
    { layer: 'workflow', name: 'noun', uses: ['domain'], why: 'The state machine of the steps: next, back, submit, reset.' },
    { layer: 'hook', name: 'noun', uses: ['workflow', 'service', 'domain'], why: 'Runs the machine in the browser and calls the submit service.' },
    { layer: 'controller', name: 'screen', uses: ['hook'], why: 'Wires the machine hook to the page; no logic of its own.' },
  ],
});

/**
 * The blocks of a shaped screen: the read or the write that reaches the server (domain, service, hook, controller) and the
 * presentational block that shows it (component, page), from the default layer table whatever the framework (a shape fetches or
 * submits in the browser). The first block keeps the id, the verbs, the nouns and the checks of the block it replaces. The
 * `list` and `detail` shapes fetch, so their first block is a server read; the `form` shape submits, so its first block is a mutation.
 */
function shapeBlocks(first, offer, table, names) {
  const shape = { name: offer.shape, entity: offer.entity, fields: offer.fields, ...(offer.steps ? { steps: offer.steps } : {}) };
  const submits = offer.shape === 'form' || offer.shape === 'wizard';
  const why = SHAPE_BLOCK_WHY[offer.shape](names, offer);
  const layers = layersFor(offer.shape === 'wizard' ? WIZARD_TABLE : table, 'server-read', names);
  const read = { ...first, placement: submits ? 'mutation' : 'server-read', answers: { browserApi: false, touchesSecretOrDb: true, changesBackend: submits }, layers, shape, why: why.read };
  const view = { ...first, id: `${first.id}-view`, placement: 'presentational', answers: { browserApi: false, touchesSecretOrDb: false, changesBackend: false }, layers: layersFor(table, 'presentational', names), checks: [], checkNames: [], shape, why: why.view };
  return [read, view];
}

// ------------------------------------------------------------------------------------------------------------------- placeCard

/**
 * Place every verb of a requirement card by the three questions and assign each block to the project's layers.
 * Deterministic and pure: the same card, options and answers always give the same result, byte for byte. Each verb becomes a
 * block (a read that is fetched on the server also gets a presentational companion `<id>-view` that shows it, and a write
 * that needs the browser also gets a mutation block `<id>-write`); the named checks attach to the blocks they apply to
 * (`CHECK_RULES`). A case the rules cannot decide is listed in `open` as a closed question and its block is left out until
 * it is answered; nothing is guessed. `answers` re-applies earlier answers (see `resolvePlacementOpen`). The layer
 * assignment is checked against `layers[...].canImport` (a violation is a typed error). Never throws.
 *
 * @param {import('./requirement-card.mjs').RequirementCard} card A valid card with no open questions of its own.
 * @param {{ layers?: Record<string, { canImport: string[] }>, framework?: 'nextjs'|'react-spa', screen?: string, lexicon?: object, answers?: Record<string, string | { option: string, by?: string, provider?: string }>, by?: 'person'|'llm'|'decision-model', provider?: string }} [options]
 *   `layers` (default: the default layer graph), `framework` (default `nextjs`, i.e. App Router), `screen` (the page and
 *   controller name; default: the first data object), `answers` keyed by open question id, and the default attribution.
 * @returns {PlacementResult} The blocks, the open questions, the notes for the variant, who answered what, and typed errors.
 *
 * @example
 * const { card } = parseRequirement('A customer wants to search products with instant keyboard filtering.');
 * placeCard(card).blocks.map((b) => `${b.label}: ${b.placement}`); // => ['search products: presentational', 'filtering products keyboard: client-leaf']
 */
export function placeCard(card, options = {}) {
  const errors = [];
  const push = (code, path, message) => errors.push({ code: PLACEMENT_ERROR_CODES[code], path, message });
  const opts = isPlainObject(options) ? options : {};
  const framework = opts.framework ?? 'nextjs';
  const variant = VARIANT_OF_FRAMEWORK[framework];
  const result = (extra = {}) => ({ version: PLACEMENT_VERSION, ok: errors.length === 0, complete: false, framework: String(framework), variant: variant ?? 'unknown', blocks: [], open: [], offers: [], notes: [], decisions: [], errors, ...extra });
  if (!isPlainObject(options)) push('PLACE_OPTIONS_INVALID', 'options', 'options must be an object.');
  if (!variant || !FRAMEWORKS.includes(framework)) push('PLACE_FRAMEWORK_UNKNOWN', 'framework', `Unknown framework ${JSON.stringify(framework)}. Expected one of: ${Object.keys(VARIANT_OF_FRAMEWORK).join(', ')}.`);
  if (opts.screen !== undefined && (typeof opts.screen !== 'string' || !/^[A-Z][A-Za-z0-9]*$/.test(opts.screen))) push('PLACE_SCREEN_INVALID', 'screen', '"screen" must be a PascalCase name such as Billing.');
  if (opts.answers !== undefined && !isPlainObject(opts.answers)) push('PLACE_ANSWERS_INVALID', 'answers', 'answers must be an object { openId: optionId }.');
  const layers = opts.layers ?? DEFAULT_LAYERS;
  if (!isPlainObject(layers)) push('PLACE_OPTIONS_INVALID', 'layers', 'layers must be the layer graph of a project (config.layers).');
  const lexicon = opts.lexicon ?? defaultLexicon();
  const checked = validateCard(card, { lexicon });
  if (!checked.valid) for (const e of checked.errors) push('PLACE_CARD_INVALID', e.path, `${e.code}: ${e.message}`);
  else if (card.open.length) push('PLACE_CARD_OPEN', 'open', `The card still has open questions (${card.open.map((o) => o.id).join(', ')}): answer them with resolveOpen first.`);
  if (errors.length) return result();

  const modifiers = new Set(lexicon.modifiers);
  const screen = opts.screen ?? screenName(card, modifiers);
  const table = { ...LAYER_TABLE.default, ...(LAYER_TABLE.variants[variant] ?? {}) };
  const answers = isPlainObject(opts.answers) ? opts.answers : {};
  const askable = new Map();
  const decisions = [];
  const open = [];

  /** Raise a question: answered ones go to `decisions`, unanswered ones to `open`; returns the chosen option id or null. */
  const ask = (id, text, questionOptions) => {
    askable.set(id, questionOptions.map((o) => o.id));
    const question = { id, question: capText(text, PLACEMENT_LIMITS.question), options: questionOptions.map((o) => ({ id: o.id, label: capText(o.label, PLACEMENT_LIMITS.label), enabled: true, why: capText(o.why, PLACEMENT_LIMITS.why) })), chosen: null };
    if (!(id in answers)) { open.push(question); return null; }
    const given = readAnswer(answers[id], opts, `answers.${id}`, push);
    if (!given) return null;
    if (!questionOptions.some((o) => o.id === given.option)) { push('PLACE_UNKNOWN_OPTION', `answers.${id}`, `"${id}" has no option ${JSON.stringify(given.option)}. Options: ${questionOptions.map((o) => o.id).join(', ')}.`); return null; }
    decisions.push({ question: id, option: given.option, by: given.by, ...(given.provider ? { provider: given.provider } : {}) });
    return given.option;
  };

  const blocks = [];
  let count = 0;
  const addBlock = (id, verbs, nounIds, label, placement, answerSet, reasons, primary, verbText) => {
    const noun = primary ? nounName(primary.text, modifiers) : pascal(verbText);
    const names = { noun, action: primary ? pascal(verbText) + noun : pascal(verbText), screen };
    blocks.push({
      id, verbs, nouns: [...nounIds].sort(idOrder), label, placement, answers: answerSet,
      layers: layersFor(table, placement, names), checks: [], checkNames: [],
      why: `${PLACEMENT_TEXT[placement].why}${reasons.length ? ` Because ${[...new Set(reasons)].join('; ')}.` : ''}`,
    });
  };

  for (const verb of card.verbs) {
    const found = answerVerb(card, verb);
    const primary = primaryNoun(found.ctx.targets);
    const label = [verb.text, ...found.ctx.targets.map((n) => n.text)].join(' ');
    count += 1;
    const id = `b${count}`;
    let { answers: three } = found;
    let reasons = [...found.reasons.browserApi, ...found.reasons.touchesSecretOrDb, ...found.reasons.changesBackend];
    if (found.ambiguity) {
      const choice = ask(`q-${verb.id}`, found.ambiguity.question.replace('{text}', verb.text), found.ambiguity.options);
      if (!choice) continue;
      three = choice === 'mutation' ? { ...three, touchesSecretOrDb: true, changesBackend: true } : { ...three, browserApi: true, changesBackend: false };
      reasons = [`the answer to "${found.ambiguity.question.replace('{text}', verb.text)}" was ${choice}`];
    }
    const placement = placementOf(three);
    const why = placement === 'presentational' && found.ctx.targets.some((n) => n.kind === 'entity') ? [...reasons, 'no session, secret or outside service is named, so the data arrives as props'] : reasons;
    addBlock(id, [verb.id], found.nouns, label, placement, three, why, primary, verb.text);
    if (placement === 'client-leaf' && three.changesBackend && three.touchesSecretOrDb) {
      addBlock(`${id}-write`, [verb.id], found.nouns, label, 'mutation', three, found.reasons.changesBackend, primary, verb.text);
    }
    if (placement === 'server-read') {
      addBlock(`${id}-view`, [verb.id], found.nouns, label, 'presentational', { browserApi: false, touchesSecretOrDb: false, changesBackend: false }, ['it shows what the server read returns'], primary, verb.text);
    }
  }

  const unattachedServer = [];
  for (const check of card.checks) {
    let appliesTo = CHECK_RULES[check.name]?.appliesTo;
    if (!appliesTo) {
      const choice = ask(`q-${check.id}`, UNKNOWN_CHECK_QUESTION.question.replace('{text}', check.name), UNKNOWN_CHECK_QUESTION.options);
      if (!choice) continue;
      appliesTo = UNKNOWN_CHECK_QUESTION.options.find((o) => o.id === choice).appliesTo;
    }
    const hit = blocks.filter((b) => appliesTo.includes(b.placement));
    for (const b of hit) { b.checks.push(check.id); if (!b.checkNames.includes(check.name)) b.checkNames.push(check.name); }
    if (!hit.length && CHECK_RULES[check.name]?.server) unattachedServer.push(check);
  }
  if (unattachedServer.length) {
    const names = [...new Set(unattachedServer.map((c) => c.name))];
    const choice = ask(SERVER_CHECK_QUESTION.id, SERVER_CHECK_QUESTION.question.replace('{text}', names.join(', ')), SERVER_CHECK_QUESTION.options);
    if (choice) {
      const verbs = card.verbs.filter((v) => blocks.some((b) => b.verbs.includes(v.id)));
      const first = verbs.find((v) => v.kind === 'interact') ?? verbs[0] ?? card.verbs[0];
      const targets = card.nouns.filter((n) => first?.on.includes(n.id));
      const data = card.nouns.filter((n) => n.kind === 'entity' || n.kind === 'external');
      const three = choice === 'mutation' ? { browserApi: false, touchesSecretOrDb: true, changesBackend: true } : { browserApi: false, touchesSecretOrDb: true, changesBackend: false };
      addBlock(`b${count + 1}`, first ? [first.id] : [], [...new Set([...targets, ...data].map((n) => n.id))], `${first?.text ?? 'server check'} (server side)`, choice, three, [`the answer to "${SERVER_CHECK_QUESTION.question.replace('{text}', names.join(', '))}" was ${choice}`], primaryNoun(data.length ? data : targets), first?.text ?? 'check');
      const added = blocks.at(-1);
      for (const c of unattachedServer) { added.checks.push(c.id); if (!added.checkNames.includes(c.name)) added.checkNames.push(c.name); }
      if (choice === 'server-read') {
        addBlock(`${added.id}-view`, added.verbs, added.nouns, added.label, 'presentational', { browserApi: false, touchesSecretOrDb: false, changesBackend: false }, ['it shows what the server read returns'], primaryNoun(data.length ? data : targets), first?.text ?? 'check');
      }
    }
  }

  // #619, #620, #626, #627, #628 -- a screen shape is OFFERED when the card asks for one list, one item, one form, one overview or one step-by-step flow, never forced: it is not an open
  // question (it does not hold the plan back) and an unanswered offer leaves the plan as the plain scaffold it always was. The
  // options depend on the card (a list read: list; a read of one item: detail; a write with properties: form; an overview: dashboard; a flow worded as steps: wizard), the id is always q-shape.
  const candidate = open.length === 0 ? shapeCandidate(card, blocks, screen, modifiers, lexicon.nouns?.entity ?? {}) : null;
  let offer = null;
  let shapeAnswer = null;
  if (candidate) {
    const shapeOptions = SHAPE_OPTIONS_BY_SHAPE[candidate.shape];
    askable.set(SHAPE_QUESTION_ID, shapeOptions.map((o) => o.id));
    if (SHAPE_QUESTION_ID in answers) {
      const given = readAnswer(answers[SHAPE_QUESTION_ID], opts, `answers.${SHAPE_QUESTION_ID}`, push);
      if (given && !shapeOptions.some((o) => o.id === given.option)) push('PLACE_UNKNOWN_OPTION', `answers.${SHAPE_QUESTION_ID}`, `"${SHAPE_QUESTION_ID}" has no option ${JSON.stringify(given.option)}. Options: ${shapeOptions.map((o) => o.id).join(', ')}.`);
      else if (given) {
        shapeAnswer = given;
        decisions.push({ question: SHAPE_QUESTION_ID, option: given.option, by: given.by, ...(given.provider ? { provider: given.provider } : {}) });
      }
    }
    offer = shapeOffer(candidate, blocks[0].id, shapeAnswer?.option ?? null);
  }

  for (const key of Object.keys(answers)) if (!askable.has(key)) push('PLACE_UNKNOWN_OPEN', `answers.${key}`, `No open question "${key}". Questions: ${[...askable.keys()].join(', ') || 'none'}.`);
  if (errors.length) return result();
  const shaped = offer !== null && shapeAnswer?.option === offer.shape;
  if (shaped) blocks.splice(0, blocks.length, ...shapeBlocks(blocks[0], offer, LAYER_TABLE.default, { noun: candidate.unit, action: candidate.unit, screen: candidate.unit }));

  // A controller imports its page (generators LAYER_PREREQUISITES): give a block that has a controller and no page its page.
  for (const block of blocks) {
    for (const unit of [...block.layers]) {
      for (const required of LAYER_PREREQUISITES[unit.layer] ?? []) {
        if (!blocks.some((b) => b.layers.some((l) => l.layer === required && l.name === unit.name)) && !block.layers.some((l) => l.layer === required && l.name === unit.name)) {
          block.layers.push({ layer: required, name: unit.name, why: `The ${unit.layer} imports its ${required}, so it must exist first.` });
        }
      }
    }
  }

  const violations = checkPlacementImports(blocks, layers);
  for (const v of violations) push(v.code, v.path, v.message);
  if (errors.length) return result();
  const notes = [...VARIANT_NOTES[variant]];
  // #654: a shaped plan wires the route entry itself (and offers the dependency as a closed choice), so the by-hand route note is replaced.
  if (shaped) notes.splice(1, 1, `${SHAPE_NOTE[offer.shape](candidate)} The plan wires the route entry, runs sync and, if the project lacks "@line/construct-core" (the units import its typed factories), offers to add it (q-dependency).`);
  return result({ ok: true, complete: open.length === 0, blocks, open, offers: offer ? [offer] : [], notes, decisions: decisions.sort((a, b) => a.question.localeCompare(b.question)) });
}

/**
 * Apply answers to the open questions of a placement and return the result of placing the card again with them (the card is
 * never changed). An answer is `{ [openId]: optionId }`, or `{ option, by?, provider? }` to say who answered (person, llm or
 * decision-model). An unknown question or option is a typed error, never a throw; questions left unanswered stay open.
 *
 * @param {import('./requirement-card.mjs').RequirementCard} card The card that was placed.
 * @param {Record<string, string | { option: string, by?: string, provider?: string }>} answers Open question id to option id.
 * @param {Parameters<typeof placeCard>[1]} [options] The options the card was placed with (layers, framework, screen, by, provider).
 * @returns {PlacementResult} The new placement: `ok` is false and `errors` says why when an answer was refused.
 *
 * @example
 * resolvePlacementOpen(card, { 'q-v1': 'mutation' }, { framework: 'nextjs' }).blocks[0].placement; // => 'mutation'
 */
export function resolvePlacementOpen(card, answers, options = {}) {
  return placeCard(card, { ...(isPlainObject(options) ? options : {}), answers: { ...(isPlainObject(options) && isPlainObject(options.answers) ? options.answers : {}), ...(isPlainObject(answers) ? answers : {}) } });
}

// ------------------------------------------------------------------------------------------------------- import rules

/**
 * The imports between the units of a set of blocks: what each block's layers `use`, plus the ties across blocks (a controller
 * imports its page and every hook; a client-leaf hook imports the workflow of every mutation).
 */
function unitEdges(blocks) {
  const edges = [];
  const all = blocks.flatMap((b) => b.layers.map((l) => ({ ...l, block: b })));
  const find = (layer, name) => all.filter((u) => u.layer === layer && (name === undefined || u.name === name));
  for (const block of blocks) {
    for (const unit of block.layers) {
      for (const used of unit.uses ?? []) for (const target of block.layers.filter((l) => l.layer === used)) edges.push({ from: unit, to: target });
    }
  }
  for (const u of all) {
    if (u.layer === 'controller') {
      for (const page of find('page', u.name)) edges.push({ from: u, to: page });
      for (const hook of find('hook')) edges.push({ from: u, to: hook });
    }
    if (u.layer === 'hook' && u.block.placement === 'client-leaf') {
      for (const wf of find('workflow').filter((w) => w.block.placement === 'mutation')) edges.push({ from: u, to: wf });
    }
  }
  const seen = new Set();
  return edges.filter((e) => {
    const key = `${e.from.layer}:${e.from.name}>${e.to.layer}:${e.to.name}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return e.from !== e.to;
  });
}

/**
 * The import-rule violations of a layer assignment: a layer the project does not have, or a unit importing a layer its
 * layer may not import, per `layers[layer].canImport` (for example a page never imports a service). Empty when the assignment is
 * sound. Pure; never throws.
 *
 * @param {PlacementBlock[]} blocks Blocks from `placeCard`.
 * @param {Record<string, { canImport: string[] }>} [layers] The project's layer graph (default: the default layer graph).
 * @returns {PlacementError[]} Every violation, by code.
 *
 * @example
 * checkPlacementImports(placeCard(card).blocks, config.layers); // => []
 */
export function checkPlacementImports(blocks, layers = DEFAULT_LAYERS) {
  const violations = [];
  const graph = isPlainObject(layers) ? layers : DEFAULT_LAYERS;
  const list = Array.isArray(blocks) ? blocks.filter(isPlainObject).filter((b) => Array.isArray(b.layers)) : [];
  const missing = new Set();
  for (const block of list) {
    for (const unit of block.layers) {
      if (!isPlainObject(unit) || missing.has(unit.layer)) continue;
      if (!(unit.layer in graph)) {
        missing.add(unit.layer);
        violations.push({ code: PLACEMENT_ERROR_CODES.PLACE_LAYER_MISSING, path: `blocks.${block.id}.layers`, message: `This project has no "${unit.layer}" layer, which block ${block.id} (${block.placement}) needs. Add it to architecture.yml or answer differently.` });
      }
    }
  }
  for (const edge of unitEdges(list)) {
    const from = graph[edge.from.layer];
    if (!from || !(edge.to.layer in graph)) continue;
    if (!Array.isArray(from.canImport) || !from.canImport.includes(edge.to.layer)) {
      violations.push({ code: PLACEMENT_ERROR_CODES.PLACE_IMPORT_FORBIDDEN, path: `layers.${edge.from.layer}`, message: `${edge.from.layer} ${edge.from.name} would import ${edge.to.layer} ${edge.to.name}, but a ${edge.from.layer} may only import: ${(from.canImport ?? []).join(', ') || 'nothing'}.` });
    }
  }
  return violations;
}

// -------------------------------------------------------------------------------------------------------- planFromBlocks

const NAME_RE = /^[A-Za-z][A-Za-z0-9]*$/;
const FEATURE_RE = /^[A-Za-z][A-Za-z0-9_-]*$/;

/**
 * Compile placed blocks to an ordinary plan: `create.feature` then one `create.unit` per distinct (layer, name), in layer
 * order, each depending on the feature and on the units it imports, with `touches` derived by block-flows.mjs (plan-touches.mjs)
 * from `root`. The plan is checked by `validatePlan` and returned only with zero errors. User input never throws: an unknown
 * or unsupported placement or layer, a bad name or a missing root comes back as a typed error. Who answered the open
 * questions (`decisions`, from `placeCard`) is returned beside the plan, as `compileChain` does, because `validatePlan`
 * rejects unknown plan fields. `files` lists the files each block will touch.
 *
 * A shaped screen (#619) ends with its proof (#623): a `create.proof` step after the units, then a read-only `test.proof` step
 * (and, when the project already has a Playwright config, the browser flow and its `test.run`). `proof` says so:
 * `{ required, complete: false, state: 'pending', steps, verifiedBy, playwright: { configured, config, skipped } }`; the chain is
 * complete only when `proofStatus` (proof.mjs) of the `verifiedBy` steps' results is green or skipped. `proof` is `null` for a
 * plan with no shaped unit, and `notes` carries what was left out (no Playwright config: nothing is installed).
 *
 * @param {PlacementBlock[]} blocks Blocks from `placeCard` (a block with an unsupported placement or layer is refused).
 * A card that calls for a secret or a redirect allow-list (`options.card`, #632) adds one `add.env` step per named variable, each behind a closed
 * question (`q-env`, or `q-env-<name>`: add | skip), and a wired shaped plan adds `check.types` (and `check.build`) after the wiring and before the proof behind the
 * closed question `q-verify` (types | types-build | none, default types). `env` lists the variables and their steps; `verify` the two step ids.
 *
 * @param {{ feature: string, root: string, title?: string, decisions?: PlacementDecision[], proof?: boolean, wire?: boolean, verify?: boolean, card?: object, answers?: Record<string, string | { option: string }> }} options The feature the units go in, the
 *   project root (its architecture.yml decides the folders), an optional ticket title, the attribution to carry, `proof: false` to leave
 *   the proof steps out of a shaped plan (default: they are planned), `wire: false` to leave out the wiring, the environment variables and the verification, `verify: false` to
 *   leave out only the verification, `card` (the requirement card the blocks came from) to name the environment variables its checks call for, and `answers` to the closed questions of the plan.
 * @returns {{ ok: true, plan: object, decisions: PlacementDecision[], files: Record<string, string[]>, proof: object | null, offers: object[], wiring: object | null, env: { variable: string, scope: string, question: string, step: string | null }[], verify: { types: string | null, build: string | null } | null, notes: string[], errors: [] } | { ok: false, plan: null, decisions: [], files: {}, errors: PlacementError[] }}
 *   The plan, who decided what, the files per block and the proof of the chain, or every problem found.
 *
 * @example
 * planFromBlocks(placeCard(card).blocks, { feature: 'billing', root }).plan.steps.map((s) => s.title);
 */
export function planFromBlocks(blocks, options = {}) {
  const errors = [];
  const push = (code, path, message) => errors.push({ code: PLACEMENT_ERROR_CODES[code], path, message });
  const fail = () => ({ ok: false, plan: null, decisions: [], files: {}, errors });
  const opts = isPlainObject(options) ? options : {};
  if (!Array.isArray(blocks) || blocks.length === 0) {
    push('PLAN_BLOCKS_INVALID', 'blocks', 'blocks must be a non-empty array from placeCard.');
    return fail();
  }
  if (!isNonEmptyString(opts.feature) || !FEATURE_RE.test(opts.feature)) push('PLAN_FEATURE_INVALID', 'feature', '"feature" must be a feature name such as billing.');
  if (!isNonEmptyString(opts.root)) push('PLAN_ROOT_REQUIRED', 'root', '"root" (the project root) is needed to derive the files each step touches.');
  const decisions = opts.decisions ?? [];
  if (!Array.isArray(decisions) || !decisions.every((d) => isPlainObject(d) && isNonEmptyString(d.question) && isNonEmptyString(d.option) && DECISION_SOURCES.includes(d.by) && (d.provider === undefined || isNonEmptyString(d.provider)))) {
    push('PLAN_DECISIONS_INVALID', 'decisions', `decisions must be [{ question, option, by: ${DECISION_SOURCES.join('|')}, provider? }].`);
  }

  const units = new Map();
  blocks.forEach((block, i) => {
    const at = `blocks[${i}]`;
    if (!isPlainObject(block) || !isNonEmptyString(block.id) || !Array.isArray(block.layers)) { push('PLAN_BLOCK_INVALID', at, 'A block must be an object { id, placement, layers[] }.'); return; }
    if (!PLACEMENTS.includes(block.placement)) { push('PLAN_PLACEMENT_UNKNOWN', `${at}.placement`, `Unsupported placement ${JSON.stringify(block.placement)}. Supported: ${PLACEMENTS.join(', ')}.`); return; }
    const shape = block.shape;
    if (shape !== undefined && !(isPlainObject(shape) && PLAN_SHAPES.includes(shape.name) && isNonEmptyString(shape.entity) && isNonEmptyString(shape.fields) && (shape.steps === undefined || isNonEmptyString(shape.steps)))) {
      push('PLAN_BLOCK_INVALID', `${at}.shape`, `A block's shape must be { name: ${PLAN_SHAPES.join('|')}, entity, fields, steps? }.`);
      return;
    }
    block.layers.forEach((unit, j) => {
      const path = `${at}.layers[${j}]`;
      if (!isPlainObject(unit) || !isNonEmptyString(unit.layer) || !isNonEmptyString(unit.name)) { push('PLAN_LAYER_INVALID', path, 'A layer entry must be { layer, name }.'); return; }
      if (!LAYER_ORDER.includes(unit.layer)) { push('PLAN_LAYER_UNSUPPORTED', `${path}.layer`, `"${unit.layer}" is not a layer a plan step can create (${LAYER_ORDER.join(', ')}); do that unit by hand.`); return; }
      if (!NAME_RE.test(unit.name)) { push('PLAN_NAME_INVALID', `${path}.name`, `"${unit.name}" is not a PascalCase unit name.`); return; }
      const key = `${unit.layer}:${unit.name}`;
      if (!units.has(key)) units.set(key, { layer: unit.layer, name: unit.name, why: unit.why, blocks: [] });
      units.get(key).blocks.push(block.id);
      if (shape) units.get(key).shape = shape;
    });
  });
  if (errors.length) return fail();

  const ordered = [...units.values()].sort((a, b) => LAYER_ORDER.indexOf(a.layer) - LAYER_ORDER.indexOf(b.layer));
  const edges = unitEdges(blocks.map((b) => ({ ...b, layers: b.layers.filter((l) => LAYER_ORDER.includes(l.layer)) })));
  const stepOf = new Map();
  const steps = [];
  const notes = [];
  const answers = isPlainObject(opts.answers) ? opts.answers : {};
  const offers = [];
  const wiringDecisions = [];
  const record = (question, answer) => {
    const a = typeof answer === 'string' ? { option: answer } : answer;
    if (question.chosen && isPlainObject(a)) wiringDecisions.push({ question: question.id, option: question.chosen, by: a.by ?? 'person', ...(a.provider ? { provider: a.provider } : {}) });
  };
  const add = (stepFlow, title, args, dependsOn, why, scope) => {
    const touches = scope ?? flowBlock(stepFlow).declaredScope(args, { root: opts.root });
    const step = { id: `s${steps.length + 1}`, title, flow: stepFlow, args, executor: 'deterministic' };
    if (dependsOn.length) step.dependsOn = dependsOn;
    if (touches) step.touches = touches;
    else push('PLAN_TOUCHES_UNKNOWN', `steps[${steps.length}]`, `The files of ${title} cannot be worked out from these arguments.`);
    if (why) step.rationale = why;
    steps.push(step);
    return step.id;
  };
  // #621: where each shaped screen reads its data from is a closed question (`q-source`, or `q-source-<name>` for several screens). The rules'
  // default is the OpenAPI operation of the entity when the project's spec has one, else a local store; an unanswered question uses it, so it
  // never holds the plan back. The answer rides on every step of the screen (`source`), so the plan says what will be written.
  const sourceOf = new Map();
  const stepsOf = new Map();
  const sourceNotes = [];
  const shapedNames = [...new Set(ordered.filter((u) => u.shape).map((u) => u.name))];
  for (const name of shapedNames) {
    const { shape } = ordered.find((u) => u.name === name && u.shape);
    const id = shapedNames.length === 1 ? SOURCE_QUESTION_ID : `${SOURCE_QUESTION_ID}-${name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()}`;
    const endpoint = SHAPES[shape.name].endpoint(name, shape.entity);
    const chosen = sourceOffer(opts.root, { shape: shape.name, unit: name, plural: pluralOf(shape.entity), endpoint, answer: answers[id] });
    if (chosen.refused) push('PLAN_SOURCE_UNAVAILABLE', `answers.${id}`, chosen.refused);
    chosen.question.id = id;
    offers.push(chosen.question);
    record(chosen.question, answers[id]);
    sourceOf.set(name, chosen.source);
    if (chosen.unavailable) sourceNotes.push(chosen.unavailable);
    sourceNotes.push(SOURCE_NOTE[chosen.source]({ name, endpoint, operation: chosen.operation, verb: operationOf(shape.name).method }));
    // #659: a wizard's step count is a closed question too (`q-steps`, or `q-steps-<name>`): two, three (the default) or four steps, each a fixed list of
    // names, so the plan stays deterministic. A wizard whose block already carries steps of its own that are not in the table is not asked.
    if (shape.name === 'wizard') {
      const stepsQuestionId = shapedNames.length === 1 ? STEPS_QUESTION_ID : `${STEPS_QUESTION_ID}-${name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()}`;
      const asked = stepsOffer({ unit: name, current: shape.steps, answer: answers[stepsQuestionId] });
      if (asked) {
        if (asked.refused) push('PLAN_STEPS_UNAVAILABLE', `answers.${stepsQuestionId}`, asked.refused);
        asked.question.id = stepsQuestionId;
        offers.push(asked.question);
        record(asked.question, answers[stepsQuestionId]);
        stepsOf.set(name, asked.steps);
      }
    }
  }
  const featureStep = add('create.feature', `Create feature ${opts.feature}`, { name: opts.feature }, [], 'The slice every unit below goes into.');
  for (const u of ordered) {
    const deps = new Set([featureStep]);
    for (const e of edges) if (e.from.layer === u.layer && e.from.name === u.name && stepOf.has(`${e.to.layer}:${e.to.name}`)) deps.add(stepOf.get(`${e.to.layer}:${e.to.name}`));
    // #619: a shaped unit carries the shape, its entity and its fields (the CLI's --shape/--entity/--fields), and waits for the
    // units of the same shape that it imports or takes its types from.
    if (u.shape) for (const need of SHAPES[u.shape.name].requires[u.layer] ?? []) if (stepOf.has(`${need}:${u.name}`)) deps.add(stepOf.get(`${need}:${u.name}`));
    const shapeArgs = u.shape ? { shape: u.shape.name, entity: u.shape.entity, fields: u.shape.fields, ...(stepsOf.get(u.name) ?? u.shape.steps ? { steps: stepsOf.get(u.name) ?? u.shape.steps } : {}), source: sourceOf.get(u.name) } : {};
    const id = add('create.unit', `Create ${u.layer} ${u.name}`, { layer: u.layer, name: u.name, feature: opts.feature, ...shapeArgs }, [...deps].sort(idOrder), u.why);
    stepOf.set(`${u.layer}:${u.name}`, id);
  }
  // #654: a shaped screen is not reachable until the route entry points at its controller and the feature's barrel exports it. Both
  // are plan steps after the units and before the proof: `sync` (the existing flow, with the barrel it rewrites declared), then
  // `create.route`; and, when the project does not depend on @line/construct-core (the units import its factories), a closed
  // choice `q-dependency` whose default adds the one line to package.json (nothing is installed). `q-route` is asked only when the
  // screen's path is reserved or taken. Unanswered questions use their default, so nothing holds the plan back; `options.wire: false`
  // leaves all of it out (a plan then ends its units as before #654).
  // #632: a card whose checks call for a secret (`server-only-secret`) or a redirect allow-list (`validated-redirect`) names the environment
  // variables the project must define. Each is a closed question (`q-env`, or `q-env-<name>` for several: add | skip); an unanswered one
  // uses its default (add), so it never holds the plan back. The step writes only a placeholder line and a comment to .env.example.
  // `options.card` is the requirement card the blocks came from; without it (or with `wire: false`) the plan carries none.
  const envPlan = [];
  if (opts.wire !== false && isPlainObject(opts.card)) {
    const secrets = secretsOfCard(opts.card);
    const checks = new Set((opts.card.checks ?? []).map((c) => c.name));
    if (checks.has('server-only-secret') && !secrets.some((x) => x.check === 'server-only-secret')) notes.push('The card asks for a server-only secret but names no outside service, so no environment variable is planned: add one with `construct create env <NAME> --scope server`.');
    for (const offer of envOffers(opts.root, secrets, answers)) {
      offers.push(offer.question);
      record(offer.question, answers[offer.id]);
      const step = offer.add ? add('add.env', `Add ${offer.variable} to ${ENV_FILE}`, { ...offer.request }, [], 'Called for by a check of the card. A placeholder line and a comment; the real value goes in .env, which is not committed.') : null;
      envPlan.push({ variable: offer.variable, scope: offer.request.scope, question: offer.id, step });
    }
  }
  const shaped = new Map();
  for (const u of ordered) if (u.shape) shaped.set(u.name, { shape: u.shape, unitSteps: [...(shaped.get(u.name)?.unitSteps ?? []), stepOf.get(`${u.layer}:${u.name}`)] });
  const routeOf = new Map();
  const wiringSteps = [];
  let wiring = null;
  if (opts.wire !== false && shaped.size) {
    const everyUnit = [...stepOf.values()].sort(idOrder);
    wiring = { dependency: null, sync: null, routes: [] };
    const dep = dependencyOffer(opts.root, answers[DEPENDENCY_QUESTION_ID]);
    if (dep) {
      offers.push(dep.question);
      record(dep.question, answers[DEPENDENCY_QUESTION_ID]);
      if (dep.add) wiring.dependency = add('add.dependency', `Add ${CONSTRUCT_CORE_PACKAGE} to package.json`, { name: CONSTRUCT_CORE_PACKAGE, version: dep.version }, [], `The generated units import their typed factories from it. Adds ${dep.line}; nothing is installed.`);
    }
    if (wiring.dependency) wiringSteps.push(wiring.dependency);
    wiring.sync = add('sync', `Export the ${opts.feature} feature's public API (sync)`, {}, everyUnit, 'The feature barrel (index.ts) must export the new controller and hook, or SLICE-003 warns.', syncTouches(opts.root, opts.feature));
    wiringSteps.push(wiring.sync);
    for (const [name] of shaped) {
      const id = shaped.size === 1 ? ROUTE_QUESTION_ID : `${ROUTE_QUESTION_ID}-${routePathOf(name).slice(1)}`;
      const offer = routeOffer(opts.root, { name, feature: opts.feature, answer: answers[id] });
      if (offer.question) { offer.question.id = id; offers.push(offer.question); record(offer.question, answers[id]); }
      if (!offer.route) { notes.push(`The ${name} screen has no route step (you chose to skip it): add its controller to the route entry by hand.`); continue; }
      const step = add('create.route', `Wire the ${name} screen into the route entry (${offer.route})`, { name, feature: opts.feature, route: offer.route }, [stepOf.get(`controller:${name}`), wiring.sync].filter(Boolean).sort(idOrder), 'A screen nobody can open is not done: the route entry renders its controller and nothing else.');
      routeOf.set(name, offer.route);
      wiringSteps.push(step);
      wiring.routes.push({ name, route: offer.route, step, file: steps.find((x) => x.id === step)?.touches?.files?.[0]?.path ?? null });
    }
  }
  // #632: a wired shaped plan says whether the project still type-checks (and builds) before the proof: `q-verify` (types | types-build | none,
  // rules-only default types). Both steps are read-only and classified (`check.types`, `check.build`); an unanswered question uses the default.
  // `options.verify: false` (or `wire: false`) leaves the question and the steps out.
  let verification = null;
  if (opts.wire !== false && opts.verify !== false && shaped.size) {
    const v = verifyOffer(opts.root, answers[VERIFY_QUESTION_ID]);
    offers.push(v.question);
    record(v.question, answers[VERIFY_QUESTION_ID]);
    verification = { types: null, build: null };
    const upTo = [...new Set([...stepOf.values(), ...wiringSteps])].sort(idOrder);
    if (v.types) verification.types = add('check.types', 'Type-check the project', {}, upTo, 'Read-only: a pass, or the errors grouped by file and what kind they are (a missing import, an unknown name, a type mismatch). Runs after the route is wired, so a dangling import shows here.');
    if (v.build) verification.build = add('check.build', 'Build the project', {}, [verification.types].filter(Boolean), 'Read-only: runs the build script and says whether it passed, or the first compile errors. Nothing is installed.');
  }
  // #623: a shaped screen is not finished until something shows it behaves. Each shaped unit name gets a proof step (after every
  // unit of the shape) and a read-only verification step; a project that already has Playwright also gets the route flow and its
  // run. `options.proof: false` opts out (a plan then ends with the units, as before #623). Nothing is installed: a project
  // without Playwright is told so, in `notes` and `proof.playwright.skipped`.
  const proofSteps = [];
  let playwrightNote = null;
  const playwrightConfig = detectPlaywright(opts.root ?? '');
  if (opts.proof !== false) {
    for (const [name, { shape, unitSteps }] of shaped) {
      const base = { name, feature: opts.feature, shape: shape.name, entity: shape.entity, fields: shape.fields, ...(stepsOf.get(name) ?? shape.steps ? { steps: stepsOf.get(name) ?? shape.steps } : {}), source: sourceOf.get(name) };
      const after = [...new Set([...unitSteps, ...wiringSteps])].sort(idOrder);
      const render = add('create.proof', `Prove the ${name} screen`, { ...base, kind: 'render' }, after, 'A screen is not done until something shows it behaves: its states, its controller and its service.');
      const verify = add('test.proof', `Run the proof of ${name}`, { feature: opts.feature, name: `${name}Screen.proof.test.ts` }, [render], 'Read-only: pass, or a classified failure (the app behaved differently, or the harness lost a file). The chain is complete when this is green or explicitly skipped.');
      const entry = { name, kind: 'render', proofStep: render, verifiedBy: verify };
      proofSteps.push(entry);
      if (playwrightConfig && PLAYWRIGHT_SHAPES.includes(shape.name) && sourceOf.get(name) !== 'local' && (!wiring || routeOf.has(name))) {
        const slug = name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
        const flow = add('create.proof', `Prove the ${name} route in a browser`, { ...base, kind: 'playwright', ...(routeOf.has(name) ? { route: routeOf.get(name) } : {}) }, after, 'The route of the screen with its API mocked in the browser.');
        const run = add('test.run', `Run the browser flow of ${name}`, { feature: opts.feature, name: `${slug}--screen.spec.ts`, area: 'generated' }, [flow, verify], 'Needs the app running (see --base-url); read-only.');
        proofSteps.push({ name, kind: 'playwright', proofStep: flow, verifiedBy: run });
      }
    }
    if (proofSteps.length && !playwrightConfig) notes.push(playwrightNote = 'Playwright is not configured in this project (no playwright.config.* at the root), so the plan has no browser flow and nothing is installed. The render proof still proves the screen; add Playwright and plan again for the browser flow.');
    const noFlow = [...shaped].filter(([, { shape }]) => !PLAYWRIGHT_SHAPES.includes(shape.name)).map(([name, { shape }]) => `${name} (${shape.name})`);
    const noRequest = [...shaped].filter(([name, { shape }]) => PLAYWRIGHT_SHAPES.includes(shape.name) && sourceOf.get(name) === 'local').map(([name, { shape }]) => `${name} (${shape.name})`);
    const why = [
      ...(noFlow.length ? [`No browser flow is planned for ${noFlow.join(', ')}: only the ${PLAYWRIGHT_SHAPES.join(', ')} shape has one so far.`] : []),
      ...(noRequest.length ? [`No browser flow is planned for ${noRequest.join(', ')}: a local data source makes no request to mock.`] : []),
    ];
    if (proofSteps.length && playwrightConfig && why.length) notes.push(playwrightNote = `${why.join(' ')} The render proof still proves the screen.`);
  }
  if (errors.length) return fail();
  notes.push(...sourceNotes);

  const plan = { version: 1, ticket: { source: 'text', title: isNonEmptyString(opts.title) ? opts.title : `Place blocks for ${opts.feature}` }, steps };
  const validated = validatePlan(plan);
  if (!validated.valid) {
    for (const e of validated.errors) push('PLAN_INVALID', e.path, `${e.code}: ${e.message}`);
    return fail();
  }
  const files = {};
  for (const block of blocks) {
    const paths = block.layers.flatMap((l) => steps.find((s) => s.id === stepOf.get(`${l.layer}:${l.name}`))?.touches?.files ?? []).map((f) => f.path);
    files[block.id] = [...new Set(paths)];
  }
  const proof = proofSteps.length
    ? { required: true, complete: false, state: 'pending', steps: proofSteps, verifiedBy: proofSteps.map((p) => p.verifiedBy), playwright: { configured: playwrightConfig !== null, config: playwrightConfig, skipped: playwrightNote } }
    : null;
  return { ok: true, plan, decisions: [...decisions.map((d) => ({ ...d })), ...wiringDecisions], files, proof, offers, wiring, env: envPlan, verify: verification, notes, errors: [] };
}

// ---------------------------------------------------------------------------------------------------------------- summary

/**
 * One plain-English line per block, capped: `"see current subscription plan" is fetched on the server (domain, service,
 * controller). Checks: auth-session-check, server-only-secret.` Built from the blocks alone.
 *
 * @param {PlacementResult | { blocks: PlacementBlock[] }} result A placement result.
 * @returns {{ id: string, line: string }[]} The lines, in block order.
 *
 * @example
 * blockLines(placeCard(card))[0]; // => { id: 'b1', line: '"see current subscription plan" is fetched on the server ...' }
 */
export function blockLines(result) {
  return (result?.blocks ?? []).map((b) => ({
    id: b.id,
    line: capText(`"${b.label}" ${b.shape ? SHAPE_PHRASE[b.shape.name]?.[b.placement] ?? 'is placed' : PLACEMENT_TEXT[b.placement]?.line ?? 'is placed'} (${(b.layers ?? []).map((l) => l.layer).join(', ')}).${b.checkNames?.length ? ` Checks: ${b.checkNames.join(', ')}.` : ''}`, PLACEMENT_LIMITS.line),
  }));
}

/**
 * The summary of a placement at a fixed maximum size: at most 8 blocks (each with at most 4 verbs, 6 layers, 4 checks and a
 * capped reason), at most 8 plain-English lines, 5 open questions of at most 5 options and 3 notes, with `truncated` set
 * when anything was cut. The absolute size is bounded whatever the card, so a person's screen, an LLM's tool result and a
 * decision model's input are all built from this one object.
 *
 * @param {PlacementResult} result A result from `placeCard`.
 * @returns {{ version: string, ok: boolean, complete: boolean, framework: string, counts: { blocks: number, open: number, errors: number }, blocks: object[], lines: string[], open: PlacementOpen[], offers: object[], notes: string[], errors: object[], truncated: boolean }} The summary.
 *
 * @example
 * blockSummary(placeCard(card)).counts; // => { blocks: 4, open: 0, errors: 0 }
 */
export function blockSummary(result) {
  const L = PLACEMENT_LIMITS;
  const blocks = Array.isArray(result?.blocks) ? result.blocks : [];
  const open = Array.isArray(result?.open) ? result.open : [];
  const notes = Array.isArray(result?.notes) ? result.notes : [];
  const errors = Array.isArray(result?.errors) ? result.errors : [];
  const lines = blockLines(result);
  return {
    version: PLACEMENT_VERSION,
    ok: !!result?.ok,
    complete: !!result?.complete,
    framework: capText(result?.framework, L.label),
    counts: { blocks: blocks.length, open: open.length, errors: errors.length },
    blocks: blocks.slice(0, L.blocks).map((b) => ({
      id: capText(b.id, L.label),
      placement: b.placement,
      label: capText(b.label, L.label),
      verbs: (b.verbs ?? []).slice(0, L.verbs),
      answers: { ...b.answers },
      layers: (b.layers ?? []).slice(0, L.layers).map((l) => `${l.layer}:${l.name}`),
      checks: (b.checkNames ?? []).slice(0, L.checks).map((c) => capText(c, L.label)),
      why: capText(b.why, L.why),
    })),
    lines: lines.slice(0, L.lines).map((l) => l.line),
    open: open.slice(0, CARD_LIMITS.maxOptions).map((q) => ({
      id: q.id,
      question: capText(q.question, L.question),
      options: (q.options ?? []).slice(0, L.options).map((o) => ({ id: o.id, label: capText(o.label, L.label), enabled: !!o.enabled, why: capText(o.why, L.why) })),
      chosen: q.chosen ?? null,
    })),
    offers: (Array.isArray(result?.offers) ? result.offers : []).slice(0, CARD_LIMITS.maxOptions).map((q) => ({
      id: q.id,
      question: capText(q.question, L.question),
      options: (q.options ?? []).slice(0, L.options).map((o) => ({ id: o.id, label: capText(o.label, L.label), enabled: !!o.enabled, why: capText(o.why, L.why) })),
      chosen: q.chosen ?? null,
      default: q.default ?? null,
    })),
    notes: notes.slice(0, L.notes).map((n) => capText(n, L.note)),
    errors: errors.slice(0, L.notes).map((e) => ({ code: e.code, path: capText(e.path, L.label) })),
    truncated: blocks.length > L.blocks || lines.length > L.lines || open.length > CARD_LIMITS.maxOptions || notes.length > L.notes || errors.length > L.notes
      || blocks.some((b) => (b.verbs ?? []).length > L.verbs || (b.layers ?? []).length > L.layers || (b.checkNames ?? []).length > L.checks),
  };
}
