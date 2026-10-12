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
   * @param {{ question?: string, facts?: string[], check?: (id: string) => string | null, suggestion?: { option: string, reason?: string } | null, refusal?: { sentence: string, fixes: { id: string, sentence: string, rank: number }[] } | null, picker?: any }} [context]
   * @returns {Promise<import('../engine/line/contract.mjs').DecideResult>}
   */
  async function decide(step, options, context = {}) {
    const profile = stepProfile(step, setup.profiles);
    const feedback = Boolean(context.refusal);
    const offered = feedback ? refusalOptions(context.refusal) : normalize(options);
    const checked = offered.filter((o) => !context.check || context.check(o.id) === null);
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
   *   im2: with `optionOf(id)` (the option as a plan step {tool, args}) and `applyOption(option)` (apply a repaired
   *   option the same way), a refused option Qwen or jev chose gets ONE repair by the local model (repairOnce); `repair`
   *   passes {propose, schemaOf} through, or `false` turns it off. The attempt is kept on its round (`round.repair`).
   * @returns {Promise<import('../engine/line/contract.mjs').DecideLoopResult>}
   */
  async function decideUntilAccepted(step, options, context, run) {
    const maxRounds = Math.max(1, Math.min(run.maxRounds ?? 4, 8));
    const rounds = [];
    let repaired = false;
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
      // im2: an option Qwen or jev chose was refused: the local model gets the exact error and makes ONE repair, which is
      // applied (checked by Construct, waiting for approval like any step) once. Still refused: the person decides. The
      // model not running leaves the static loop unchanged (the round says so).
      const option = !repaired && run.optionOf && run.applyOption && run.repair !== false && (decision.via === 'jev' || decision.via === 'model') ? run.optionOf(decision.choice) : null;
      if (option) {
        repaired = true;
        const attempt = await repairOnce(option, refusal, { ...(run.repair ?? {}), schema: run.repair?.schemaOf?.(option), check: (opt) => run.applyOption(opt, decision), profiles: setup.profiles });
        rounds[rounds.length - 1] = { ...rounds.at(-1), repair: attempt };
        if (attempt.outcome === 'repaired') return { outcome: 'accepted', rounds, question: null };
        if (attempt.outcome !== 'no-model') {
          const last = attempt.after ? { ...attempt.after, fixes: refusal.fixes ?? [] } : refusal;
          return { outcome: 'ask', rounds, question: askQuestion(last, ctx, opts) };
        }
      }
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

// ------------------------------------------------------------------------------------------------- im2: one repair
// When an option Qwen or jev chose fails Construct's check, the step's local model (construct.repair, the 1.5B) gets the
// exact error -- the refusal sentence, the finding, the typed fixes -- and the option, and makes ONE repair attempt. Its
// output is constrained to the option's schema (Ollama's `format` JSON Schema: the tool is fixed, the arguments are the
// tool's own). The repaired option is checked again by the caller's `check` (Construct, on a copy or as a plan step that
// still waits for approval); if it still fails, the person decides. Exactly one attempt; nothing is written here.

export const REPAIR_STEP = 'construct.repair';
const REPAIR_PLAN_ONLY = new Set(['expect', 'retry', 'fixOf']);

/**
 * The JSON Schema a repaired option must fit: the same tool, and the tool's own arguments (plan-only extras left out).
 * @param {{tool: string}} option
 * @param {any} [argsSchema] The tool's arguments schema (planTools.mjs lineToolSpecs); without it any object.
 * @returns {any}
 */
export function optionSchema(option, argsSchema) {
  const props = Object.fromEntries(Object.entries(argsSchema?.properties ?? {}).filter(([k]) => !REPAIR_PLAN_ONLY.has(k)));
  const args = argsSchema ? { type: 'object', properties: props, required: (argsSchema.required ?? []).filter((k) => !REPAIR_PLAN_ONLY.has(k)), additionalProperties: false } : { type: 'object' };
  return { type: 'object', properties: { tool: { type: 'string', enum: [option.tool] }, args }, required: ['tool', 'args'], additionalProperties: false };
}

/** Whether a value fits the (small) schema subset optionSchema emits: enum, type, required, no extra keys. */
function fits(v, s) {
  if (!s || typeof s !== 'object') return true;
  if (s.enum && !s.enum.includes(v)) return false;
  if (s.type === 'object') {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
    if ((s.required ?? []).some((k) => !(k in v))) return false;
    if (s.additionalProperties === false && s.properties && Object.keys(v).some((k) => !(k in s.properties))) return false;
    return Object.entries(s.properties ?? {}).every(([k, sub]) => !(k in v) || fits(v[k], sub));
  }
  if (s.type === 'string') return typeof v === 'string' && (s.minLength === undefined || v.length >= s.minLength);
  if (s.type === 'integer') return Number.isInteger(v);
  if (s.type === 'number') return typeof v === 'number';
  if (s.type === 'boolean') return typeof v === 'boolean';
  if (s.type === 'array') return Array.isArray(v) && (!s.items || v.every((x) => fits(x, s.items)));
  if (Array.isArray(s.type)) return s.type.some((t) => fits(v, { ...s, type: t }));
  return true;
}

/**
 * The fixed repair prompt: only the error (refusal sentence, finding, typed fixes) and the option. No code, no files.
 * @param {{tool: string, args: any}} option
 * @param {{sentence: string, rule?: string|null, code?: string|null, finding?: string|null, fixes?: {id?: string, sentence: string, step?: any}[]}} refusal
 * @returns {string}
 */
export function repairPrompt(option, refusal) {
  const lines = [
    'Construct refused this change.',
    `Error: ${one(refusal.sentence)}`,
  ];
  if (refusal.rule || refusal.code) lines.push(`Finding: ${[refusal.rule, refusal.code].filter(Boolean).join(' ')}${refusal.finding ? `: ${one(refusal.finding)}` : ''}`);
  (refusal.fixes ?? []).slice(0, 5).forEach((f, i) => lines.push(`Typed fix ${i + 1}: ${one(f.sentence)}${f.step ? ` ${JSON.stringify(f.step)}` : ''}`));
  lines.push(`Change: ${JSON.stringify({ tool: option.tool, args: option.args })}`);
  lines.push('The change above is wrong. Answer with the corrected change as JSON {"tool", "args"}: keep the tool, and change the argument the error names to a value the error or the fixes give.');
  return lines.join('\n');
}

/**
 * Ask a local model through Ollama, its output constrained to `schema` (Ollama's structured `format`).
 * @param {{prompt: string, schema: any, model: string, maxTokens?: number, host?: string, fetch?: typeof fetch, timeoutMs?: number}} q
 * @returns {Promise<string>} The model's reply (JSON text). Throws with `code: 'NO_MODEL'` when Ollama or the model is not there.
 */
export async function ollamaPropose(q) {
  const host = (q.host ?? process.env.OLLAMA_HOST ?? 'http://127.0.0.1:11434').replace(/\/$/, '');
  const f = q.fetch ?? fetch;
  let res;
  try {
    res = await f(`${/^https?:/.test(host) ? host : `http://${host}`}/api/generate`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: q.model, prompt: q.prompt, format: q.schema, stream: false, options: { temperature: 0, num_predict: q.maxTokens ?? 300 } }),
      signal: AbortSignal.timeout(q.timeoutMs ?? 60_000),
    });
  } catch (e) {
    throw Object.assign(new Error(`Ollama is not running (${one(/** @type {any} */ (e)?.message ?? e).slice(0, 80)})`), { code: 'NO_MODEL' });
  }
  if (!res.ok) throw Object.assign(new Error(`Ollama answered ${res.status}${res.status === 404 ? `: the model ${q.model} is not installed` : ''}`), { code: 'NO_MODEL' });
  const body = /** @type {any} */ (await res.json());
  return String(body.response ?? '');
}

/**
 * ONE repair of a refused option by the local model, then (with `check`) one more check by Construct.
 * @param {{tool: string, args: Record<string, unknown>}} option The refused option (a plan step).
 * @param {{sentence: string, rule?: string|null, code?: string|null, finding?: string|null, fixes?: any[]}} refusal Construct's refusal.
 * @param {{ schema?: any, check?: (option: {tool: string, args: any}) => Promise<{ok: boolean, refusal?: any}> | {ok: boolean, refusal?: any},
 *   propose?: (q: {prompt: string, schema: any, model: string, maxTokens: number}) => Promise<string>, profiles?: object, now?: () => number }} [o]
 *   `schema`: the option's schema (optionSchema); `check`: Construct's check of the repaired option (no write before a
 *   person approves); `propose`: the model call (default: Ollama with the construct.repair profile's model).
 * @returns {Promise<import('../engine/line/contract.mjs').RepairAttempt>}
 */
export async function repairOnce(option, refusal, o = {}) {
  const profile = stepProfile(REPAIR_STEP, o.profiles);
  const model = profile.model ?? 'qwen2.5-coder:1.5b';
  const schema = o.schema ?? optionSchema(option);
  const now = o.now ?? Date.now;
  const t0 = now();
  const err = { sentence: sentence(refusal?.sentence ?? 'Construct refused the change.'), rule: refusal?.rule ?? null, code: refusal?.code ?? null, fixes: (refusal?.fixes ?? []).slice(0, 5).map((f) => ({ id: String(f.id ?? f.fixId ?? 'fix'), sentence: sentence(f.sentence ?? '') })) };
  const done = (outcome, repaired, after, said) => ({ v: 1, step: REPAIR_STEP, model, attempts: 1, outcome, before: { tool: option.tool, args: option.args }, option: repaired, refusal: err, after: after ?? null, sentence: sentence(said), ms: Math.max(0, now() - t0) });
  let text;
  try {
    text = await (o.propose ?? ((q) => ollamaPropose(q)))({ prompt: repairPrompt(option, refusal), schema, model, maxTokens: profile.maxTokens ?? 300 });
  } catch (e) {
    const no = /** @type {any} */ (e)?.code === 'NO_MODEL';
    return { ...done('no-model', null, null, no ? `The local model ${model} is not running, so Line did not try a repair and the static path is unchanged` : `The repair could not run (${one(/** @type {any} */ (e)?.message ?? e).slice(0, 80)}), so the static path is unchanged`), attempts: 0 };
  }
  let parsed = null;
  try { parsed = JSON.parse(String(text).trim().replace(/^```(?:json)?\s*|\s*```$/g, '')); } catch { parsed = null; }
  if (!parsed || !fits(parsed, schema) || parsed.tool !== option.tool) return done('invalid', null, null, `The local model's repair did not fit the shape of a ${option.tool} step, so you decide`);
  const repaired = { tool: option.tool, args: parsed.args };
  if (JSON.stringify(repaired.args) === JSON.stringify(option.args)) return done('unchanged', null, null, 'The local model gave back the same change, so you decide');
  if (!o.check) return done('proposed', repaired, null, 'The local model proposed one repair; Construct checks it before anything is written');
  let r;
  try { r = await o.check(repaired); } catch (e) { r = { ok: false, refusal: { sentence: one(/** @type {any} */ (e)?.message ?? e) || 'Construct refused it.' } }; }
  if (r?.ok) return done('repaired', repaired, null, 'The local model repaired the change once from Construct\'s error, and Construct accepts it');
  const again = r?.refusal ? { sentence: sentence(r.refusal.sentence ?? 'Construct refused it.'), rule: r.refusal.rule ?? null, code: r.refusal.code ?? null, fixes: [] } : { sentence: 'Construct refused it.', rule: null, code: null, fixes: [] };
  return done('still-refused', repaired, again, `The local model's one repair was refused too (${again.sentence.replace(/[.!?]$/, '')}), so you decide`);
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
