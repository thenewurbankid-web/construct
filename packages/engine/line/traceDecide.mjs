// cg1 -- when several tools fit a request, jev picks one with a cloze, through @mx/reason's ladder (the same decision
// provider as cu1/cu2: packages/core/reason-provider.mjs). Static first: one tool decides alone and never reaches here.
//
// No single point of failure: when @mx/reason is not linked, or jev is not reachable (JEV_URL, default
// http://127.0.0.1:8765, open-jev's serve.py), the static order stands and `via` says "static" with why in plain
// English. `via` is "jev" only when jev actually answered.
import { createReasonProvider } from '../../core/reason-provider.mjs';
import { TOOL_WORDS } from './trace.mjs';

/** The cloze jev fills: the request, then a blank the offered tools fit. */
export function clozeOf(request) {
  return `The person asked: "${request}". To do that in Cockpit, they use the tool to ___.`;
}

/**
 * jev over HTTP as a ReasonPicker (packages/line-links/contracts.d.ts): `available` asks /health (short timeout),
 * `pick` sends the cloze and the tools' words to /choose and answers the index of jev's choice.
 * @param {{url?: string, fetchImpl?: typeof fetch, timeoutMs?: number}} [o]
 * @returns {import('../../line-links/contracts').ReasonPicker}
 */
export function createJevPicker(o = {}) {
  const url = (o.url ?? process.env.JEV_URL ?? 'http://127.0.0.1:8765').replace(/\/$/, '');
  const f = o.fetchImpl ?? fetch;
  const timeoutMs = o.timeoutMs ?? 400;
  return {
    name: 'jev',
    async available() {
      try { const r = await f(`${url}/health`, { signal: AbortSignal.timeout(timeoutMs) }); return r.ok; } catch { return false; }
    },
    async pick(q, options) {
      const opts = options.map((t, i) => `${i + 1}) ${TOOL_WORDS[t] ?? t}`);
      const r = await f(`${url}/choose`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(timeoutMs * 10),
        body: JSON.stringify({ state: { part: 'cockpit', facts: [String(/** @type {any} */ (q)?.question ?? '')] }, questions: [{ key: 'choice', text: String(/** @type {any} */ (q)?.question ?? ''), options: opts }] }),
      });
      const j = await r.json();
      return Math.max(0, opts.indexOf(j?.answers?.[0]?.choice));
    },
  };
}

/**
 * A `decide` for traceMatch: jev through @mx/reason when both are up, else the static order.
 * @param {{picker?: import('../../line-links/contracts').ReasonPicker | null, loadReason?: () => Promise<any>}} [o]
 *   `picker` defaults to jev over HTTP (null: static only); `loadReason` defaults to the linked @mx/reason.
 * @returns {(options: string[], request: string) => Promise<{picked: string, via: 'static'|'jev', note: string}>}
 */
export function createTraceDecide(o = {}) {
  const base = o.picker === undefined ? createJevPicker() : o.picker;
  let asked = false;
  let down = null;
  const picker = base && {
    name: base.name,
    async available(p) { const up = await base.available(p).catch(() => false); if (!up) down = 'jev is not reachable'; return up; },
    async pick(q, options, p) { asked = true; return base.pick(q, options, p); },
  };
  const provider = createReasonProvider({ ...(o.loadReason ? { loadReason: o.loadReason } : {}), ...(picker ? { picker } : {}) });
  return async (options, request) => {
    asked = false; down = picker ? null : 'no jev is set up';
    const summary = { id: 'cg1.trace', question: clozeOf(request), options: options.map((id) => ({ id, enabled: true })), chosen: null };
    const r = await provider.suggest(summary).catch(() => null);
    if (r && asked && options.includes(r.option)) return { picked: r.option, via: 'jev', note: 'jev picked it' };
    const why = provider.lastNote() ? 'the reason module is not available' : down ?? 'jev did not answer';
    return { picked: options[0], via: 'static', note: `it comes first in Line's static order (${why})` };
  };
}
