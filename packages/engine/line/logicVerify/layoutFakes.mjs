// Line logic verification, spec E: layout as input. The layout-fake GENERATOR interface (its types named after
// lib.dom.d.ts: DOMRect, offset/scroll/client sizes, innerWidth, IntersectionObserverEntry, ResizeObserverEntry,
// MediaQueryList, and scroll/resize/pointer/visibility events) and its VALUE STRATEGY: the characterizer's mined
// comparison literals (characterize/analyze.mjs ClosureAnalysis.pools) at the boundary +-1, plus 0, negative and large.
// Step 5 adds mergePools (both sides' literals), LAYOUT_BASE / layoutBase and layoutCases here; the generator is
// layoutFakeGen.mjs, the fake DOM and observers layoutDom.mjs, the clock layoutClock.mjs, matchMedia layoutMedia.mjs and
// the runner helper layoutRun.mjs.
// test/line-logic-verify-contract.test.mjs checks every name below against TypeScript's own lib.dom.d.ts.

/** @typedef {'number'|'boolean'|'string'|'DOMRect'|'DOMRect|null'|'ResizeObserverSize[]'|'Element'} LayoutValueType */

/**
 * One fakeable layout type: the lib.dom.d.ts interface its members are declared on, and the members a fake sets.
 * @typedef {{name: string, from: string, members: Record<string, LayoutValueType>}} LayoutFakeType
 */

/**
 * One layout event a fake fires: the DOM event name, where it fires, its lib.dom.d.ts event interface and the layout
 * reads (`<type>.<member>`) whose values it carries or changes.
 * @typedef {{event: string, target: 'window'|'document'|'element'|'mediaQueryList', interface: string, reads: string[]}} LayoutEvent
 */

/** The characterizer's literal pools (characterize/analyze.mjs ClosureAnalysis.pools). */
/** @typedef {{strings: string[], numbers: number[], byKey: Record<string, (string|number)[]>}} LiteralPools */

/**
 * One layout scenario: a value per read, e.g. {"Window.innerWidth": 767}.
 * @typedef {{reads: Record<string, unknown>}} LayoutCase
 */

/**
 * The generator step 5 implements.
 * @typedef {object} LayoutFakeGenerator
 * @property {readonly LayoutFakeType[]} types
 * @property {readonly LayoutEvent[]} events
 * @property {(type: string, member: string, pools: LiteralPools) => unknown[]} values  layoutValues.
 * @property {(reads: string[], pools: LiteralPools) => LayoutCase[]} cases  One case per value of one read, others at a
 *   neutral base (each boundary is exercised alone).
 * @property {(type: string, c: LayoutCase) => object} make  A typed fake (a DOMRect, an IntersectionObserverEntry ...).
 * @property {(dom: import('./fakes.mjs').DomStub, clock: import('./fakes.mjs').ClockFake, event: LayoutEvent, c: LayoutCase) => void} fire
 *   Fire an event or an observer callback with the case's values, under the fake clock.
 */

const NUM = 'number';
const rect = /** @type {Record<string, LayoutValueType>} */ ({ x: NUM, y: NUM, width: NUM, height: NUM, top: NUM, right: NUM, bottom: NUM, left: NUM });

/** The fakeable layout types. `name` is what code sees; `from` is where lib.dom.d.ts declares the members. */
export const LAYOUT_FAKE_TYPES = Object.freeze(/** @type {LayoutFakeType[]} */ ([
  { name: 'DOMRect', from: 'DOMRectReadOnly', members: rect },
  { name: 'HTMLElement', from: 'HTMLElement', members: { offsetWidth: NUM, offsetHeight: NUM, offsetTop: NUM, offsetLeft: NUM } },
  { name: 'Element', from: 'Element', members: { scrollWidth: NUM, scrollHeight: NUM, scrollTop: NUM, scrollLeft: NUM, clientWidth: NUM, clientHeight: NUM, clientTop: NUM, clientLeft: NUM } },
  { name: 'Window', from: 'Window', members: { innerWidth: NUM, innerHeight: NUM, outerWidth: NUM, outerHeight: NUM, scrollX: NUM, scrollY: NUM, devicePixelRatio: NUM } },
  { name: 'Document', from: 'Document', members: { visibilityState: 'string', hidden: 'boolean' } },
  { name: 'IntersectionObserverEntry', from: 'IntersectionObserverEntry', members: { boundingClientRect: 'DOMRect', intersectionRect: 'DOMRect', rootBounds: 'DOMRect|null', intersectionRatio: NUM, isIntersecting: 'boolean', time: NUM, target: 'Element' } },
  { name: 'ResizeObserverEntry', from: 'ResizeObserverEntry', members: { contentRect: 'DOMRect', borderBoxSize: 'ResizeObserverSize[]', contentBoxSize: 'ResizeObserverSize[]', devicePixelContentBoxSize: 'ResizeObserverSize[]', target: 'Element' } },
  { name: 'ResizeObserverSize', from: 'ResizeObserverSize', members: { inlineSize: NUM, blockSize: NUM } },
  { name: 'MediaQueryList', from: 'MediaQueryList', members: { matches: 'boolean', media: 'string' } },
  { name: 'MouseEvent', from: 'MouseEvent', members: { clientX: NUM, clientY: NUM, pageX: NUM, pageY: NUM, offsetX: NUM, offsetY: NUM, screenX: NUM, screenY: NUM, movementX: NUM, movementY: NUM, button: NUM, buttons: NUM } },
  { name: 'PointerEvent', from: 'PointerEvent', members: { pointerId: NUM, pointerType: 'string', pressure: NUM, width: NUM, height: NUM, isPrimary: 'boolean' } },
].map((t) => Object.freeze({ ...t, members: Object.freeze(t.members) }))));

