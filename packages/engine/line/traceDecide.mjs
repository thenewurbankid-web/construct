// cg1 -- when several tools fit a request, Line's one decide() picks (packages/core/line-decide.mjs, step
// construct.chooser), with the request as a cloze for the picker. Static first: one tool decides alone and never reaches
// here. construct.chooser is off until it records a measured win, so today the static order stands and says so.
//
// No single point of failure: the picker off, not linked or not running, or decide() throwing, all keep the static
// order, and `via` says "static" with why in plain English. `via` is "jev" only when the picker actually answered.
import { decide as lineDecide } from '@line/construct-core/line-decide';

/**
 * The cloze the picker fills: the request, then a blank the offered tools fit.
 * @param {string} request
 * @returns {string}
 */
export function clozeOf(request) {
  return `The person asked: "${request}". To do that in Cockpit, they use the tool to ___.`;
}

/**
 * A `decide` for traceMatch over Line's one decide(), else the static order.
 * @param {{decide?: typeof lineDecide}} [o] `decide` defaults to Line's one decide() (tests pass a mock's).
 * @returns {(options: string[], request: string) => Promise<{picked: string, via: 'static'|'jev', note: string}>}
 */
export function createTraceDecide(o = {}) {
  const run = o.decide ?? lineDecide;
  return async (options, request) => {
    const d = await Promise.resolve().then(() => run('construct.chooser', options, { question: clozeOf(request) })).catch(() => null);
    if (d && d.via === 'jev' && options.includes(/** @type {string} */ (d.choice))) return { picked: /** @type {string} */ (d.choice), via: 'jev', note: 'jev picked it' };
    const why = !d ? 'the decision failed' : d.attribution?.note ? d.attribution.note.replace(/[.!?]$/, '').replace(/^\w/, (c) => c.toLowerCase()) : 'the picker is off for this step';
    return { picked: options[0], via: 'static', note: `it comes first in Line's static order (${why})` };
  };
}
