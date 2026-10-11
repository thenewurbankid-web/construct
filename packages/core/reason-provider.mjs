// cu1 -- @mx/reason as a decision provider (decision-provider.mjs). The chooser summary becomes one pick question on
// reason's ladder: static first (the enabled options through a check that only admits enabled options of this summary),
// then jev when a picker is given and up. It only suggests, like every provider: llm.mjs stays the executor.
//
// No single point of failure: when @mx/reason is not linked, fails to load or throws, the provider answers from the
// static order (the first enabled option, the next as runner-up) and says so in its reason, in plain English.
// Contract: packages/line-links/contracts.d.ts (ReasonModule, ReasonPicker); mock: packages/line-links/mocks.mjs.
import { registerDecisionProvider, unregisterDecisionProvider } from './decision-provider.mjs';
import { importLinked } from '../line-links/index.mjs';

/** The name the provider registers under (`suggest(summary, { provider: 'reason' })`). */
export const REASON_PROVIDER_NAME = 'reason';
/** Recorded beside every suggestion in a decision trace. */
export const REASON_PROVIDER_VERSION = 'reason-adapter-1';

/** Construct's one pair on reason's ladder: which offered step a chooser takes. */
export const CHOOSER_PAIR = Object.freeze({
  pairId: 'construct.chooser.pick',
  stepId: 'construct.chooser',
  qwenGuidance: 'Pick the next step a developer most likely wants from the offered steps.',
  maxOptions: 5,
  proposeRetries: 0,
  jevFrame: 'construct-chooser',
  review: { enabled: false, maxRounds: 1 },
  ladder: { static: { target: 1 }, options: { on: true, target: 0.6 }, review: { on: false, target: 0.7 } },
  success: 'The developer keeps the suggested step.',
  askUser: 'whenWeak',
  coderReview: false,
  plan: { version: '1', questions: [{ id: 'pick', kind: 'pick', note: 'Which offered step to take next.' }] },
});

const enabledIds = (summary) => summary.options.filter((o) => o.enabled).map((o) => o.id);

/** The static answer: the first enabled option, the next as runner-up, with why the static path was used. */
function staticAnswer(enabled, why) {
  if (!enabled.length) return null;
  return { option: enabled[0], reason: `First available step; ${why}, so Line used the static order.`, runnerUp: enabled[1] ?? null };
}

const BY_REASON = {
  single: 'It is the only step that passed the checks.',
  order: 'It came first in the checked steps; no model was asked.',
  jev: 'jev picked it from the checked steps.',
};

/**
 * A decision provider backed by @mx/reason's ladder.
 *
 * @param {{ loadReason?: () => Promise<import('../line-links/contracts').ReasonModule | null>, picker?: import('../line-links/contracts').ReasonPicker, proposer?: import('../line-links/contracts').ReasonProposer }} [options]
 *   `loadReason` defaults to the linked @mx/reason (null when it is not linked); `picker` is jev (none: static only).
 * @returns {{ name: string, version: string, suggest: (summary: any) => Promise<{ option: string, reason: string, runnerUp: string | null } | null>, lastNote: () => string | null }}
 *
 * @example
 * const provider = createReasonProvider();
 * await provider.suggest({ id: 'q', question: 'Next?', options: [{ id: 'a', enabled: true }], chosen: null });
 * // => { option: 'a', reason: 'It is the only step that passed the checks.', runnerUp: null }
 */
export function createReasonProvider(options = {}) {
  let note = null;
  const loadReason = options.loadReason ?? (async () => {
    const r = await importLinked('@mx/reason');
    if ('reason' in r) { note = r.reason; return null; }
    return r.module;
  });
  let reasonPromise = null;
  let profile = null;
  return {
    name: REASON_PROVIDER_NAME,
    version: REASON_PROVIDER_VERSION,
    /** Why the last suggestion used the static path, in one sentence, or null when reason answered. */
    lastNote: () => note,
    async suggest(summary) {
      const enabled = enabledIds(summary);
      if (!enabled.length) return null;
      reasonPromise ??= Promise.resolve().then(loadReason).catch(() => null);
      const reason = await reasonPromise;
      if (!reason) {
        note ??= 'the reason module is not available';
        return staticAnswer(enabled, 'the reason module is not linked');
      }
      try {
        profile ??= reason.defineProfiles([CHOOSER_PAIR])[CHOOSER_PAIR.pairId];
        const check = (_q, value) => (enabled.includes(value) ? null : `"${value}" is not an enabled step of this question.`);
        const run = await reason.runLadder([{ key: summary.id, q: summary, profile, options: enabled }], { check, ...(options.picker ? { picker: options.picker } : {}), ...(options.proposer ? { proposer: options.proposer } : {}) });
        const choice = run.choices[0];
        note = null;
        if (!choice || choice.picked === null || choice.by === 'none') return null;
        const runnerUp = choice.options.find((o) => o !== choice.picked) ?? null;
        const said = choice.by === 'jev' ? choice.reasoning.filter((r) => r.trim()).at(-1) : undefined;
        return { option: choice.picked, reason: said ?? BY_REASON[choice.by] ?? 'reason picked it.', runnerUp };
      } catch (e) {
        note = `the reason module failed (${String(e?.message ?? e).split('\n')[0].slice(0, 120)})`;
        return staticAnswer(enabled, 'the reason module failed');
      }
    },
  };
}

