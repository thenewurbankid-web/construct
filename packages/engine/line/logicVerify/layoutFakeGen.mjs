// Line logic verification, spec E (step 5): the LayoutFakeGenerator (layoutFakes.mjs). It reads TypeScript's own
// lib.dom.d.ts (libDom.mjs) and checks every LAYOUT_FAKE_TYPES member against its declared type before it makes a
// fake, so a fake is typed by the real declarations. A fake backs exactly the layout members (plus the few methods the
// layout code calls: getBoundingClientRect, matchMedia, add/removeEventListener ...); reading any other member throws
// NotFakedError naming `<Type>.<member>` and saying whether lib.dom.d.ts declares it.
//
//   make(type, c)               a typed fake: DOMRect, HTMLElement/Element, Window, Document, IntersectionObserverEntry,
//                               ResizeObserverEntry, ResizeObserverSize, MediaQueryList, Event, UIEvent, MouseEvent,
//                               PointerEvent, MediaQueryListEvent; values from the case, else layoutBase
//   values / cases              layoutValues / layoutCases (layoutFakes.mjs) over mergePools of both sides
//   dom(clock, c)               a layout DOM (layoutDom.mjs): window, document, elements, observers, events
//   fire(dom, clock, event, c)  set the case's values and queue the event under the fake clock
import { LAYOUT_FAKE_TYPES, LAYOUT_EVENTS, LAYOUT_STRING_VALUES, layoutValues, layoutCases, layoutBase } from './layoutFakes.mjs';
import { libDomInterface, valueKindOf } from './libDom.mjs';
import { NotFakedError } from './notFaked.mjs';
import { matchesMedia } from './layoutMedia.mjs';
import { createLayoutDom } from './layoutDom.mjs';

export { NotFakedError };

/** Keys any JS runtime probes on an object (await, JSON, React, jest, shapeOf): read as undefined, never "not faked". */
const PROBES = new Set(['then', 'toJSON', '$$typeof', 'nativeEvent', 'nodeName', 'asymmetricMatch', '@@__IMMUTABLE_ITERABLE__@@', 'inspect']);
const OBJ = Object.prototype;

/** The lib.dom.d.ts interfaces a fake type answers "not faked" from (an element is both HTMLElement and Element). */
const LIB_OF = Object.freeze({ DOMRect: 'DOMRect', HTMLElement: 'HTMLElement', Element: 'HTMLElement', Window: 'Window', Document: 'Document', IntersectionObserverEntry: 'IntersectionObserverEntry', ResizeObserverEntry: 'ResizeObserverEntry', ResizeObserverSize: 'ResizeObserverSize', MediaQueryList: 'MediaQueryList', Event: 'Event', UIEvent: 'UIEvent', MouseEvent: 'MouseEvent', PointerEvent: 'PointerEvent', MediaQueryListEvent: 'MediaQueryListEvent', IntersectionObserver: 'IntersectionObserver', ResizeObserver: 'ResizeObserver' });
/** The types make() builds. */
export const MAKE_TYPES = Object.freeze(Object.keys(LIB_OF).filter((t) => !/Observer$/.test(t)));

/**
 * A fake whose own properties are `backing`; any other string key throws NotFakedError. Symbols and runtime probes
 * (then, toJSON ...) read through.
 * @param {string} type
 * @param {object} backing Property descriptors are kept (getters stay live).
 * @returns {any}
 */
export function typedFake(type, backing) {
  const lib = LIB_OF[/** @type {keyof typeof LIB_OF} */ (type)] ?? type;
  const target = Object.defineProperties({}, Object.getOwnPropertyDescriptors(backing));
  Object.defineProperty(target, Symbol.toStringTag, { value: type });
  const own = (k) => OBJ.hasOwnProperty.call(target, k);
  return new Proxy(target, {
    get(t, k, r) {
      if (typeof k === 'symbol' || own(k)) return Reflect.get(t, k, r);
      if (PROBES.has(k)) return undefined;
      if (k in OBJ) return /** @type {any} */ (OBJ)[k];
      throw new NotFakedError(type, k, libDomInterface(lib).has(k));
    },
    set(t, k, v, r) {
      if (typeof k === 'symbol' || own(k)) return Reflect.set(t, k, v, r);
      throw new NotFakedError(type, String(k), libDomInterface(lib).has(String(k)), 'it cannot be set either');
    },
    has: (t, k) => typeof k === 'symbol' || own(k),
  });
}

/**
 * Check LAYOUT_FAKE_TYPES against lib.dom.d.ts: every member exists on its `from` interface with the declared kind.
 * Returns the closed string values lib.dom.d.ts gives (a string-literal union), by `<Type>.<member>`.
 * @returns {Record<string, string[]>}
 */
