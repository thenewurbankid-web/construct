// #642 (part of epic #616) -- the requirement chain, read back before anything is written. One route,
// POST /api/requirement/read: a plain-English sentence goes through the deterministic blocks (parseRequirement, then
// placeCard, then planFromBlocks of @line/construct-core) and comes back as { card, placement, plan, files, open, summary }.
// No model is called and no network is used anywhere in this file.
//
// Security and contract, in one place:
//   - mounted below the session gate AND the project-open gate (index.mjs), so nothing runs with no project open (409
//     NO_PROJECT); the project is always the server's current one and the client never names a path;
//   - a request from a foreign browser Origin is refused (403); the body must be JSON (415) and is capped (413);
//   - the sentence is capped (MAX_TEXT); answers are a short list of { id, option } with ids of the two shapes the
//     blocks ask (`o<n>` a word of the card, `q-...` a placement question) and every option is checked by the block that
//     owns the question, so an unknown answer is a typed 400, never a guess;
//   - the route reads and starts nothing, and writes NOTHING to the project. Approving the plan is the existing Plan route
//     (POST /api/plan/run), with its own re-validation, containment, block switches and per-file approval, unchanged.
//     One thing is recorded, outside the project: each closed question a person answered is appended as a decision-trace.v1
//     record to the per-user state directory (#643, docs/DECISION-TRACES.md), with what the rules provider suggested, and
//     `planValidated` once the plan from those answers validates. The project's `traces: off` in architecture.yml stops it;
//     a failing recording (full disk, bad state directory) is swallowed and never changes the response.
//   - #633: the response carries `suggestions` (per open question and offer id: the option the project's decision provider
//     suggests, its reason, and the provider's name and version) and `decisionProvider`. The provider is `decision: { provider,
//     plugin }` of architecture.yml, default `rules`; a plugin that fails or is slow is replaced by `rules` and the line is in
//     `decisionProvider.notes`. A plugin file is imported only when the server was started with CONSTRUCT_DECISION_PLUGINS=on.
//     It only suggests: the answer is still the person's, recorded with the suggestion and `accepted: true|false`.
//   - #653: the proof of a shaped screen has three more routes, POST /api/requirement/proof/{status,run,skip}, in
//     requirementProofApi.mjs (same gates, same Origin/JSON/cap checks, a bigger cap because they carry the plan). The read
//     response carries `proof` (the plan's proof steps and the chain state, pending).
//   - stateless: the client sends the sentence and every answer so far, in order. A card question is answered against the
//     card as it stood then (ids renumber once a word is answered), so the answers are replayed in the order given.
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { loadConfig } from '../../../packages/core/config.mjs';
import { parseRequirement, resolveOpen, openQuestion, readBack, cardSummary } from '../../../packages/core/requirement-card.mjs';
import { placeCard, planFromBlocks, blockLines } from '../../../packages/core/placement.mjs';
import { recordChoices, tracesEnabled } from '../../../packages/core/decision-trace-store.mjs';
import { openDecision, suggestForQuestions } from '../../../packages/core/decision-project.mjs';
import { choiceFromCardQuestion, choicesFromPlacement, choicesFromWiring } from '../../../packages/core/decision-trace-adapters.mjs';
import { createProofHandlers, MAX_PROOF_REQUEST_BYTES } from './requirementProofApi.mjs';

export const MAX_TEXT = 2000;
export const MAX_ANSWERS = 20;
export const MAX_REQUEST_BYTES = 16 * 1024;

const CARD_ID = /^o\d{1,3}$/;
const PLACEMENT_ID = /^q-[A-Za-z0-9-]{1,40}$/;
/** #621, #654, #632: the closed questions of the PLAN (where a screen reads its data, its route, the dependency, the environment variables, how far it is verified, a wizard's step count, how a screen shows its states) are asked when the plan is built (they need the project's files), so their answers go to planFromBlocks, not to placeCard. */
const PLAN_ID = /^q-(?:source|route|dependency|env|verify|steps|states|access|state|handler)(?:-[a-z0-9-]{1,70})?$/;
const OPTION_ID = /^[a-z][a-z-]{0,30}$/;

const fail = (status, code, error, extra = {}) => ({ status, body: { ok: false, code, error, ...extra } });