/**
 * Register the reason provider under `reason` (replacing an earlier registration).
 * @param {Parameters<typeof createReasonProvider>[0]} [options]
 * @returns {ReturnType<typeof createReasonProvider>}
 *
 * @example
 * registerReasonProvider();
 * await suggest(summary, { provider: 'reason' });
 */
export function registerReasonProvider(options) {
  unregisterDecisionProvider(REASON_PROVIDER_NAME);
  const provider = createReasonProvider(options);
  registerDecisionProvider(REASON_PROVIDER_NAME, provider);
  return provider;
}

// ---------------------------------------------------------------------------------------------
// Qwen's reply length (experiment fix 3)
//
// @mx/reason's createQwenProposer caps every reply at 200 tokens (models.ts: `engines(o, host, 200)` and
// `maxTokens: 200` in its `ask`), with no option, which cuts a JSON plan off mid-string. Construct does not edit the
// linked source; it passes the proposer a `fetch` (an option @mx/reason already has) that sets the request's
// `max_tokens` to Construct's cap before it reaches the local OpenAI-compatible server. The cap is per step: a
// pair id map, or `replyTokens` on the profile object handed to propose/review, else the adapter default, else
// $CONSTRUCT_REASON_MAX_TOKENS, else REASON_REPLY_TOKENS.

/** Default reply cap for Qwen through Construct: enough for two or three JSON plans of a few steps. */
export const REASON_REPLY_TOKENS = 800;

/**
 * The reply cap for one profile.
 * @param {any} profile A defined @mx/reason profile (pairId), optionally with `replyTokens`.
 * @param {{maxTokens?: number, maxTokensByPair?: Record<string, number>}} [o]
 * @param {Record<string, string | undefined>} [env]
 * @returns {number}
 */
export function replyTokensFor(profile, o = {}, env = process.env) {
  const ok = (n) => Number.isInteger(n) && n > 0 && n <= 32768;
  const fromEnv = Number(env.CONSTRUCT_REASON_MAX_TOKENS);
  for (const n of [o.maxTokensByPair?.[profile?.pairId], profile?.replyTokens, o.maxTokens, fromEnv]) if (ok(n)) return /** @type {number} */ (n);
  return REASON_REPLY_TOKENS;
}

/**
 * A fetch that sets `max_tokens` on every JSON request body that carries one (OpenAI-compatible chat completions).
 * Other requests (the model list) pass through untouched.
 * @param {number} maxTokens
 * @param {typeof fetch} [base]
 * @returns {typeof fetch}
 */
export function capReplyTokens(maxTokens, base = globalThis.fetch) {
  return /** @type {typeof fetch} */ (async (input, init) => {
    if (init && typeof init.body === 'string') {
      try {
        const body = JSON.parse(init.body);
        if (body && typeof body === 'object' && 'max_tokens' in body) return base(input, { ...init, body: JSON.stringify({ ...body, max_tokens: maxTokens }) });
      } catch { /* not JSON: pass through */ }
    }
    return base(input, init);
  });
}

/**
 * The Qwen proposer from the linked @mx/reason, with Construct's reply cap (default REASON_REPLY_TOKENS, per step by pair id).
 * @param {{createQwenProposer?: (o: any) => import('../line-links/contracts').ReasonProposer}} reason The linked module.
 * @param {{render: (q: any) => string, host?: string, fetch?: typeof fetch, model?: string, maxTokens?: number, maxTokensByPair?: Record<string, number>, env?: Record<string, string | undefined>}} o
 * @returns {import('../line-links/contracts').ReasonProposer & {replyTokens: (profile: any) => number}}
 *
 * @example
 * const qwen = createCappedQwenProposer(reason, { render: (q) => q.text, maxTokensByPair: { 'line.plan.step': 1200 } });
 * await reason.runLadder(items, { proposer: qwen, check });
 */
export function createCappedQwenProposer(reason, o) {
  if (typeof reason?.createQwenProposer !== 'function') throw new Error('The linked @mx/reason has no createQwenProposer, so Qwen cannot propose.');
  const { maxTokens, maxTokensByPair, env, fetch: base, ...rest } = o;
  const byCap = new Map();
  const capOf = (profile) => replyTokensFor(profile, { maxTokens, maxTokensByPair }, env);
  const inner = (profile) => {
    const cap = capOf(profile);
    if (!byCap.has(cap)) byCap.set(cap, /** @type {any} */ (reason).createQwenProposer({ ...rest, fetch: capReplyTokens(cap, base ?? globalThis.fetch) }));
    return byCap.get(cap);
  };
  return {
    name: 'qwen',
    replyTokens: capOf,
    available: (profile) => inner(profile).available(profile),
    propose: (q, rejected, profile, offered) => inner(profile).propose(q, rejected, profile, offered),
    review: (q, options, picked, profile) => inner(profile).review(q, options, picked, profile),
  };
}
