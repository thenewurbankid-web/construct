// cu2 -- Line's one AI decision: decide(step, options, context) -> DecideResult (contract: packages/engine/line/contract.mjs).
// Every AI decision in Cockpit, Construct and Trace goes through here, on the ONE ladder (owner rule):
//
//   static       the options through the caller's check; one left decides (`single`); none left asks the person.
//   middleware   deterministic code a project or Line adds (`context.middleware`, `setup.middleware`): it may pick one of
//                the checked options and say why; it never adds one.
//   picker       Line-1, the one picker (jev fills that role until Line-1 ships, through @mx/reason's runLadder), only
//                when the step's profile is on AND records a measured win over static (ai-profiles.mjs stepOn).
//   verify       Construct checks what was decided when the caller applies it (a refusal comes back as `context.refusal`).
//   person       anything the checks cannot settle goes to the person, one question at a time.
//
// No Qwen pick and no review rung. Fallback: reason not linked, the picker's model not running, or anything throwing:
// static's order stands (`via: static`), and the attribution says why in one sentence. `driver` names who decided.
//
// Feedback (owner rule, LINE.md 2026-10-11): Construct's refusal plus its typed fixes is the standard feedback for every
// AI step. `context.refusal` = {sentence, fixes} makes the typed fixes the options (Construct's recommended one first);
// the step `construct.fix` picks among them, and repairLoop (below, step `construct.repair`) repairs a refused option.
// No outside reasoning engine is in this loop. Local models only: nothing here pulls, loads or stops a model.
import { stepProfile, reasonPairOf, stepOn } from './ai-profiles.mjs';
import { importLinked } from '../line-links/index.mjs';

export const DECIDER_VERSION = 'line-decide-2';

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

/** What the picker reads: the question, the refusal (feedback) and the facts, never code or paths. */
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
 * Middleware: deterministic code that may pick one of the checked options. It gets the step, the checked options, the
 * question, the facts and the refusal; it answers `{option, reason}` or null (pass). An answer that is not a checked
 * option, or a throw, is ignored.
 * @typedef {(q: {step: string, options: {id: string, label: string}[], question: string, facts: string[], refusal: any}) => ({option: string, reason?: string} | null)} DecideMiddleware
 */

/**
 * Line's one AI decision maker on the one ladder; static when the picker is off or down.
 * @param {{ loadReason?: () => Promise<{ module: any, note: string | null }>, jev?: 'auto' | 'off' | import('../line-links/contracts').ReasonPicker, profiles?: object, middleware?: DecideMiddleware[] }} [setup]
 *   `loadReason` defaults to the linked @mx/reason; `jev`: 'auto' builds reason's own jev over the local model (default),
 *   'off' never asks it, or a picker object (tests pass a mock); `profiles` is passed to stepProfile (tests);
 *   `middleware` runs for every step, after the context's own.
 * @returns {{ decide: (step: string, options: any[], context?: any) => Promise<import('../engine/line/contract.mjs').DecideResult> }}
 */
