// cu1 -- @mx/reason as a decision provider (decision-provider.mjs). cu2: it answers through Line's one AI layer,
// decide('construct.chooser', ...) in line-decide.mjs: static first (the enabled options of this summary), then jev on
// reason's ladder when a picker is given (tests) or `jev: 'auto'` (Cockpit's server: reason's own jev over the local
// 1.5B). It only suggests, like every provider: llm.mjs stays the executor.
//
// No single point of failure: when @mx/reason is not linked, fails to load or throws, or jev's model is not running, the
// provider answers from the static order (the first enabled option, the next as runner-up) and says so in plain English.
// Contract: packages/engine/line/contract.mjs (DecideResult); mocks: packages/line-links/mocks.mjs, line-decide-mock.mjs.
import { registerDecisionProvider, unregisterDecisionProvider } from './decision-provider.mjs';
import { importLinked } from '../line-links/index.mjs';
import { createDecider } from './line-decide.mjs';
import { stepProfile, reasonPairOf } from './ai-profiles.mjs';

/** The name the provider registers under (`suggest(summary, { provider: 'reason' })`). */
export const REASON_PROVIDER_NAME = 'reason';
/** Recorded beside every suggestion in a decision trace. */
export const REASON_PROVIDER_VERSION = 'reason-adapter-1';

/** Construct's chooser pair on reason's ladder, from Line's one profile set (ai-profiles.json, step construct.chooser). */
export const CHOOSER_PAIR = Object.freeze(reasonPairOf(stepProfile('construct.chooser')));

const STATIC = {
  single: 'It is the only step that passed the checks.',
  order: 'It came first in the checked steps; no model was asked.',
};

/**
 * A decision provider backed by decide('construct.chooser').
 *
 * @param {{ loadReason?: () => Promise<import('../line-links/contracts').ReasonModule | null>, picker?: import('../line-links/contracts').ReasonPicker, jev?: 'auto' | 'off' }} [options]
 *   `loadReason` defaults to the linked @mx/reason (null when it is not linked); `picker` is jev; `jev: 'auto'` builds
 *   reason's own jev over the local model; with neither, the provider is static only.
 * @returns {{ name: string, version: string, suggest: (summary: any) => Promise<{ option: string, reason: string, runnerUp: string | null } | null>, lastNote: () => string | null, lastDecision: () => any }}
 *
 * @example
 * const provider = createReasonProvider();
 * await provider.suggest({ id: 'q', question: 'Next?', options: [{ id: 'a', enabled: true }], chosen: null });
 * // => { option: 'a', reason: 'It is the only step that passed the checks.', runnerUp: null }
 */
export function createReasonProvider(options = {}) {
  let note = null;
  let last = null;
  const loadReason = options.loadReason
    ? async () => { const m = await options.loadReason(); return m ? { module: m, note: null } : { module: null, note: 'the reason module is not available' }; }
    : async () => { const r = await importLinked('@mx/reason'); return 'module' in r ? { module: r.module, note: null } : { module: null, note: r.reason }; };
  const decider = createDecider({ loadReason, jev: options.picker ?? options.jev ?? 'off' });
  return {
    name: REASON_PROVIDER_NAME,
    version: REASON_PROVIDER_VERSION,
    /** Why the last suggestion used the static path, in one sentence, or null when reason answered. */
    lastNote: () => note,
    /** The last full DecideResult (with its attribution), for a decision trace. */
    lastDecision: () => last,
    async suggest(summary) {
      const enabled = summary.options.filter((o) => o.enabled).map((o) => ({ id: o.id, label: o.label || o.id }));
      if (!enabled.length) return null;
      const d = await decider.decide('construct.chooser', enabled, { question: summary.question });
      last = d;
      const a = d.attribution;
      if (a.fellBackFrom === 'reason') {
        note = a.note.replace(/[;,] (so )?Line decided without jev\.$/, '');
        const failed = /failed/.test(a.note);
        return { option: d.choice, reason: `First available step; the reason module ${failed ? 'failed' : 'is not linked'}, so Line used the static order.`, runnerUp: d.runnerUp };
      }
      note = null;
      if (d.choice === null) return null;
      const reason = d.via === 'jev' ? d.reasons[0] : STATIC[d.by] ?? STATIC.order;
      return { option: d.choice, reason, runnerUp: d.runnerUp };
    },
  };
}

/**
 * Register the reason provider under `reason` (replacing an earlier registration).
 * @param {Parameters<typeof createReasonProvider>[0]} [options]
 * @returns {ReturnType<typeof createReasonProvider>}
 *
 * @example
 * registerReasonProvider({ jev: 'auto' });
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