/** "SubscriptionPlan" -> "subscription-plan": the feature the units go in, derived from the screen name the blocks chose. */
export const featureNameOf = (screen) => String(screen).replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();

const asQuestion = (source, q) => ({ ...q, source });

/**
 * Read one requirement. Pure over (text, answers, root): it reads the project's architecture.yml (layers, framework) and
 * the folder listing of its features root, nothing else.
 *
 * @param {{ text?: unknown, answers?: unknown }} body
 * @param {string} root the open project's root
 * @param {{ choices: object[], questions?: object[], planValidated?: boolean }} [trace] filled in as it reads: the closed questions answered so far
 *   (as `recordChoices` takes them), the questions and offers still open (which the decision provider is asked about) and
 *   whether the plan from them validated (undefined while no plan was built)
 * @returns {{ status: number, body: object }}
 */
export function readRequirement(body, root, trace = { choices: [], questions: [] }) {
  const text = body?.text;
  if (typeof text !== 'string' || !text.trim()) return fail(400, 'TEXT_REQUIRED', 'Write the requirement first.');
  if (text.length > MAX_TEXT) return fail(400, 'TEXT_TOO_LONG', `The requirement is longer than ${MAX_TEXT} characters.`);
  const given = body?.answers === undefined ? [] : body.answers;
  if (!Array.isArray(given) || given.length > MAX_ANSWERS) return fail(400, 'BAD_ANSWERS', `answers must be a list of at most ${MAX_ANSWERS} { id, option }.`);
  const cardAnswers = [];
  const placementAnswers = {};
  const planAnswers = {};
  for (const a of given) {
    if (!a || typeof a !== 'object' || Array.isArray(a) || typeof a.id !== 'string' || typeof a.option !== 'string' || !OPTION_ID.test(a.option)) return fail(400, 'BAD_ANSWERS', 'Each answer must be { id, option }.');
    if (CARD_ID.test(a.id)) cardAnswers.push(a);
    else if (PLAN_ID.test(a.id)) planAnswers[a.id] = a.option;
    else if (PLACEMENT_ID.test(a.id)) placementAnswers[a.id] = a.option;
    else return fail(400, 'BAD_ANSWERS', `"${a.id}" is not a question this requirement can ask.`);
  }

  const parsed = parseRequirement(text);
  if (!parsed.card) return fail(400, 'PARSE_FAILED', parsed.errors[0]?.message ?? 'The requirement could not be read.');
  let card = parsed.card;
  const answered = [];
  for (const a of cardAnswers) {
    const item = card.open.find((o) => o.id === a.id);
    const r = resolveOpen(card, { [a.id]: a.option });
    if (!r.ok) return fail(400, r.errors[0]?.code ?? 'ANSWER_REFUSED', r.errors[0]?.message ?? 'That answer was not accepted.');
    if (item) answered.push(choiceFromCardQuestion(card, item, a.option));
    card = r.card;
  }
  trace.choices = answered;

  const base = { ok: true, card, summary: { card: cardSummary(card), readBack: readBack(card).map((l) => l.line) } };
  // A word the lexicon does not know is a question first; nothing is placed until a person answers it.
  if (card.open.length) {
    const openCard = card.open.map((item) => asQuestion('card', openQuestion(card, item)));
    trace.questions = openCard;
    return { status: 200, body: { ...base, placement: null, plan: null, files: {}, open: openCard, offers: [], warnings: [], summary: { ...base.summary, blocks: [] } } };
  }

  let config;
  try {
    config = loadConfig(root);
  } catch (e) {
    return fail(409, 'CONFIG_UNREADABLE', `This project's architecture.yml could not be read: ${String(e?.message ?? e).split('\n')[0]}`);
  }
  const placeOptions = { layers: config.layers, framework: config.project?.framework, answers: placementAnswers };
  const placement = placeCard(card, placeOptions);
  trace.choices = [...answered, ...choicesFromPlacement(card, placeOptions, placement)];
  const open = placement.open.map((q) => asQuestion('placement', q));
  const summary = { ...base.summary, blocks: blockLines(placement).map((l) => l.line) };
  // #619: the shape offer (q-shape) is a closed question that never holds the plan back, so it rides beside `open`, not in it.
  const offers = (placement.offers ?? []).map((q) => asQuestion('placement', q));
  trace.questions = [...open, ...offers];
  const out = { ...base, placement, plan: null, files: {}, open, offers, warnings: [], summary };
  if (!placement.ok || !placement.complete) return { status: 200, body: out };

  const screen = placement.blocks.flatMap((b) => b.layers).find((l) => l.layer === 'page' || l.layer === 'controller')?.name ?? 'Requirement';
  const feature = featureNameOf(screen);
  const planned = planFromBlocks(placement.blocks, { feature, root, title: `Requirement: ${text.trim().slice(0, 80)}`, decisions: placement.decisions, answers: planAnswers, card });
  trace.planValidated = planned.ok;
  if (!planned.ok) return { status: 200, body: { ...out, placement: { ...placement, ok: false, errors: [...placement.errors, ...planned.errors] } } };
  // #621, #654, #632: every closed question of the plan (`q-source`, `q-route`, `q-dependency`, `q-env`, `q-verify`, `q-steps`, `q-states`, whatever the blocks raised) is a card beside the plan,
  // like q-shape: asked once the plan is built, answered like the others, recorded as a decision trace, and never holds Approve back (an unanswered one uses the rules' default).
  // The response is generic: the client draws whatever `offers` holds.
  const sourceOffers = (planned.offers ?? []).filter((q) => PLAN_ID.test(q.id)).map((q) => asQuestion('plan', q));
  trace.questions = [...open, ...offers, ...sourceOffers];
  trace.choices = [...trace.choices, ...choicesFromWiring({ offers: sourceOffers, decisions: (planned.decisions ?? []).filter((d) => PLAN_ID.test(d.question)) })];
  const featuresRoot = config.features?.root ?? 'features';
  const warnings = fs.existsSync(path.join(root, featuresRoot, feature)) ? [`The feature "${feature}" already exists in this project, so the "Create feature ${feature}" step will be refused. Remove that step in the Plan screen, or use other words.`] : [];
  return { status: 200, body: { ...out, placement: { ...placement, decisions: planned.decisions }, offers: [...offers, ...sourceOffers], plan: planned.plan, files: planned.files, proof: planned.proof ?? null, warnings: [...warnings, ...(planned.warnings ?? [])] } };
}

