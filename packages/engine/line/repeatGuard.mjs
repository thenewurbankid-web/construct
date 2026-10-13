// #912 refusal loop breaker (deterministic, no LLM). Bench run pilot-qwen-7b-r3: 189 of 200 turns were the identical
// refused call line.addRoute {"route":"/cart","page":"features/cart/pages/CartPage.tsx"} -> UNKNOWN_ITEM, answered the
// same way each time. This counts identical refused calls per plan (same tool, same args minus the plan's own fields,
// same refusal code); from the Nth one (3 by default) the refusal says plainly that this exact call was refused N times
// and will not succeed, and leads with one concrete different step as f1 (for UNKNOWN_ITEM on a missing page: the step
// that creates it). The refused call is never offered back, as a fix or as the example.
//
//   createRepeatGuard({store, at})  -> {at, note(planId, req, code)}  how many times this exact call was refused (1 = first)
//   guardFixes(root, req, code, times, fixes, at)   the fixes a refusal offers: never the refused call; escalated, the different step first
//   escalate(r, req, times, at)     the shaped refusal ({text, hint, ...}) with the escalation line first and `repeat` set
import { missingPageFixes } from './build.mjs';
import { stepText } from './hints.mjs';

/** The default N: the 3rd identical refused call escalates. */
export const REPEAT_ESCALATE_AT = 3;

/** A step's args without the plan's own fields (checks, retry, fix links), as a builder would send them. */
const plainArgs = (a) => Object.fromEntries(Object.entries(a && typeof a === 'object' && !Array.isArray(a) ? a : {}).filter(([k]) => !['expect', 'retry', 'fixOf'].includes(k)));
/** Canonical JSON (keys sorted, strings trimmed), so two calls compare whatever order or spacing their args came in. */
const canon = (v) => JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]])) : typeof x === 'string' ? x.trim() : x));

/**
 * One call as text with normalized args: the same text for the same call.
 * @param {{tool?: unknown, args?: unknown}} req
 * @returns {string}
 */
export const callKey = (req) => `${String(req?.tool ?? '')} ${canon(plainArgs(req?.args))}`;

/** Whether a step is the refused call itself. */
const isCall = (step, req) => Boolean(step && req && callKey(step) === callKey(req));

/**
 * Counts identical refused calls per plan. `store` ({get, set}) keeps the counts between processes (plan-cli runs one
 * process per call); without one they live in memory.
 * @param {{store?: {get: () => any, set: (v: any) => void}, at?: number}} [o]
 * @returns {{at: number, note: (planId: string|null|undefined, req: any, code: string) => number}}
 */
export function createRepeatGuard({ store, at = REPEAT_ESCALATE_AT } = {}) {
  /** @type {Record<string, number>} */
  let mem = {};
  const now = () => { try { const v = store?.get(); if (v && typeof v === 'object') return v; } catch { /* none kept */ } return mem; };
  const n = Number.isInteger(at) && at >= 2 ? at : REPEAT_ESCALATE_AT;
  return {
    at: n,
    note(planId, req, code) {
      const key = `${planId ?? '-'}|${String(code)}|${callKey(req)}`;
      const s = { ...now() };
      s[key] = (s[key] ?? 0) + 1;
      mem = s;
      try { store?.set(s); } catch { /* best effort */ }
      return s[key];
    },
  };
}

/**
 * The fixes a refusal offers, given how many times this exact call was refused: never the refused call itself; from the
 * `at`th time, the one concrete different step leads. For UNKNOWN_ITEM on an addRoute to a missing page, that is the
 * step that creates it (line.baseOn under the same feature, or line.createFeature first); with nothing else on offer,
 * that step is added. Refs are f1.. in the order returned.
 * @param {string} root @param {{tool?: any, args?: any}} req @param {string} code @param {number} times
 * @param {any[]} fixes Recommended first (pre-checked). @param {number} [at]
 * @returns {any[]}
 */
export function guardFixes(root, req, code, times, fixes, at = REPEAT_ESCALATE_AT) {
  const others = (fixes ?? []).filter((f) => f?.step && !isCall(f.step, req));
  if (times < at) return others.length === (fixes ?? []).length ? fixes : others.map((f, i) => ({ ...f, rank: i + 1, ref: `f${i + 1}` }));
  let create = [];
  if (code === 'UNKNOWN_ITEM' && req?.tool === 'line.addRoute') {
    try { create = missingPageFixes(root, req.args?.route, req.args?.page); } catch { create = []; }
  }
  const creates = (f) => create.some((c) => callKey(c.step) === callKey(f.step));
  const lead = [...others.filter(creates), ...others.filter((f) => !creates(f))];
  // Nothing different on offer at all: the step that creates the page, unchecked (the gate checks it when it is added).
  const out = lead.length ? lead : create.filter((c) => !isCall(c.step, req)).slice(0, 1);
  return out.map((f, i) => ({ ...f, rank: i + 1, ref: `f${i + 1}` }));
}

/** "tool {json}" -> {tool, args}, or null. */
const parseCall = (s) => {
  const m = /^(\S+) (\{.*\})$/s.exec(String(s ?? ''));
  if (!m) return null;
  try { return { tool: m[1], args: JSON.parse(m[2]) }; } catch { return null; }
};

/**
 * A shaped refusal (planService `say`: {text, hint: {choices, example}, ...}) after `times` identical refusals of `req`.
 * Always: an example equal to the refused call is dropped. From the `at`th time: the text leads with one plain line
 * (refused N times, will not succeed, do this instead: f1) and `repeat` records it for calls.jsonl.
 * @param {any} r @param {{tool?: any, args?: any}} req @param {number} times @param {number} [at]
 * @returns {any}
 */
export function escalate(r, req, times, at = REPEAT_ESCALATE_AT) {
  if (!r || r.ok !== false || !req?.tool) return r;
  let out = r;
  const ex = parseCall(r.hint?.example);
  if (ex && isCall(ex, req)) {
    const text = String(r.text ?? '').split('\n').filter((l) => !l.startsWith('A correct call: ')).join('\n');
    out = { ...out, text, hint: { ...r.hint, example: null } };
  }
  if (times < at) return out;
  const call = stepText({ tool: String(req.tool), args: plainArgs(req.args) });
  const first = (out.fixes ?? [])[0];
  // #932: when Line knows the corrected line (exampleFix.mjs), the stop shows it: the change that gets past it.
  const known = Array.isArray(r.hint?.exampleFixes) ? r.hint.exampleFixes : [];
  const shown = known.length ? ` Change the code where the error points, then send the whole file again. ${known.join(' ')}` : '';
  const instead = first?.step
    ? `Do this instead: ${first.ref ?? 'f1'}: ${stepText(first.step)}${first.sentence ? ` (${String(first.sentence).replace(/[.]$/, '')})` : ''}. Send {"fix":"${first.ref ?? 'f1'}"}.`
    : known.length ? 'Do not send it again unchanged.'
      : 'Do not send it again: change the request (another page, tool or feature), or read plan status for what is open.';
  const line = `Stop: this exact call was already refused ${times} times with ${r.code} and will not succeed if sent again: ${call}. ${instead}${shown}`;
  return {
    ...out,
    text: [line, out.text ?? out.sentence].filter(Boolean).join('\n'),
    repeat: { times, at, escalated: true, call, code: String(r.code), lead: first?.step ? { ref: first.ref ?? 'f1', id: first.id ?? null, step: first.step } : null },
  };
}
