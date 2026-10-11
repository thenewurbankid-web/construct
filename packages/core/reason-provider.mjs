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