/** The layout events a fake fires (event names as in lib.dom.d.ts WindowEventMap / DocumentEventMap / ElementEventMap). */
export const LAYOUT_EVENTS = Object.freeze(/** @type {LayoutEvent[]} */ ([
  { event: 'scroll', target: 'window', interface: 'Event', reads: ['Window.scrollX', 'Window.scrollY'] },
  { event: 'scroll', target: 'element', interface: 'Event', reads: ['Element.scrollTop', 'Element.scrollLeft', 'Element.scrollHeight', 'Element.clientHeight'] },
  { event: 'resize', target: 'window', interface: 'UIEvent', reads: ['Window.innerWidth', 'Window.innerHeight'] },
  { event: 'pointerdown', target: 'element', interface: 'PointerEvent', reads: ['MouseEvent.clientX', 'MouseEvent.clientY', 'PointerEvent.pointerType'] },
  { event: 'pointermove', target: 'element', interface: 'PointerEvent', reads: ['MouseEvent.clientX', 'MouseEvent.clientY', 'MouseEvent.movementX', 'MouseEvent.movementY'] },
  { event: 'pointerup', target: 'element', interface: 'PointerEvent', reads: ['MouseEvent.clientX', 'MouseEvent.clientY'] },
  { event: 'visibilitychange', target: 'document', interface: 'Event', reads: ['Document.visibilityState', 'Document.hidden'] },
  { event: 'change', target: 'mediaQueryList', interface: 'MediaQueryListEvent', reads: ['MediaQueryList.matches', 'MediaQueryList.media'] },
].map((e) => Object.freeze({ ...e, reads: Object.freeze(e.reads) }))));

/** The closed string values a layout member can take (lib.dom.d.ts DocumentVisibilityState, PointerEvent.pointerType). */
export const LAYOUT_STRING_VALUES = Object.freeze({ visibilityState: Object.freeze(['visible', 'hidden']), pointerType: Object.freeze(['mouse', 'pen', 'touch']) });
/** The "large" value: beyond any real viewport, so an "at least" branch is always reached. */
export const LARGE = 100000;
/** At most this many mined literals per member (nearest-first is not knowable statically: the smallest win). */
export const MAX_LITERALS = 8;
const MEDIA_QUERY = /^\(.*\)$|\b(min|max)-(width|height)\b|prefers-/;

/** The step next to a literal: 1 for an integer, else one unit of its last decimal place (0.5 -> 0.1). */
function stepOf(n) {
  if (Number.isInteger(n)) return 1;
  const dec = (String(n).split('.')[1] ?? '').length;
  return 10 ** -dec;
}
const round = (n) => Math.round(n * 1e9) / 1e9;

/**
 * The values to try for one layout member: for numbers, each mined literal compared with that member (else every
 * mined number) at n-1, n and n+1 (fractional literals step by their last decimal), plus 0, a negative and LARGE,
 * deduplicated and sorted; for booleans false and true; for strings the closed set, or the mined media queries.
 * Deterministic and pure.
 * @param {string} type A LAYOUT_FAKE_TYPES name.
 * @param {string} member One of its members.
 * @param {LiteralPools} pools
 * @returns {unknown[]}
 */
export function layoutValues(type, member, pools) {
  const t = LAYOUT_FAKE_TYPES.find((x) => x.name === type);
  if (!t || !(member in t.members)) throw new TypeError(`The layout member ${type}.${member} must be one of LAYOUT_FAKE_TYPES.`);
  const kind = t.members[member];
  if (kind === 'boolean') return [false, true];
  if (kind === 'string') {
    if (member in LAYOUT_STRING_VALUES) return [...LAYOUT_STRING_VALUES[member]];
    const queries = [...new Set((pools.strings ?? []).filter((s) => MEDIA_QUERY.test(s)))].sort();
    return queries.length ? queries : ['(min-width: 0px)'];
  }
  if (kind !== 'number') return [];
  const keyed = /** @type {number[]} */ ((pools.byKey?.[member] ?? []).filter((x) => typeof x === 'number' && Number.isFinite(x)));
  const lits = [...new Set(keyed.length ? keyed : (pools.numbers ?? []).filter(Number.isFinite))].sort((a, b) => a - b).slice(0, MAX_LITERALS);
  const out = new Set([0, -1, LARGE]);
  for (const n of lits) { const s = stepOf(n); out.add(round(n - s)); out.add(n); out.add(round(n + s)); }
  return [...out].sort((a, b) => a - b);
}

