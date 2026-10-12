// Line logic verification, spec E (step 5): a layout DOM for one run. A typed fake window and document (layout values
// live from `state`), elements, matchMedia, IntersectionObserver and ResizeObserver, and window/document/element
// listeners. Every event and observer callback fires under the fake clock (layoutClock.mjs), in the frame order the HTML
// "update the rendering" steps give:
//   task      pointer events and visibilitychange (a 0 ms timer)
//   frame     resize -> scroll -> media-query change -> rAF -> ResizeObserver -> IntersectionObserver
// Observers fire in creation order, each with its queued entries in queue order. `observe` queues the initial entry,
// as browsers do. It implements the layout half of fakes.mjs DomStub; step 4's stub can delegate to it.
import { layoutBase } from './layoutFakes.mjs';

/** @typedef {import('./layoutFakes.mjs').LayoutCase} LayoutCase */
/** @typedef {import('./layoutFakes.mjs').LayoutEvent} LayoutEvent */

/**
 * @typedef {object} LayoutDom
 * @property {import('./layoutClock.mjs').LayoutClock} clock
 * @property {Record<string, unknown>} state  Current window/document values by `<Type>.<member>`.
 * @property {any} window
 * @property {any} document
 * @property {(c?: LayoutCase) => any} element  A new fake HTMLElement with the case's Element/HTMLElement values.
 * @property {(c: LayoutCase, target?: any) => void} set  Apply a case: Window/Document/MediaQueryList reads to state,
 *   Element/HTMLElement reads to the target element.
 * @property {(event: LayoutEvent, c: LayoutCase, target?: any) => void} fire  Set the case and queue the event.
 * @property {(target: any, c?: LayoutCase) => void} intersect  Queue an IntersectionObserverEntry for each observer of target.
 * @property {(target: any, c?: LayoutCase) => void} resize  Queue a ResizeObserverEntry for each observer of target.
 * @property {Function} IntersectionObserver
 * @property {Function} ResizeObserver
 */

const ELEMENT_TYPES = new Set(['Element', 'HTMLElement']);

/**
 * A layout DOM for one run, its window and document values from the case, its events and observers on the clock.
 * @param {{make: Function, clock: import('./layoutClock.mjs').LayoutClock, c?: LayoutCase}} deps
 * @returns {LayoutDom}
 */