/**
 * #633: what the project's decision provider says about a read. Adds `suggestions` (per open question or offer id: option, reason,
 * runner-up, provider name and version) and `decisionProvider` (who answers, what was asked for, the load and fallback lines) to
 * the response body, and attaches to every choice a person made the suggestion that was on offer, with `outcome.accepted`
 * (true when the person took it, false when they chose another option). Suggest-only: nothing is chosen for the person.
 * Never throws: a failing provider costs the response its suggestions and nothing else.
 *
 * @param {{ status: number, body: object }} out The result of `readRequirement`.
 * @param {{ choices: object[], questions?: object[] }} trace What `readRequirement` filled in.
 * @param {string} root The open project's root.
 * @param {{ allowPlugins?: boolean, log?: (line: string) => void, capabilities?: { available: boolean, reason: string } }} [deps] Whether a plugin file may be imported, where lines go, and (a test seam) the machine's `modelProposals` answer: a machine that cannot load a model answers "rules only: <reason>" (#648).
 * @returns {Promise<{ out: { status: number, body: object }, choices: object[] }>} The response and the choices ready to record.
 */
export async function withDecisions(out, trace, root, deps = {}) {
  if (out.status !== 200) return { out, choices: trace.choices };
  try {
    const decision = await openDecision(root, { allowPlugins: deps.allowPlugins === true, log: deps.log, ...(deps.capabilities ? { capabilities: deps.capabilities } : {}) });
    const suggestions = await suggestForQuestions(decision, trace.questions ?? []);
    const choices = [];
    for (const choice of trace.choices) {
      const s = tracesEnabled(root) && !choice.suggestion && (choice.by ?? 'person') === 'person' ? await decision.suggest(choice.summary) : null;
      choices.push(s ? {
        ...choice,
        suggestion: { option: s.option, reason: s.reason, ...(s.score === undefined ? {} : { score: s.score }) },
        provider: { name: s.provider, version: s.version },
        outcome: { ...(choice.outcome ?? {}), accepted: s.option === choice.chosen },
      } : choice);
    }
    const body = { ...out.body, suggestions, decisionProvider: { ...decision.provider, requested: decision.requested, fellBackFrom: decision.fellBackFrom, notes: decision.notes } };
    return { out: { ...out, body }, choices };
  } catch {
    return { out: { ...out, body: { ...out.body, suggestions: {} } }, choices: trace.choices };
  }
}