// ---- step 5: the value plan over both sides ------------------------------------------------------------------------

const MEDIA_PX = /\b(min|max)-(width|height)\s*:\s*(-?\d+(?:\.\d+)?)(px|em|rem)?/g;
/** The members a media-query width or height also seeds (the viewport is what a media query reads). */
const MEDIA_MEMBERS = Object.freeze({ width: ['innerWidth', 'outerWidth'], height: ['innerHeight', 'outerHeight'] });

/**
 * One literal pool from several (owner decision 4: layout values come from the mined literals of BOTH the before and
 * the after code). Strings and numbers are unioned and sorted; each byKey list is unioned in first-seen order.
 * Media-query widths and heights (`(max-width: 767px)`, `(min-width: 48em)` as 768) also join the keyed pools of the
 * viewport members, so a matchMedia breakpoint is exercised at its boundary like a compared literal.
 * @param {...(LiteralPools|null|undefined)} all
 * @returns {LiteralPools}
 */
export function mergePools(...all) {
  const strings = new Set();
  const numbers = new Set();
  /** @type {Record<string, (string|number)[]>} */
  const byKey = {};
  const add = (k, v) => { const l = (byKey[k] ??= []); if (!l.includes(v)) l.push(v); };
  for (const p of all) {
    if (!p) continue;
    for (const s of p.strings ?? []) strings.add(s);
    for (const n of p.numbers ?? []) if (Number.isFinite(n)) numbers.add(n);
    for (const [k, vs] of Object.entries(p.byKey ?? {})) for (const v of vs) add(k, v);
  }
  for (const s of [...strings].sort()) {
    for (const m of s.matchAll(MEDIA_PX)) {
      const px = Number(m[3]) * (m[4] === 'em' || m[4] === 'rem' ? 16 : 1);
      for (const k of MEDIA_MEMBERS[/** @type {'width'|'height'} */ (m[2])]) add(k, px);
    }
  }
  return { strings: [...strings].sort(), numbers: [...numbers].sort((a, b) => a - b), byKey };
}

/** At most this many cases per unit (each read varies alone, so the cap bounds reads x values). */
export const MAX_CASES = 64;

/** The neutral base a read keeps while another read varies: a desktop viewport, nothing scrolled, the page visible. */
export const LAYOUT_BASE = Object.freeze(/** @type {Record<string, unknown>} */ ({
  'Window.innerWidth': 1024, 'Window.innerHeight': 768, 'Window.outerWidth': 1024, 'Window.outerHeight': 768, 'Window.devicePixelRatio': 1,
  'HTMLElement.offsetWidth': 100, 'HTMLElement.offsetHeight': 100, 'Element.clientWidth': 100, 'Element.clientHeight': 100,
  'Element.scrollWidth': 100, 'Element.scrollHeight': 100, 'DOMRect.width': 100, 'DOMRect.height': 100,
  'IntersectionObserverEntry.intersectionRatio': 1, 'IntersectionObserverEntry.isIntersecting': true,
  'ResizeObserverSize.inlineSize': 100, 'ResizeObserverSize.blockSize': 100,
  'Document.visibilityState': 'visible', 'Document.hidden': false, 'MediaQueryList.matches': false,
  'PointerEvent.pointerType': 'mouse', 'PointerEvent.isPrimary': true, 'PointerEvent.pressure': 0.5,
  'PointerEvent.width': 1, 'PointerEvent.height': 1, 'PointerEvent.pointerId': 1,
}));

/**
 * The neutral base of one read: LAYOUT_BASE, else 0 / false / the first closed string.
 * @param {string} read `<Type>.<member>`.
 * @returns {unknown}
 */
export function layoutBase(read) {
  if (read in LAYOUT_BASE) return LAYOUT_BASE[read];
  const [type, member] = read.split('.');
  const kind = LAYOUT_FAKE_TYPES.find((t) => t.name === type)?.members[member];
  if (kind === 'boolean') return false;
  if (kind === 'string') return LAYOUT_STRING_VALUES[member]?.[0] ?? '';
  if (kind === 'DOMRect|null') return null;
  return kind === 'number' ? 0 : undefined;
}

/**
 * The input cases for one unit: for each read (`<Type>.<member>`, sorted), one case per layoutValues value with only
 * that read set (every other read stays at its layoutBase), in value order, capped at `max`. Deterministic.
 * @param {string[]} reads
 * @param {LiteralPools} pools
 * @param {{max?: number}} [opts]
 * @returns {LayoutCase[]}
 */
export function layoutCases(reads, pools, { max = MAX_CASES } = {}) {
  /** @type {LayoutCase[]} */
  const out = [];
  for (const read of [...new Set(reads)].sort()) {
    const [type, member] = read.split('.');
    for (const v of layoutValues(type, member, pools)) {
      if (out.length >= max) return out;
      out.push({ reads: { [read]: v } });
    }
  }
  return out;
}