export function createLayoutDom({ make, clock, c = { reads: {} } }) {
  /** @type {Record<string, unknown>} */
  const state = {};
  /** @type {Map<any, Map<string, {fn: any, once: boolean}[]>>} */
  const listeners = new Map();
  const elements = [];
  let resizeQueued = false;
  const scrollQueued = new Set();
  /** @type {{mql: any, media: string, last: boolean}[]} */
  const mqls = [];
  /** @type {{kind: 'io'|'ro', cb: Function, self: any, targets: Set<any>, queue: {target: any, reads: Record<string, unknown>}[]}[]} */
  const observers = [];
  const vp = (read) => /** @type {number} */ (read in state ? state[read] : layoutBase(read));
  const viewport = () => ({ width: vp('Window.innerWidth'), height: vp('Window.innerHeight') });

  const on = (target) => (type, fn, opts) => {
    if (!fn) return;
    if (!listeners.has(target)) listeners.set(target, new Map());
    const byType = /** @type {Map<string, {fn: any, once: boolean}[]>} */ (listeners.get(target));
    const list = byType.get(type) ?? [];
    if (!list.some((l) => l.fn === fn)) list.push({ fn, once: Boolean(typeof opts === 'object' && opts?.once) });
    byType.set(type, list);
  };
  const off = (target) => (type, fn) => {
    const list = listeners.get(target)?.get(type);
    if (list) listeners.get(target)?.set(type, list.filter((l) => l.fn !== fn));
  };
  const dispatch = (target, type, ev) => {
    const list = [...(listeners.get(target)?.get(type) ?? [])];
    for (const l of list) {
      if (l.once) off(target)(type, l.fn);
      if (typeof l.fn === 'function') l.fn.call(target, ev);
      else l.fn.handleEvent(ev);
    }
    return true;
  };
  const targetMethods = (getSelf) => ({
    addEventListener: (type, fn, opts) => on(getSelf())(type, fn, opts),
    removeEventListener: (type, fn) => off(getSelf())(type, fn),
    dispatchEvent: (ev) => dispatch(getSelf(), ev.type, ev),
  });

  function element(ec = { reads: {} }) {
    let self = null;
    self = make('HTMLElement', ec, {
      extra: {
        ...targetMethods(() => self),
        scrollTo(x, y) { const o = typeof x === 'object' ? x : { left: x, top: y }; if (o.left !== undefined) self.scrollLeft = o.left; if (o.top !== undefined) self.scrollTop = o.top; scrollQueued.add(self); },
      },
    });
    elements.push(self);
    return self;
  }

  function matchMedia(query) {
    let mql = null;
    let onchange = null;
    mql = make('MediaQueryList', { reads: {} }, {
      state, media: String(query),
      extra: {
        ...targetMethods(() => mql),
        addListener: (fn) => on(mql)('change', fn),
        removeListener: (fn) => off(mql)('change', fn),
        get onchange() { return onchange; },
        set onchange(fn) { if (onchange) off(mql)('change', onchange); onchange = fn; if (fn) on(mql)('change', fn); },
      },
    });
    mqls.push({ mql, media: String(query), last: mql.matches });
    return mql;
  }

  function observerClass(kind) {
    return class {
      constructor(cb) {
        if (typeof cb !== 'function') throw new TypeError(`${kind === 'io' ? 'IntersectionObserver' : 'ResizeObserver'} needs a callback.`);
        this._o = { kind, cb, self: this, targets: new Set(), queue: [] };
        observers.push(this._o);
      }
      observe(target) {
        if (this._o.targets.has(target)) return;
        this._o.targets.add(target);
        this._o.queue.push({ target, reads: {} }); // the initial observation
      }
      unobserve(target) { this._o.targets.delete(target); this._o.queue = this._o.queue.filter((q) => q.target !== target); }
      disconnect() { this._o.targets.clear(); this._o.queue = []; }
      takeRecords() { const q = this._o.queue; this._o.queue = []; return q.map((x) => entry(this._o, x)); }
    };
  }
  const entry = (o, q) => {
    if (o.kind === 'io') return make('IntersectionObserverEntry', { reads: q.reads }, { state, target: q.target, time: clock.elapsed() });
    const reads = { 'ResizeObserverSize.inlineSize': q.target.clientWidth, 'ResizeObserverSize.blockSize': q.target.clientHeight, ...q.reads };
    return make('ResizeObserverEntry', { reads }, { state, target: q.target });
  };
  const IntersectionObserver = observerClass('io');
  const ResizeObserver = observerClass('ro');
  const queueFor = (kind) => (target, oc = { reads: {} }) => {
    for (const o of observers) if (o.kind === kind && o.targets.has(target)) o.queue.push({ target, reads: { ...oc.reads } });
  };
  const deliver = (kind) => ({
    pending: () => observers.some((o) => o.kind === kind && o.queue.length > 0),
    run: () => {
      for (const o of observers) {
        if (o.kind !== kind || !o.queue.length) continue;
        const q = o.queue;
        o.queue = [];
        o.cb(q.map((x) => entry(o, x)), o.self);
      }
    },
  });

  let win = null;
  let doc = null;
  const docEl = () => make('HTMLElement', { reads: {} }, {
    extra: {
      get clientWidth() { return viewport().width; }, get clientHeight() { return viewport().height; },
      get scrollTop() { return state['Window.scrollY'] ?? 0; }, get scrollLeft() { return state['Window.scrollX'] ?? 0; },
    },
  });
  const docElement = docEl();
  doc = make('Document', { reads: {} }, {
    state,
    extra: { ...targetMethods(() => doc), documentElement: docElement, get defaultView() { return win; } },
  });
  win = make('Window', { reads: {} }, {
    state,
    extra: {
      ...targetMethods(() => win),
      matchMedia,
      get window() { return win; }, get self() { return win; }, get document() { return doc; },
      requestAnimationFrame: clock.requestAnimationFrame, cancelAnimationFrame: clock.cancelAnimationFrame,
      setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout, setInterval: clock.setInterval, clearInterval: clock.clearInterval,
      scrollTo(x, y) { const o = typeof x === 'object' ? x : { left: x, top: y }; if (o.left !== undefined) state['Window.scrollX'] = o.left; if (o.top !== undefined) state['Window.scrollY'] = o.top; scrollQueued.add(win); },
      IntersectionObserver, ResizeObserver,
    },
  });

  clock.onFrame('resize', { pending: () => resizeQueued, run: () => { resizeQueued = false; dispatch(win, 'resize', make('UIEvent', { reads: {} }, { state, type: 'resize', target: win, view: win, time: clock.elapsed() })); } });
  clock.onFrame('scroll', {
    pending: () => scrollQueued.size > 0,
    run: () => { const ts = [...scrollQueued]; scrollQueued.clear(); for (const t of ts) dispatch(t, 'scroll', make('Event', { reads: {} }, { type: 'scroll', target: t, time: clock.elapsed() })); },
  });
  clock.onFrame('media', {
    pending: () => mqls.some((m) => m.mql.matches !== m.last),
    run: () => {
      for (const m of mqls) {
        const now = m.mql.matches;
        if (now === m.last) continue;
        m.last = now;
        dispatch(m.mql, 'change', make('MediaQueryListEvent', { reads: { 'MediaQueryList.matches': now } }, { type: 'change', target: m.mql, media: m.media, time: clock.elapsed() }));
      }
    },
  });
  clock.onFrame('resize-observer', deliver('ro'));
  clock.onFrame('intersection-observer', deliver('io'));

  function set(sc, target) {
    for (const [read, value] of Object.entries(sc.reads ?? {})) {
      const [type, member] = read.split('.');
      if (ELEMENT_TYPES.has(type)) {
        const el = target ?? elements[0];
        if (!el) throw new TypeError(`The case sets ${read}, but the layout DOM has no element; create one with dom.element().`);
        el[member] = value;
      } else state[read] = value;
    }
    if ('Document.visibilityState' in (sc.reads ?? {}) && !('Document.hidden' in sc.reads)) state['Document.hidden'] = state['Document.visibilityState'] === 'hidden';
  }

  function fire(event, fc, target) {
    const el = target ?? elements[0];
    set(fc, event.target === 'element' ? el : undefined);
    if (event.target === 'window' && event.event === 'resize') { resizeQueued = true; return; }
    if (event.event === 'scroll') { scrollQueued.add(event.target === 'window' ? win : el); return; }
    if (event.target === 'mediaQueryList') return; // the media phase compares every list with its last answer
    if (event.target === 'document') {
      clock.setTimeout(() => dispatch(doc, event.event, make('Event', { reads: {} }, { type: event.event, target: doc, time: clock.elapsed() })), 0);
      return;
    }
    if (event.target === 'element') {
      if (!el) throw new TypeError(`The ${event.event} event needs an element; create one with dom.element().`);
      clock.setTimeout(() => dispatch(el, event.event, make(event.interface, fc, { type: event.event, target: el, time: clock.elapsed() })), 0);
      return;
    }
    throw new TypeError(`The layout DOM cannot fire ${event.event} at ${event.target}.`);
  }

  // the starting case sets window and document values; its element values go to dom.element(c)
  set({ reads: Object.fromEntries(Object.entries(c.reads ?? {}).filter(([r]) => !ELEMENT_TYPES.has(r.split('.')[0]))) });
  return {
    clock, state, window: win, document: doc, element, set, fire,
    intersect: queueFor('io'), resize: queueFor('ro'),
    IntersectionObserver, ResizeObserver,
  };
}
