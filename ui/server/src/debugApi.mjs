// LIN-137 (part of LIN-82/epic #616) -- the debug chain's UI half: one route, POST /api/debug/read, over
// packages/core/debug-chain.mjs's four choosers (debug.reproduce -> debug.isolate -> debug.fix -> debug.verify).
// Stateless like the requirement chain (#642): the client sends the feature under debug and every answer so far,
// in chooser order, and the route replays them. No model is called and nothing is written to the project; approving
// the compiled plan goes through the existing Plan route (POST /api/plan/run), unchanged.
//
// debug.fix's exit is `kind: 'ai'` (LIN-82 decision a): an ai exit does not compile into a plan step
// (chooser.mjs's compileChain rejects it with CHAIN_ANSWER_EXIT_UNSUPPORTED), so when it is chosen the route
// compiles a plan from the other three choosers only, and records the ai-fill choice as its own decision-trace
// entry beside the compiled ones (choicesFromChain, #643's adapter).
//
// Security and contract, mirroring requirementApi.mjs:
//   - mounted below the session gate AND the project-open gate (index.mjs);
//   - a request from a foreign browser Origin is refused (403); the body must be JSON (415) and is capped (413);
//   - `feature` is a short plain string and every answer is `{ chooser, option }` naming one of the four chooser
//     ids and a valid option id (or `exit`), so an unknown answer is a typed 400, never a guess.
import express from 'express';
import { buildDebugChain, debugChainSteps, EXIT_ANSWER } from '../../../packages/core/debug-chain.mjs';
import { chooserSummary, compileChain } from '../../../packages/core/chooser.mjs';
import { recordChoices } from '../../../packages/core/decision-trace-store.mjs';
import { choicesFromChain } from '../../../packages/core/decision-trace-adapters.mjs';

export const MAX_FEATURE = 100;
export const MAX_ANSWERS = 4;
export const MAX_REQUEST_BYTES = 8 * 1024;

const STEP_IDS = ['debug.reproduce', 'debug.isolate', 'debug.fix', 'debug.verify'];
const OPTION_ID = /^[a-z][a-z-]{0,30}$/;

const fail = (status, code, error) => ({ status, body: { ok: false, code, error } });

/**
 * Read one step of the debug chain, or (once every chooser is answered) the compiled plan.
 *
 * @param {{ feature?: unknown, answers?: unknown }} body `feature` (the unit under debug) and `answers`, a list of
 *   `{ chooser, option }` in the order they were made, one per chooser of debug-chain.mjs.
 * @param {string} root The open project's root (only used once every chooser is answered, to derive `touches`).
 * @param {{ choices: object[], planValidated?: boolean }} [trace] Filled in once the chain is fully answered: the
 *   closed questions answered so far, ready for `recordChoices`.
 * @returns {{ status: number, body: object }}
 */