export function createDecider(setup = {}) {
  const loadReason = setup.loadReason ?? defaultLoadReason;
  const jevSetting = setup.jev ?? 'auto';
  let loading = null;
  const pickers = new Map();

  /**
   * @param {string} step A profile's step id.
   * @param {(string | { id: string, label?: string, enabled?: boolean })[]} options Closed options with stable ids (ignored with `context.refusal`).
   * @param {{ question?: string, facts?: string[], check?: (id: string) => string | null, refusal?: { sentence: string, fixes: { id: string, sentence: string, rank: number }[] } | null, picker?: any, middleware?: DecideMiddleware[], memory?: { store: { prefer: Function }, context: any } | null }} [context]
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
    const question = sentence(context.question ?? (feedback ? 'Which fix resolves the refusal?' : 'Which option fits?'));

    /** @returns {import('../engine/line/contract.mjs').DecideResult} */
    const result = (choice, via, by, reasons, extra = {}) => /** @type {any} */ ({
      step,
      choice,
      runnerUp: choice === null ? null : ids.find((x) => x !== choice) ?? null,
      via,
      by,
      driver: choice === null ? 'person' : via === 'jev' ? 'picker' : via,
      reasons: reasons.map(sentence).filter(Boolean),
      lowConfidence: extra.lowConfidence ?? choice === null,
      feedback,
      memory: remembered && choice === remembered.option ? { option: remembered.option, count: remembered.count, sentence: sentence(remembered.sentence) } : null,
      attribution: {
        step,
        provider: extra.reasonUsed ? '@mx/reason' : 'static',
        decider: via,
        model: via === 'jev' ? profile.model : null,
        version: DECIDER_VERSION,
        fellBackFrom: extra.fellBackFrom ?? null,
        note: extra.note ? sentence(extra.note) : null,
      },
    });
    /** Static's order (the recommended fix first for feedback), led by memory when it recalled one. */
    const staticOrder = (extra = {}) => (remembered
      ? result(ids[0], 'static', 'memory', [remembered.sentence], extra)
      : result(ids[0], 'static', 'order', [feedback ? 'It is the fix Construct recommends for this refusal.' : 'It came first among the checked options; no model was asked.'], extra));

    // 1. static
    if (!ids.length) {
      return result(null, 'static', 'none', [feedback ? 'Construct offered no fix that can run, so Line asks you.' : 'No option passed the checks, so Line asks you.'], { lowConfidence: true });
    }
    if (ids.length === 1) {
      return result(ids[0], 'static', 'single', [feedback ? 'It is the only fix Construct offered for this refusal.' : 'It is the only option that passed the checks.']);
    }
    // 2. middleware: the first that picks a checked option decides.
    for (const mw of [...(context.middleware ?? []), ...(setup.middleware ?? [])]) {
      let m = null;
      try { m = mw({ step, options: checked.map(({ id, label }) => ({ id, label })), question, facts: context.facts ?? [], refusal: context.refusal ?? null }); } catch { m = null; }
      if (m && ids.includes(m.option)) return result(m.option, 'middleware', 'middleware', [m.reason || 'Line\'s middleware picked it from the checked options']);
    }
    // 3. the picker: only for a decide step whose profile is on and measured.
    if (!stepOn(profile) || profile.kind !== 'decide' || profile.provider !== 'ollama') return staticOrder();

    loading ??= Promise.resolve().then(loadReason).catch((e) => ({ module: null, note: `the reason module could not be loaded (${one(e?.message ?? e).slice(0, 120)})` }));
    const loaded = await loading;
    if (!loaded.module) {
      return staticOrder({ fellBackFrom: 'reason', note: `${(loaded.note ?? 'The reason module is not linked').replace(/\.$/, '')}; Line decided without the picker` });
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
      const noJev = picker ? `The local model for the picker (${profile.model}) is not running, so Line decided without it` : 'The picker is turned off here, so Line decided without it';
      // The picker reads the options' plain labels; the ids map back. Labels must be unique, else the ids are shown.
      const labels = checked.map((o) => o.label);
      const values = new Set(labels).size === labels.length ? labels : ids;
      const toId = (v) => ids[values.indexOf(v)] ?? null;
      const q = { question, facts: context.facts ?? [], refusal: feedback ? one(context.refusal.sentence) : null };
      // With the picker down or off, the ladder still runs (static through reason) and its order stands.
      const run = await reason.runLadder([{ key: step, q, profile: defined, options: values }], {
        ...(up ? { picker } : {}),
        check: (_q, v) => (values.includes(v) ? null : `${quote(v)} is not one of the checked options.`),
      });
      const c = run.choices?.[0];
      const picked = c ? toId(c.picked) : null;
      if (!up) return staticOrder({ fellBackFrom: 'jev', note: noJev, reasonUsed: true });
      if (!c || picked === null || c.by === 'none') return staticOrder({ fellBackFrom: 'jev', note: 'The picker gave no answer, so Line decided without it', reasonUsed: true });
      if (c.by === 'single') return result(picked, 'static', 'single', ['It is the only option that passed the checks.'], { reasonUsed: true });
      if (c.by !== 'jev') return staticOrder({ fellBackFrom: 'jev', note: 'The picker was not asked, so Line decided without it', reasonUsed: true });
      const said = (c.reasoning ?? []).filter((r) => one(r)).at(-1);
      return result(picked, 'jev', 'jev', [said ?? (feedback ? 'The picker chose this fix from the ones Construct offered' : 'The picker chose it from the checked options')], { reasonUsed: true, lowConfidence: Boolean(c.lowConfidence) });
    } catch (e) {
      return staticOrder({ fellBackFrom: 'reason', note: `The reason module failed (${one(e?.message ?? e).slice(0, 120)}), so Line decided without the picker` });
    }
  }

  return { decide };
}

