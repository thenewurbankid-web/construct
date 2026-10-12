// cu2 -- Line's one AI decision: decide(step, options, context) -> DecideResult (contract: packages/engine/line/contract.mjs).
// Every AI decision in Cockpit, Construct and Trace goes through here, on @mx/reason's ladder:
//
//   1. static   the options through the caller's check; one left decides (`single`); none left asks the person.
//   2. Qwen     the step's model may already have suggested one option with a reason (`context.suggestion`).
//   3. jev      when the step's profile turns the options rung on and jev is up, jev picks among the checked options
//               (reason's runLadder with the profile as a pair). Qwen's reason is kept when jev agrees; when jev and Qwen
//               disagree the decision is low-confidence, so with Auto off the person is asked.
//   Fallback   reason not linked, jev's local model not running, or anything throwing: Qwen's checked suggestion stands
//              (`via: model`), else static's order (`via: static`), and the attribution says why in one sentence.
//
// Feedback (owner rule, LINE.md 2026-10-11): Construct's refusal plus its typed fixes is the standard feedback for every
// AI step. `context.refusal` = {sentence, fixes} makes the typed fixes the options (Construct's recommended one first);
// decideUntilAccepted() applies a choice, feeds a refusal back, and stops when a round does not improve (one question).
// No outside reasoning engine is in this loop. Local models only: nothing here pulls, loads or stops a model.
import { stepProfile, reasonPairOf } from './ai-profiles.mjs';
import { importLinked } from '../line-links/index.mjs';

export const DECIDER_VERSION = 'line-decide-1';

const one = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
/** A full sentence: trimmed, one line, ending in . ? or ! */
const sentence = (s) => { const t = one(s); return t ? (/[.?!]$/.test(t) ? t : `${t}.`) : t; };
const quote = (s) => `"${one(s).slice(0, 80)}"`;

/** Options as {id, label}, enabled only. */
function normalize(options) {
  return (options ?? []).map((o) => (typeof o === 'string' ? { id: o, label: o, enabled: true } : { id: String(o.id), label: one(o.label ?? o.sentence ?? o.id) || String(o.id), enabled: o.enabled !== false }))
    .filter((o) => o.id && o.enabled);
}

/**
 * The typed fixes of a refusal as options, Construct's recommended (rank 1) first.
 * @param {any} refusal A refusal with its typed fixes.
 * @returns {{id: string, label: string, enabled: boolean}[]}
 */
export function refusalOptions(refusal) {
  return [...(refusal?.fixes ?? [])].filter((f) => f && f.id).sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99)).map((f) => ({ id: f.id, label: one(f.sentence) || f.id, enabled: true }));
}

/** What jev and Qwen read: the question, the refusal (feedback) and the facts, never code or paths. */
function render(q) {
  const lines = [`Question: ${q.question}`];
  if (q.refusal) lines.push(`Construct refused the last change: ${q.refusal}`);
  for (const f of q.facts ?? []) lines.push(`Fact: ${one(f)}`);
  return lines.join('\n');
}

const defaultLoadReason = async () => {
  const r = await importLinked('@mx/reason');
  return 'module' in r ? { module: r.module, note: null } : { module: null, note: r.reason };
};

/**
 * Line's one AI decision maker: decide() and decideUntilAccepted() on @mx/reason's ladder, static when it is down.
 * @param {{ loadReason?: () => Promise<{ module: any, note: string | null }>, jev?: 'auto' | 'off' | import('../line-links/contracts').ReasonPicker, profiles?: object }} [setup]
 *   `loadReason` defaults to the linked @mx/reason; `jev`: 'auto' builds reason's own jev over the local model (default),
 *   'off' never asks jev, or a picker object (tests pass a mock); `profiles` is passed to stepProfile (tests).
 * @returns The decider.
 */