export function checkAgainstLibDom() {
  /** @type {Record<string, string[]>} */
  const closed = {};
  for (const t of LAYOUT_FAKE_TYPES) {
    const lib = libDomInterface(t.from);
    for (const [m, kind] of Object.entries(t.members)) {
      const d = lib.get(m);
      if (!d) throw new TypeError(`lib.dom.d.ts declares no ${m} on ${t.from}, but LAYOUT_FAKE_TYPES fakes ${t.name}.${m}.`);
      const got = valueKindOf(d);
      if (got !== kind) throw new TypeError(`${t.name}.${m} is ${d.type} in lib.dom.d.ts, but LAYOUT_FAKE_TYPES says ${kind}.`);
      if (d.literals) closed[`${t.name}.${m}`] = d.literals;
    }
  }
  return closed;
}

const rnd = (n) => Math.round(n * 1e9) / 1e9;

/**
 * The layout fake generator (the LayoutFakeGenerator interface in layoutFakes.mjs).
 * @returns {Omit<import('./layoutFakes.mjs').LayoutFakeGenerator, 'make'|'fire'> & {
 *   make: (type: string, c?: import('./layoutFakes.mjs').LayoutCase, opts?: MakeOpts) => any,
 *   dom: (clock: import('./layoutClock.mjs').LayoutClock, c?: import('./layoutFakes.mjs').LayoutCase) => import('./layoutDom.mjs').LayoutDom,
 *   fire: (dom: import('./layoutDom.mjs').LayoutDom, clock: import('./layoutClock.mjs').LayoutClock, event: import('./layoutFakes.mjs').LayoutEvent, c: import('./layoutFakes.mjs').LayoutCase, target?: any) => void,
 *   closed: Record<string, string[]>,
 * }}
 */