/**
 * @param {{ getRoot: () => {ok: true, root: string} | {ok: false, status?: number, body?: object}, clientOrigin?: string, proofRunner?: Function, proofTimeoutMs?: number, capabilities?: { available: boolean, reason: string }, allowPlugins?: boolean, decisionLog?: (line: string) => void }} deps
 *   `proofRunner` and `proofTimeoutMs` are test seams for the proof routes (#653). `allowPlugins` lets a project's
 *   `decision.plugin` file be imported (default: only when `CONSTRUCT_DECISION_PLUGINS=on`, because a plugin is code the
 *   project brings); `decisionLog` receives the load and fallback lines (default: the server's stderr).
 */
export function createRequirementRouter({ getRoot, clientOrigin, proofRunner, proofTimeoutMs, capabilities, allowPlugins = process.env.CONSTRUCT_DECISION_PLUGINS === 'on', decisionLog = (line) => console.error(line) }) {
  const router = express.Router();
  router.use((req, res, next) => {
    if (req.method !== 'GET') {
      const origin = req.get('origin');
      if (clientOrigin && origin && origin !== clientOrigin) return res.status(403).json({ ok: false, code: 'FOREIGN_ORIGIN', error: 'This request came from a page that is not the Cockpit.' });
    }
    return next();
  });
  router.use((req, res, next) => {
    if (req.method !== 'POST') return next();
    if (!req.is('application/json')) return res.status(415).json({ ok: false, code: 'JSON_ONLY', error: 'Send a JSON body.' });
    if (Number(req.get('content-length') || 0) > (req.path.startsWith('/proof/') ? MAX_PROOF_REQUEST_BYTES : MAX_REQUEST_BYTES)) return res.status(413).json({ ok: false, code: 'TOO_LARGE', error: 'That request is too large.' });
    return next();
  });
  router.post('/read', async (req, res) => {
    const r = getRoot();
    if (!r.ok) return res.status(r.status ?? 400).json(r.body ?? { ok: false, error: r.error ?? 'No project is open.' });
    try {
      const trace = { choices: [], questions: [] };
      const read = readRequirement(req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {}, r.root, trace);
      const { out, choices } = await withDecisions(read, trace, r.root, { allowPlugins, log: decisionLog, capabilities });
      // suggestWith: null, because withDecisions already attached what the project's provider suggested (rules when none is named).
      if (out.status === 200 && choices.length) await recordChoices(r.root, choices, { suggestWith: null, ...(trace.planValidated === undefined ? {} : { outcome: { planValidated: trace.planValidated } }) });
      return res.status(out.status).json(out.body);
    } catch {
      return res.status(500).json({ ok: false, code: 'READ_FAILED', error: 'The requirement could not be read.' });
    }
  });
  // #653: the proof of a generated screen. Each handler answers { status, body }; none takes a path from the client.
  const proof = createProofHandlers({ ...(proofRunner ? { runProofs: proofRunner } : {}), ...(proofTimeoutMs ? { timeoutMs: proofTimeoutMs } : {}) });
  for (const [name, handler] of Object.entries(proof)) {
    router.post(`/proof/${name}`, async (req, res) => {
      const r = getRoot();
      if (!r.ok) return res.status(r.status ?? 400).json(r.body ?? { ok: false, error: r.error ?? 'No project is open.' });
      try {
        const out = await handler(req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {}, r.root);
        return res.status(out.status).json(out.body);
      } catch {
        return res.status(500).json({ ok: false, code: 'PROOF_FAILED', error: 'The proof could not be handled.' });
      }
    });
  }
  router.use((req, res) => res.status(404).json({ ok: false, error: 'Not found.' }));
  return router;
}
