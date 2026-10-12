// Line logic verification, spec E (step 5): the fake clock layout fakes fire under. It implements fakes.mjs ClockFake
// with the characterizer's fixed time (FAKE_ENV.now, 2026-01-15T10:00:00.000Z, as jest.setSystemTime in
// characterize/runtime.cjs): nothing runs until `advance` or `runAll`. Besides timers it has rendering FRAMES every
// FRAME_MS, run only while a frame is wanted, with the phases in the order the HTML "update the rendering" steps give:
// resize events, scroll events, media-query changes, animation frame callbacks, resize observations, intersection
// observations. Due timers run before a frame at the same time. Step 4's runner can reuse it as its ClockFake.
import { FAKE_ENV } from './fakes.mjs';

/** One rendering frame every FRAME_MS (60 Hz, rounded). */
export const FRAME_MS = 16;
/** The phases of a frame, in order (HTML "update the rendering"). */
export const FRAME_PHASES = Object.freeze(['resize', 'scroll', 'media', 'raf', 'resize-observer', 'intersection-observer']);
/** runAll stops with an error after this many steps (an interval or a rAF loop that never ends). */
export const MAX_STEPS = 10000;

/**
 * A frame phase hook: `pending()` says whether it has work (so a frame is wanted), `run(t)` does it.
 * @typedef {{pending: () => boolean, run: (t: number) => void}} FrameHook
 */

/**
 * The fake clock.
 * @typedef {import('./fakes.mjs').ClockFake & {
 *   cancelAnimationFrame: (id: number) => void,
 *   onFrame: (phase: string, hook: FrameHook) => void,
 *   elapsed: () => number,
 *   pending: () => boolean,
 * }} LayoutClock
 */

/**
 * A fake clock starting at `now` (default FAKE_ENV.now).
 * @param {{now?: string|number, frameMs?: number}} [opts]
 * @returns {LayoutClock}
 */
export function createFakeClock({ now = FAKE_ENV.now, frameMs = FRAME_MS } = {}) {
  const start = typeof now === 'number' ? now : Date.parse(now);
  let t = start;
  let ids = 0;
  let seq = 0;
  /** @type {Map<number, {at: number, seq: number, fn: Function, args: unknown[], every: number|null}>} */
  const timers = new Map();
  /** @type {Map<number, Function>} */
  const rafs = new Map();
  /** @type {Map<string, FrameHook[]>} */
  const hooks = new Map(FRAME_PHASES.map((p) => [p, []]));

  const frameWanted = () => rafs.size > 0 || [...hooks.values()].some((hs) => hs.some((h) => h.pending()));
  let lastFrame = start;
  // the first frame boundary at or after now that is later than the last frame
  const nextFrameAt = () => Math.max(lastFrame + frameMs, start + Math.ceil((t - start) / frameMs) * frameMs);
  const nextTimer = () => {
    let best = null;
    for (const [id, x] of timers) if (!best || x.at < best.x.at || (x.at === best.x.at && x.seq < best.x.seq)) best = { id, x };
    return best;
  };
  const runFrame = () => {
    for (const phase of FRAME_PHASES) {
      if (phase === 'raf') {
        const due = [...rafs];
        rafs.clear();
        for (const [, cb] of due) cb(t - start);
        continue;
      }
      for (const h of /** @type {FrameHook[]} */ (hooks.get(phase))) if (h.pending()) h.run(t);
    }
  };
  /** One step up to `limit`: the earliest due timer, else a wanted frame. Returns false when nothing is due. */
  const step = (limit) => {
    const nt = nextTimer();
    const nf = frameWanted() ? nextFrameAt() : Infinity;
    if (nt && nt.x.at <= limit && nt.x.at <= nf) {
      t = Math.max(t, nt.x.at);
      if (nt.x.every === null) timers.delete(nt.id);
      else { nt.x.at += nt.x.every; nt.x.seq = seq++; }
      nt.x.fn(...nt.x.args);
      return true;
    }
    if (Number.isFinite(nf) && nf <= limit) { t = nf; lastFrame = nf; runFrame(); return true; }
    return false;
  };
  const schedule = (fn, ms, args, every) => {
    if (typeof fn !== 'function') throw new TypeError('The fake clock schedules functions only, never strings.');
    const id = ++ids;
    const d = Math.max(0, Number(ms) || 0);
    timers.set(id, { at: t + d, seq: seq++, fn, args, every: every ? Math.max(1, d) : null });
    return id;
  };

  return {
    now: () => t,
    elapsed: () => t - start,
    advance(ms) {
      const target = t + Math.max(0, Number(ms) || 0);
      let n = 0;
      while (step(target)) if (++n > MAX_STEPS) throw new Error(`The fake clock ran more than ${MAX_STEPS} steps in one advance.`);
      t = target;
    },
    runAll() {
      let n = 0;
      while (step(Infinity)) if (++n > MAX_STEPS) throw new Error(`The fake clock ran more than ${MAX_STEPS} steps; an interval or animation loop never ends.`);
    },
    pending: () => timers.size > 0 || frameWanted(),
    setTimeout: (fn, ms, ...args) => schedule(fn, ms, args, false),
    clearTimeout: (id) => { timers.delete(id); },
    setInterval: (fn, ms, ...args) => schedule(fn, ms, args, true),
    clearInterval: (id) => { timers.delete(id); },
    requestAnimationFrame: (cb) => { const id = ++ids; rafs.set(id, cb); return id; },
    cancelAnimationFrame: (id) => { rafs.delete(id); },
    onFrame(phase, hook) {
      if (!hooks.has(phase) || phase === 'raf') throw new TypeError(`The frame phase must be one of ${FRAME_PHASES.filter((p) => p !== 'raf').join(', ')}.`);
      /** @type {FrameHook[]} */ (hooks.get(phase)).push(hook);
    },
  };
}
