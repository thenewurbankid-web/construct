// A browser-like global environment for the primitives' test kits under Node's test runner: one jsdom window whose
// globals (document, HTMLElement, the DOM event classes, ...) are installed on globalThis, plus the few browser APIs
// jsdom lacks that Radix uses (ResizeObserver, DOMRect, pointer capture, scrollIntoView, matchMedia). Import it before
// react-dom. Nothing here touches the network or the file system.
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html lang="en"><head><title>Line primitives</title></head><body></body></html>', { url: 'http://localhost/', pretendToBeVisual: true });
const win = dom.window;

/** jsdom classes that must replace Node's own so events dispatched on jsdom nodes are jsdom events. */
const FORCE = ['Event', 'CustomEvent', 'EventTarget', 'UIEvent', 'MouseEvent', 'KeyboardEvent', 'FocusEvent', 'InputEvent', 'WheelEvent', 'TouchEvent', 'DragEvent', 'ClipboardEvent', 'AnimationEvent', 'TransitionEvent', 'ProgressEvent', 'File', 'FileList', 'Blob', 'DataTransfer', 'FormData', 'DOMException'];
/** Node globals that must stay Node's. */
const KEEP = new Set(['undefined', 'globalThis', 'console', 'process', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'clearImmediate', 'queueMicrotask', 'performance', 'crypto', 'fetch', 'Request', 'Response', 'Headers', 'AbortController', 'AbortSignal', 'URL', 'URLSearchParams', 'TextEncoder', 'TextDecoder', 'structuredClone', 'MessageChannel', 'MessagePort', 'BroadcastChannel', 'WebSocket', 'ReadableStream', 'WritableStream', 'TransformStream']);

for (const key of Object.getOwnPropertyNames(win)) {
  if (KEEP.has(key) || key.startsWith('_')) continue;
  if (key in globalThis && !FORCE.includes(key)) continue;
  try {
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: win[key] });
  } catch { /* a non-configurable Node global: keep Node's */ }
}
for (const key of ['window', 'self', 'document', 'navigator', 'location', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame']) {
  const value = key === 'window' || key === 'self' ? win : typeof win[key] === 'function' ? win[key].bind(win) : win[key];
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}

class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
win.ResizeObserver ??= ResizeObserverStub;
globalThis.ResizeObserver ??= ResizeObserverStub;
win.DOMRect ??= class DOMRect { constructor(x = 0, y = 0, width = 0, height = 0) { Object.assign(this, { x, y, width, height, top: y, left: x, right: x + width, bottom: y + height }); } static fromRect(r = {}) { return new this(r.x, r.y, r.width, r.height); } toJSON() { return { ...this }; } };
globalThis.DOMRect ??= win.DOMRect;
win.PointerEvent ??= class PointerEvent extends win.MouseEvent { constructor(type, init = {}) { super(type, init); this.pointerId = init.pointerId ?? 1; this.pointerType = init.pointerType ?? 'mouse'; } };
globalThis.PointerEvent = win.PointerEvent;
const proto = win.Element.prototype;
proto.hasPointerCapture ??= () => false;
proto.setPointerCapture ??= () => {};
proto.releasePointerCapture ??= () => {};
proto.scrollIntoView ??= () => {};
win.HTMLElement.prototype.scrollIntoView ??= () => {};
win.matchMedia ??= (query) => ({ matches: false, media: query, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false });
globalThis.matchMedia = win.matchMedia;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

export const window = win;