// ------------------------------------------------------------------------------------------------- im2: one repair
// When a change fails Construct's check (and the fix construct.fix picked did not land it), the step's local model
// (construct.repair, the 1.5B) gets the exact error -- the refusal sentence, the finding, the typed fixes -- and the
// option, and repairs it (repairLoop: up to maxAttempts, default 4, each seeing every earlier attempt and its refusal;
// owner, 12 Oct). It runs only while the construct.repair profile is on and measured. Its output is constrained to the
// option's schema (Ollama's `format` JSON Schema: the tool is fixed, the arguments are the tool's own). Each repaired
// option is checked again by the caller's `check` (Construct, on a copy); without a check, one repair is proposed and the
// caller checks it as a plan step that still waits for approval. Still refused: the person decides. Nothing is written here.

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
 * The fixed repair prompt: only the error (refusal sentence, finding, typed fixes), the option, and every earlier attempt
 * with Construct's refusal of it (so the model reasons from what already failed). No code, no files.
 * @param {{tool: string, args: any}} option
 * @param {{sentence: string, rule?: string|null, code?: string|null, finding?: string|null, fixes?: {id?: string, sentence: string, step?: any}[]}} refusal
 * @param {{reason?: string, option: {tool: string, args: any}|null, refusal?: {sentence: string}|null, outcome: string}[]} [earlier]
 * @param {{reason?: boolean}} [o] `reason: false` asks for the option only (no reason field).
 * @returns {string}
 */