export function readDebug(body, root, trace = { choices: [] }) {
  const feature = body?.feature;
  if (typeof feature !== 'string' || !feature.trim()) return fail(400, 'FEATURE_REQUIRED', 'Name the feature under debug first.');
  if (feature.trim().length > MAX_FEATURE) return fail(400, 'FEATURE_TOO_LONG', `The feature name is longer than ${MAX_FEATURE} characters.`);
  const given = body?.answers === undefined ? [] : body.answers;
  if (!Array.isArray(given) || given.length > MAX_ANSWERS) return fail(400, 'BAD_ANSWERS', `answers must be a list of at most ${MAX_ANSWERS} { chooser, option }.`);
  const byChooser = {};
  for (const a of given) {
    if (!a || typeof a !== 'object' || Array.isArray(a) || typeof a.chooser !== 'string' || typeof a.option !== 'string') return fail(400, 'BAD_ANSWERS', 'Each answer must be { chooser, option }.');
    if (!STEP_IDS.includes(a.chooser)) return fail(400, 'BAD_ANSWERS', `"${a.chooser}" is not a step of the debug chain.`);
    if (a.option !== EXIT_ANSWER && !OPTION_ID.test(a.option)) return fail(400, 'BAD_ANSWERS', `"${a.option}" is not a valid option id.`);
    byChooser[a.chooser] = a.option;
  }

  let chain;
  try {
    chain = buildDebugChain(feature.trim());
  } catch (e) {
    return fail(400, 'CHAIN_INVALID', String(e?.message ?? e).split('\n')[0]);
  }
  const steps = debugChainSteps(chain);

  // chooserSummary() deliberately carries only the closed options, never the exit (the exit is not one of the "2-5
  // options" a decision model chooses between); the UI still needs to render it, so it rides beside the summary here.
  const summaries = {};
  const exits = {};
  let current = null;
  for (const chooser of steps) {
    summaries[chooser.id] = chooserSummary(chooser, { chosen: byChooser[chooser.id] });
    exits[chooser.id] = chooser.exit.flow === 'manual.task'
      ? { kind: 'manual', label: chooser.exit.label ?? 'None of these: do it by hand' }
      : { kind: 'ai', label: chooser.exit.label ?? 'Fill with AI' };
    if (!current && byChooser[chooser.id] === undefined) current = chooser.id;
  }
  const done = current === null;
  const base = { ok: true, feature: feature.trim(), steps: STEP_IDS, summaries, exits, current, done, plan: null, fixIsAi: byChooser['debug.fix'] === EXIT_ANSWER };
  if (!done) return { status: 200, body: base };

  const fixIsAi = base.fixIsAi;
  const compileChoosers = fixIsAi ? steps.filter((c) => c.id !== 'debug.fix') : steps;
  const compileAnswers = fixIsAi ? Object.fromEntries(Object.entries(byChooser).filter(([k]) => k !== 'debug.fix')) : byChooser;
  const compiled = compileChain(compileChoosers, compileAnswers, { root, title: `Debug: ${feature.trim()}` });
  if (!compiled.ok) return { status: 200, body: { ...base, errors: compiled.errors } };

  // Decisions in chain order (reproduce, isolate, fix, verify), not compile order: fixIsAi's synthetic entry stands
  // in for debug.fix, which compileChain never saw (its ai exit does not compile into a step).
  const decisions = fixIsAi
    ? steps.map((c) => (c.id === 'debug.fix' ? { step: 'ai-fix', chooser: 'debug.fix', option: EXIT_ANSWER, by: 'person' } : compiled.decisions.find((d) => d.chooser === c.id)))
    : compiled.decisions;
  trace.choices = choicesFromChain(steps, decisions);
  trace.planValidated = true;
  return { status: 200, body: { ...base, plan: compiled.plan } };
}

/**
 * @param {{ getRoot: () => {ok: true, root: string} | {ok: false, status?: number, body?: object}, clientOrigin?: string }} deps
 */
export function createDebugRouter({ getRoot, clientOrigin }) {
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
    if (Number(req.get('content-length') || 0) > MAX_REQUEST_BYTES) return res.status(413).json({ ok: false, code: 'TOO_LARGE', error: 'That request is too large.' });
    return next();
  });
  router.post('/read', async (req, res) => {
    const r = getRoot();
    if (!r.ok) return res.status(r.status ?? 400).json(r.body ?? { ok: false, error: r.error ?? 'No project is open.' });
    try {
      const trace = { choices: [] };
      const read = readDebug(req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {}, r.root, trace);
      if (read.status === 200 && trace.choices.length) {
        await recordChoices(r.root, trace.choices, { suggestWith: null, ...(trace.planValidated === undefined ? {} : { outcome: { planValidated: trace.planValidated } }) });
      }
      return res.status(read.status).json(read.body);
    } catch {
      return res.status(500).json({ ok: false, code: 'READ_FAILED', error: 'The debug chain could not be read.' });
    }
  });
  router.use((req, res) => res.status(404).json({ ok: false, error: 'Not found.' }));
  return router;
}