export function createLayoutFakeGenerator() {
  const closed = checkAgainstLibDom();

  /**
   * @typedef {object} MakeOpts
   * @property {Record<string, unknown>} [state] Current values by `<Type>.<member>` (a layout DOM's), under the case.
   * @property {any} [target]   The element an entry or event is about.
   * @property {string} [type]  An event's type.
   * @property {string} [media] A MediaQueryList's query.
   * @property {number} [time]  A timestamp (the fake clock's elapsed ms).
   * @property {object} [extra] More backing members (a layout DOM adds methods).
   * @property {any} [view]    A UIEvent's window.
   */

  /**
   * @param {string} type
   * @param {import('./layoutFakes.mjs').LayoutCase} [c]
   * @param {MakeOpts} [opts]
   */
  function make(type, c = { reads: {} }, opts = {}) {
    const reads = c.reads ?? {};
    const state = opts.state ?? {};
    const v = (read) => (read in reads ? reads[read] : read in state ? state[read] : layoutBase(read));
    const extra = opts.extra ?? {};
    const rect = (x, y, w, h) => typedFake('DOMRect', {
      x, y, width: w, height: h, top: Math.min(y, y + h), right: Math.max(x, x + w), bottom: Math.max(y, y + h), left: Math.min(x, x + w),
      toJSON() { return { x, y, width: w, height: h, top: Math.min(y, y + h), right: Math.max(x, x + w), bottom: Math.max(y, y + h), left: Math.min(x, x + w) }; },
    });
    const event = (t, more) => {
      let prevented = false;
      return typedFake(t, {
        type: opts.type ?? 'event', target: opts.target ?? null, currentTarget: opts.target ?? null, timeStamp: opts.time ?? 0,
        bubbles: false, cancelable: true, isTrusted: true, eventPhase: 2,
        get defaultPrevented() { return prevented; },
        preventDefault() { prevented = true; }, stopPropagation() {}, stopImmediatePropagation() {},
        ...more,
      });
    };
    switch (type) {
      case 'DOMRect': return rect(v('DOMRect.x'), v('DOMRect.y'), v('DOMRect.width'), v('DOMRect.height'));
      case 'ResizeObserverSize': return typedFake(type, { inlineSize: v('ResizeObserverSize.inlineSize'), blockSize: v('ResizeObserverSize.blockSize') });
      case 'HTMLElement': case 'Element': {
        const s = { ...Object.fromEntries(['HTMLElement', 'Element'].flatMap((t) => Object.keys(/** @type {any} */ (LAYOUT_FAKE_TYPES.find((x) => x.name === t)).members).map((m) => [m, v(`${t}.${m}`)]))) };
        const backing = {};
        for (const m of Object.keys(s)) Object.defineProperty(backing, m, { get: () => s[m], set: (x) => { s[m] = x; }, enumerable: true, configurable: true });
        const box = () => (['DOMRect.width', 'DOMRect.height', 'DOMRect.x', 'DOMRect.y'].some((r) => r in reads) ? make('DOMRect', c, opts) : rect(s.offsetLeft, s.offsetTop, s.offsetWidth, s.offsetHeight));
        Object.defineProperty(backing, 'getBoundingClientRect', { value: box, enumerable: true, configurable: true });
        return typedFake('HTMLElement', Object.defineProperties(backing, Object.getOwnPropertyDescriptors(extra)));
      }
      case 'Window': case 'Document': case 'MediaQueryList': {
        const t = /** @type {any} */ (LAYOUT_FAKE_TYPES.find((x) => x.name === type));
        const backing = {};
        for (const m of Object.keys(t.members)) Object.defineProperty(backing, m, { get: () => (type === 'MediaQueryList' ? mql(m) : v(`${type}.${m}`)), enumerable: true, configurable: true });
        const media = opts.media ?? (typeof reads['MediaQueryList.media'] === 'string' ? reads['MediaQueryList.media'] : '(min-width: 0px)');
        function mql(m) {
          if (m === 'media') return media;
          if ('MediaQueryList.matches' in reads) return reads['MediaQueryList.matches'];
          if ('MediaQueryList.matches' in state) return state['MediaQueryList.matches'];
          return matchesMedia(media, { width: /** @type {number} */ (v('Window.innerWidth')), height: /** @type {number} */ (v('Window.innerHeight')) });
        }
        return typedFake(type, Object.defineProperties(backing, Object.getOwnPropertyDescriptors(extra)));
      }
      case 'IntersectionObserverEntry': {
        const b = make('DOMRect', c, opts);
        const ratio = /** @type {number} */ (v('IntersectionObserverEntry.intersectionRatio'));
        const k = Math.min(1, Math.max(0, ratio));
        const rootBounds = 'IntersectionObserverEntry.rootBounds' in reads ? reads['IntersectionObserverEntry.rootBounds'] : rect(0, 0, v('Window.innerWidth'), v('Window.innerHeight'));
        return typedFake(type, {
          boundingClientRect: b, intersectionRect: rect(b.x, b.y, b.width, rnd(b.height * k)), rootBounds, intersectionRatio: ratio,
          isIntersecting: 'IntersectionObserverEntry.isIntersecting' in reads ? reads['IntersectionObserverEntry.isIntersecting'] : ratio > 0,
          time: 'IntersectionObserverEntry.time' in reads ? reads['IntersectionObserverEntry.time'] : opts.time ?? 0, target: opts.target ?? null,
        });
      }
      case 'ResizeObserverEntry': {
        const size = make('ResizeObserverSize', c, opts);
        const dpr = /** @type {number} */ (v('Window.devicePixelRatio'));
        const dev = typedFake('ResizeObserverSize', { inlineSize: rnd(size.inlineSize * dpr), blockSize: rnd(size.blockSize * dpr) });
        return typedFake(type, {
          contentRect: rect(0, 0, size.inlineSize, size.blockSize), borderBoxSize: Object.freeze([size]), contentBoxSize: Object.freeze([size]),
          devicePixelContentBoxSize: Object.freeze([dev]), target: opts.target ?? null,
        });
      }
      case 'Event': return event('Event', {});
      case 'UIEvent': return event('UIEvent', { detail: 0, view: opts.view ?? null });
      case 'MediaQueryListEvent': return event('MediaQueryListEvent', { matches: v('MediaQueryList.matches'), media: opts.media ?? '' });
      case 'MouseEvent': case 'PointerEvent': {
        const more = { detail: 0, view: null, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false };
        for (const t of type === 'PointerEvent' ? ['MouseEvent', 'PointerEvent'] : ['MouseEvent']) for (const m of Object.keys(/** @type {any} */ (LAYOUT_FAKE_TYPES.find((x) => x.name === t)).members)) more[m] = v(`${t}.${m}`);
        return event(type, more);
      }
      default: throw new TypeError(`The layout fakes make one of ${MAKE_TYPES.join(', ')}, not ${type}.`);
    }
  }

  return {
    types: LAYOUT_FAKE_TYPES,
    events: LAYOUT_EVENTS,
    closed,
    values: (type, member, pools) => (closed[`${type}.${member}`] && !(member in LAYOUT_STRING_VALUES) ? [...closed[`${type}.${member}`]] : layoutValues(type, member, pools)),
    cases: (reads, pools) => layoutCases(reads, pools),
    make,
    dom: (clock, c = { reads: {} }) => createLayoutDom({ make, clock, c }),
    fire: (dom, clock, event, c, target) => {
      if (dom.clock !== clock) throw new TypeError('The layout DOM and the clock must be the same pair (gen.dom(clock)).');
      dom.fire(event, c, target);
    },
  };
}