export function repairPrompt(option, refusal, earlier = [], o = {}) {
  const lines = [
    'Construct refused this change.',
    `Error: ${one(refusal.sentence)}`,
  ];
  if (refusal.rule || refusal.code) lines.push(`Finding: ${[refusal.rule, refusal.code].filter(Boolean).join(' ')}${refusal.finding ? `: ${one(refusal.finding)}` : ''}`);
  (refusal.fixes ?? []).slice(0, 5).forEach((f, i) => lines.push(`Typed fix ${i + 1}: ${one(f.sentence)}${f.step ? ` ${JSON.stringify(f.step)}` : ''}`));
  lines.push(`Change: ${JSON.stringify({ tool: option.tool, args: option.args })}`);
  earlier.forEach((t, i) => lines.push(`Attempt ${i + 1}: ${t.option ? JSON.stringify(t.option.args) : 'no valid change'} was refused too: ${one(t.refusal?.sentence ?? t.outcome)}`));
  if (earlier.length) lines.push('Do not repeat a change that was already refused.');
  lines.push(o.reason === false
    ? 'The change above is wrong. Answer with the corrected change as JSON {"tool", "args"}: keep the tool, and change the argument the error names to a value the error or the fixes give.'
    : 'The change above is wrong. First give a short reason (which argument is wrong and what it should be), then the corrected change, as JSON {"reason", "tool", "args"}: keep the tool, and change the argument the error names to a value the error or the fixes give.');
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

/** The repair's output schema: a short reason first (grammar-constrained, recorded on the trace), then the option. */
function withReason(schema) {
  return { ...schema, properties: { reason: { type: 'string', minLength: 3, maxLength: 160 }, ...schema.properties }, required: ['reason', ...(schema.required ?? ['tool', 'args'])] };
}

/** One progress sentence for the person, per attempt. */
function progressSentence(n, max, reason) {
  const why = one(reason).replace(/[.!?]+$/, '');
  const lead = n === 1 ? `Line is asking the local model to repair it (1 of ${max})` : `Line is trying again (${n} of ${max})`;
  return `${lead}${why ? `: ${why.charAt(0).toLowerCase()}${why.slice(1)}` : ''}.`;
}

/**
 * The local model repairs a refused option, reasoning from Construct's error and every earlier attempt, up to
 * `maxAttempts` times (profile construct.repair `maxAttempts`, default 4). Before each attempt it writes a short reason
 * (a fixed field of its grammar-constrained reply), then the option; Construct checks each repaired option (`check`).
 * Stops early when an attempt lands, repeats an earlier one, or passes no more checks than the last one (`passed`, when
 * the check reports it); otherwise after the last attempt. Not landed: the person decides, with every attempt listed.
 * `onProgress` gets one plain sentence per attempt, in order ("Line is trying again (2 of 4): ...").
 * @param {{tool: string, args: Record<string, unknown>}} option The refused option (a plan step).
 * @param {{sentence: string, rule?: string|null, code?: string|null, finding?: string|null, fixes?: any[]}} refusal Construct's refusal.
 * @param {{ schema?: any, check?: (option: {tool: string, args: any}) => Promise<{ok: boolean, refusal?: any, passed?: number}> | {ok: boolean, refusal?: any, passed?: number},
 *   propose?: (q: {prompt: string, schema: any, model: string, maxTokens: number}) => Promise<string>, profiles?: object, now?: () => number,
 *   maxAttempts?: number, onProgress?: (sentence: string, attempt: number) => void, model?: string, reason?: boolean }} [o]
 *   `model` and `reason` (ask for a short reason first) default to the construct.repair profile (its `reason` is false:
 *   measured faster and no worse without it); with neither set, a reason is asked for.
 *   Without `check` only one repair is proposed (outcome "proposed"): the caller checks it as a plan step.
 * @returns {Promise<import('../engine/line/contract.mjs').RepairAttempt>}
 */
export async function repairLoop(option, refusal, o = {}) {
  const profile = /** @type {any} */ (stepProfile(REPAIR_STEP, o.profiles));
  const model = o.model ?? profile.model ?? 'qwen2.5-coder:1.5b';
  // The profile is the only switch: construct.repair off (or not measured) means no model is asked and the person decides.
  if (!stepOn(profile)) {
    return { v: 2, step: REPAIR_STEP, model, attempts: 0, maxAttempts: 1, outcome: 'off', before: { tool: option.tool, args: option.args }, option: null, refusal: { sentence: sentence(refusal?.sentence ?? 'Construct refused the change.'), rule: refusal?.rule ?? null, code: refusal?.code ?? null, fixes: [] }, after: null, tries: [], progress: [], sentence: 'The repair step is off in its profile (no measured win), so Line did not ask a model and you decide.', ms: 0 };
  }
  const useReason = o.reason ?? profile.reason ?? true;
  const max = o.check ? Math.max(1, Math.min(o.maxAttempts ?? profile.maxAttempts ?? 4, 8)) : 1;
  const shape = o.schema ?? optionSchema(option);
  const schema = useReason ? withReason(shape) : shape;
  const now = o.now ?? Date.now;
  const t0 = now();
  const err = { sentence: sentence(refusal?.sentence ?? 'Construct refused the change.'), rule: refusal?.rule ?? null, code: refusal?.code ?? null, fixes: (refusal?.fixes ?? []).slice(0, 5).map((f) => ({ id: String(f.id ?? f.fixId ?? 'fix'), sentence: sentence(f.sentence ?? '') })) };
  /** @type {any[]} */
  const tries = [];
  /** @type {string[]} */
  const progress = [];
  const seen = [JSON.stringify(option.args)];
  /** @returns {any} */
  const done = (outcome, landed, said) => {
    const last = [...tries].reverse().find((t) => t.option && t.refusal) ?? null;
    const failed = ['still-refused', 'no-better'].includes(outcome) && last;
    return {
      v: 2, step: REPAIR_STEP, model, attempts: tries.length, maxAttempts: max, outcome, before: { tool: option.tool, args: option.args },
      option: landed ?? (failed ? last.option : null), refusal: err, after: failed ? last.refusal : null,
      tries, progress, sentence: sentence(said), ms: Math.max(0, now() - t0),
    };
  };
  const listed = () => (tries.length === 1 ? 'the attempt is' : `all ${tries.length} attempts are`);
  let lastPassed = null;
  for (let n = 1; n <= max; n++) {
    let text;
    try {
      text = await (o.propose ?? ((q) => ollamaPropose(q)))({ prompt: repairPrompt(option, refusal, tries, { reason: useReason }), schema, model, maxTokens: profile.maxTokens ?? 300 });
    } catch (e) {
      if (n === 1) {
        const no = /** @type {any} */ (e)?.code === 'NO_MODEL';
        return done('no-model', null, no ? `The local model ${model} is not running, so Line did not try a repair and the static path is unchanged` : `The repair could not run (${one(/** @type {any} */ (e)?.message ?? e).slice(0, 80)}), so the static path is unchanged`);
      }
      return done('still-refused', null, `The local model stopped answering after ${tries.length} ${tries.length === 1 ? 'attempt' : 'attempts'}, so you decide; ${listed()} under Details`);
    }
    let parsed = null;
    try { parsed = JSON.parse(String(text).trim().replace(/^```(?:json)?\s*|\s*```$/g, '')); } catch { parsed = null; }
    const reason = typeof parsed?.reason === 'string' ? one(parsed.reason).slice(0, 160) : '';
    const say = progressSentence(n, max, reason);
    progress.push(say);
    o.onProgress?.(say, n);
    // The model is asked for {reason, tool, args}; the option itself must fit the option's own schema (a missing reason is kept as "").
    if (!parsed || !fits({ tool: parsed.tool, args: parsed.args }, shape) || parsed.tool !== option.tool) {
      tries.push({ n, reason, option: null, outcome: 'invalid', refusal: null, passed: null });
      if (max === 1) return done('invalid', null, `The local model's repair did not fit the shape of a ${option.tool} step, so you decide`);
      if (n === max) return done('still-refused', null, `The local model did not repair it in ${max} attempts, so you decide; ${listed()} under Details`);
      continue;
    }
    const repaired = { tool: option.tool, args: parsed.args };
    const key = JSON.stringify(repaired.args);
    if (seen.includes(key)) {
      const same = key === seen[0] && n === 1;
      tries.push({ n, reason, option: repaired, outcome: same ? 'unchanged' : 'repeat', refusal: null, passed: null });
      if (same) return done('unchanged', null, 'The local model gave back the same change, so you decide');
      return done('repeated', null, `The local model repeated a change that was already refused, so Line stopped and you decide; ${listed()} under Details`);
    }
    seen.push(key);
    if (!o.check) { tries.push({ n, reason, option: repaired, outcome: 'proposed', refusal: null, passed: null }); return done('proposed', repaired, 'The local model proposed a repair; Construct checks it before anything is written'); }
    let r;
    try { r = await o.check(repaired); } catch (e) { r = { ok: false, refusal: { sentence: one(/** @type {any} */ (e)?.message ?? e) || 'Construct refused it.' } }; }
    const passed = typeof r?.passed === 'number' ? r.passed : null;
    if (r?.ok) {
      tries.push({ n, reason, option: repaired, outcome: 'landed', refusal: null, passed });
      return done('repaired', repaired, n === 1 ? 'The local model repaired the change from Construct\'s error, and Construct accepts it' : `The local model repaired the change on attempt ${n} of ${max}, and Construct accepts it`);
    }
    const again = { sentence: sentence(r?.refusal?.sentence ?? 'Construct refused it.'), rule: r?.refusal?.rule ?? null, code: r?.refusal?.code ?? null };
    tries.push({ n, reason, option: repaired, outcome: 'refused', refusal: again, passed });
    if (passed !== null && lastPassed !== null && passed <= lastPassed) return done('no-better', null, `Attempt ${n} passed no more checks than the one before, so Line stopped and you decide; ${listed()} under Details`);
    if (passed !== null) lastPassed = passed;
    if (n === max) {
      const last = again.sentence.replace(/[.!?]$/, '');
      return done('still-refused', null, max === 1 ? `The local model's repair was refused too (${last}), so you decide` : `The local model did not repair it in ${max} attempts (the last was refused: ${last}), so you decide; ${listed()} under Details`);
    }
  }
  return done('still-refused', null, 'The local model did not repair it, so you decide');
}

/**
 * One attempt only (repairLoop with maxAttempts 1).
 * @param {Parameters<typeof repairLoop>[0]} option
 * @param {Parameters<typeof repairLoop>[1]} refusal
 * @param {Parameters<typeof repairLoop>[2]} [o]
 * @returns {ReturnType<typeof repairLoop>}
 */
export function repairOnce(option, refusal, o = {}) {
  return repairLoop(option, refusal, { ...o, maxAttempts: 1 });
}


let shared = null;
/**
 * The process's decider: linked @mx/reason, the picker over the local model when its step is on and it runs.
 * @param {string} step The AI step id.
 * @param {any[]} options The checked options.
 * @param {any} [context] Facts, question and an optional refusal.
 * @returns {Promise<import('../engine/line/contract.mjs').DecideResult>}
 */
export function decide(step, options, context) {
  shared ??= createDecider();
  return shared.decide(step, options, context);
}