export function createDecider(setup = {}) {
  const loadReason = setup.loadReason ?? defaultLoadReason;
  const jevSetting = setup.jev ?? 'auto';
  let loading = null;
  const pickers = new Map();

  /**
   * @param {string} step A profile's step id.
   * @param {(string | { id: string, label?: string, enabled?: boolean })[]} options Closed options with stable ids (ignored with `context.refusal`).
   * @param {{ question?: string, facts?: string[], check?: (id: string) => string | null, suggestion?: { option: string, reason?: string } | null, refusal?: { sentence: string, fixes: { id: string, sentence: string, rank: number }[] } | null, picker?: any, memory?: { store: { prefer: Function }, context: any } | null }} [context]
   *   `memory` (im3 + j5): this project's memory and the recall context (slots and structure, never code); the option
   *   the person consistently picked before leads the checked options, and the record says why. It never adds an option.
   * @returns {Promise<import('../engine/line/contract.mjs').DecideResult>}
   */
  async function decide(step, options, context = {}) {
    const profile = stepProfile(step, setup.profiles);
    const feedback = Boolean(context.refusal);
    const offered = feedback ? refusalOptions(context.refusal) : normalize(options);
    let checked = offered.filter((o) => !context.check || context.check(o.id) === null);
    // im3 + j5: recalled past decisions reorder the checked options (memory never adds one); a broken memory is ignored.
    /** @type {import("../engine/line/memory/contract.mjs").MemoryPreference | null} */
    let remembered = null;
    if (context.memory?.store && checked.length > 1) {
      try { remembered = context.memory.store.prefer(step, context.memory.context, checked.map((o) => o.id), { labelOf: (id) => quote(checked.find((o) => o.id === id)?.label ?? id) }); } catch { remembered = null; }
      if (remembered) checked = [...checked.filter((o) => o.id === remembered.option), ...checked.filter((o) => o.id !== remembered.option)];
    }
    const ids = checked.map((o) => o.id);
    const label = (id) => checked.find((o) => o.id === id)?.label ?? id;
    const sugg = context.suggestion && ids.includes(context.suggestion.option) ? context.suggestion : null;
    const qwenReason = sugg ? sentence(sugg.reason || `Qwen suggested ${quote(label(sugg.option))}`) : null;
    const question = sentence(context.question ?? (feedback ? 'Which fix resolves the refusal?' : 'Which option fits?'));

    /** @returns {import('../engine/line/contract.mjs').DecideResult} */
    const result = (choice, via, by, reasons, extra = {}) => /** @type {any} */ ({
      step,
      choice,
      runnerUp: choice === null ? null : ids.find((x) => x !== choice) ?? null,
      via,
      by,
      reasons: reasons.map(sentence).filter(Boolean),
      lowConfidence: extra.lowConfidence ?? choice === null,
      feedback,
      memory: remembered && choice === remembered.option ? { option: remembered.option, count: remembered.count, sentence: sentence(remembered.sentence) } : null,
      attribution: {
        step,
        provider: extra.reasonUsed ? '@mx/reason' : 'static',
        decider: via === 'jev' ? 'jev' : via === 'model' ? 'qwen' : 'static',
        model: via === 'static' ? null : profile.model,
        version: DECIDER_VERSION,
        fellBackFrom: extra.fellBackFrom ?? null,
        note: extra.note ? sentence(extra.note) : null,
      },
    });
    /** Without jev: Qwen's checked suggestion stands, else static's order (the recommended fix first for feedback). */
    const withoutJev = (extra = {}) => (sugg
      ? result(sugg.option, 'model', 'model', [qwenReason], extra)
      : remembered
        ? result(ids[0], 'static', 'memory', [remembered.sentence], extra)
        : result(ids[0], 'static', 'order', [feedback ? `It is the fix Construct recommends for this refusal.` : 'It came first among the checked options; no model was asked.'], extra));

    if (!ids.length) {
      return result(null, 'static', 'none', [feedback ? 'Construct offered no fix that can run, so Line asks you.' : 'No option passed the checks, so Line asks you.'], { lowConfidence: true });
    }
    if (ids.length === 1) {
      return result(ids[0], 'static', 'single', [feedback ? 'It is the only fix Construct offered for this refusal.' : 'It is the only option that passed the checks.']);
    }
    if (!profile.ladder.options.on || profile.kind !== 'decide' || profile.provider !== 'ollama') return withoutJev();

    loading ??= Promise.resolve().then(loadReason).catch((e) => ({ module: null, note: `the reason module could not be loaded (${one(e?.message ?? e).slice(0, 120)})` }));
    const loaded = await loading;
    if (!loaded.module) {
      return withoutJev({ fellBackFrom: 'reason', note: `${(loaded.note ?? 'The reason module is not linked').replace(/\.$/, '')}; Line decided without jev` });
    }
    const reason = loaded.module;
    const pair = reasonPairOf(profile);
    try {
      let picker = context.picker ?? (typeof jevSetting === 'object' ? jevSetting : null);
      if (!picker && jevSetting === 'auto' && typeof reason.createJevPicker === 'function') {
        picker = pickers.get(step);
        if (!picker) {
          picker = reason.createJevPicker({ context: render, frames: { [step]: { fact: `line.${step}`, state: (words) => words, question: profile.question ?? 'Which option fits best?', rotate: true } } });
          pickers.set(step, picker);
        }
      }
      const defined = reason.defineProfiles([pair])[pair.pairId];
      const up = picker ? await Promise.resolve(picker.available(defined)).catch(() => false) : false;
      const noJev = picker ? `The local model for jev (${profile.model}) is not running, so Line decided without it` : 'jev is turned off here, so Line decided without it';
      // jev reads the options' plain labels; the ids map back. Labels must be unique, else the ids are shown.
      const labels = checked.map((o) => o.label);
      const values = new Set(labels).size === labels.length ? labels : ids;
      const toId = (v) => ids[values.indexOf(v)] ?? null;
      const q = { question, facts: context.facts ?? [], refusal: feedback ? one(context.refusal.sentence) : null };
      // With jev down or off, the ladder still runs (static through reason) and its order stands.
      const run = await reason.runLadder([{ key: step, q, profile: defined, options: values }], {
        ...(up ? { picker } : {}),
        check: (_q, v) => (values.includes(v) ? null : `${quote(v)} is not one of the checked options.`),
      });
      const c = run.choices?.[0];
      const picked = c ? toId(c.picked) : null;
      if (!up) return withoutJev({ fellBackFrom: 'jev', note: noJev, reasonUsed: true });
      if (!c || picked === null || c.by === 'none') return withoutJev({ fellBackFrom: 'jev', note: 'jev gave no answer, so Line decided without it', reasonUsed: true });
      if (c.by === 'single') return result(picked, 'static', 'single', ['It is the only option that passed the checks.'], { reasonUsed: true });
      if (c.by !== 'jev') return withoutJev({ fellBackFrom: 'jev', note: 'jev was not asked, so Line decided without it', reasonUsed: true });
      const jevSaid = (c.reasoning ?? []).filter((r) => one(r)).at(-1);
      if (sugg && sugg.option !== picked) {
        return result(picked, 'jev', 'jev', [`jev picked ${quote(label(picked))}, but Qwen suggested ${quote(label(sugg.option))}: ${qwenReason.replace(/\.$/, '')}`, 'They disagree, so with Auto off Line asks you'], { reasonUsed: true, lowConfidence: true });
      }
      const reasons = sugg ? [qwenReason, 'jev agreed with it'] : [jevSaid ?? (feedback ? 'jev picked this fix from the ones Construct offered' : 'jev picked it from the checked options')];
      return result(picked, 'jev', 'jev', reasons, { reasonUsed: true, lowConfidence: Boolean(c.lowConfidence) });
    } catch (e) {
      return withoutJev({ fellBackFrom: 'reason', note: `The reason module failed (${one(e?.message ?? e).slice(0, 120)}), so Line decided without jev` });
    }
  }

  /**
   * Decide, apply through Construct, and on a refusal decide again over its typed fixes; stop when it lands, when a
   * round does not improve the score, or after `maxRounds`; then ask the person ONE question.
   * @param {string} step
   * @param {Parameters<typeof decide>[1]} options
   * @param {Parameters<typeof decide>[2]} context
   * @param {{ apply: (choice: string, decision: any) => Promise<{ ok: boolean, refusal?: { sentence: string, fixes: any[] } | null, score?: number }> | { ok: boolean, refusal?: any, score?: number }, maxRounds?: number }} run
   *   `apply` runs the choice (as a plan step, through Construct's writer) and answers ok, or the refusal with its typed
   *   fixes; `score` (higher is better; default 1 for ok, else minus the number of fixes left) decides "improved".
   * @returns {Promise<import('../engine/line/contract.mjs').DecideLoopResult>}
   */
  async function decideUntilAccepted(step, options, context, run) {
    const maxRounds = Math.max(1, Math.min(run.maxRounds ?? 4, 8));
    const rounds = [];
    let ctx = { ...context, refusal: context?.refusal ?? null };
    let opts = options;
    for (;;) {
      const decision = await decide(step, opts, ctx);
      if (decision.choice === null) {
        const refusal = ctx.refusal;
        if (!rounds.length) rounds.push({ decision, ok: false, score: Number.NEGATIVE_INFINITY, refusal });
        return { outcome: 'ask', rounds, question: askQuestion(refusal, ctx, opts) };
      }
      const r = await run.apply(decision.choice, decision);
      const refusal = r?.ok ? null : (r?.refusal ?? { sentence: 'Construct refused the change.', fixes: [] });
      const score = typeof r?.score === 'number' ? r.score : (r?.ok ? 1 : -(refusal.fixes?.length ?? 0) - 1);
      const prev = rounds.at(-1);
      rounds.push({ decision, ok: Boolean(r?.ok), score, refusal });
      if (r?.ok) return { outcome: 'accepted', rounds, question: null };
      if (prev && score <= prev.score) return { outcome: 'ask', rounds, question: askQuestion(refusal, ctx, opts) };
      if (rounds.length >= maxRounds || !refusal.fixes?.length) return { outcome: 'ask', rounds, question: askQuestion(refusal, ctx, opts) };
      ctx = { ...ctx, refusal, suggestion: null };
      opts = [];
    }
  }

  return { decide, decideUntilAccepted };
}

