// Line logic verification, spec E: layout as input. The layout-fake GENERATOR interface (its types named after
// lib.dom.d.ts: DOMRect, offset/scroll/client sizes, innerWidth, IntersectionObserverEntry, ResizeObserverEntry,
// MediaQueryList, and scroll/resize/pointer/visibility events) and its VALUE STRATEGY: the characterizer's mined
// comparison literals (characterize/analyze.mjs ClosureAnalysis.pools) at the boundary +-1, plus 0, negative and large.
// Interface and value strategy only; making the fakes and firing observers under the fake clock is step 5.
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