/** One plain question for the person: the refusal and its fixes, or the original options. */
function askQuestion(refusal, ctx, opts) {
  if (refusal) {
    const options = refusalOptions(refusal).map((o) => ({ id: o.id, sentence: sentence(o.label) }));
    const lead = sentence(refusal.sentence).replace(/[.!]$/, '');
    return { sentence: options.length ? `${lead}. Which fix should Line try?` : `${lead}. What should Line do instead?`, options };
  }
  const q = one(ctx?.question ?? 'Which option should Line take').replace(/[.?!]$/, '');
  return { sentence: `${q}?`, options: normalize(opts).map((o) => ({ id: o.id, sentence: sentence(o.label) })) };
}

let shared = null;
/**
 * The process's decider: linked @mx/reason, jev over the local model when it runs.
 * @param {string} step The AI step id.
 * @param {any[]} options The checked options.
 * @param {any} [context] Facts, question and an optional refusal.
 * @returns {Promise<import('../engine/line/contract.mjs').DecideResult>}
 */
export function decide(step, options, context) {
  shared ??= createDecider();
  return shared.decide(step, options, context);
}
/**
 * decideUntilAccepted on the process's decider.
 * @param {string} step The AI step id.
 * @param {any[]} options The checked options.
 * @param {any} context Facts, question and an optional refusal.
 * @param {any} run How to apply a choice (and score it).
 * @returns {Promise<import('../engine/line/contract.mjs').DecideLoopResult>}
 */
export function decideUntilAccepted(step, options, context, run) {
  shared ??= createDecider();
  return shared.decideUntilAccepted(step, options, context, run);
}
