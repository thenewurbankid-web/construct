// The pulse queue: results can stream in faster than the eye can follow, so pulses wait in line. Only a few travel at once
// (the cap), each starts a moment after the last (the stagger), and a long line makes everything go faster, gently:
// with more than `cap` waiting, speed rises by 1 for every `cap` extra, up to maxSpeed. Pure: the clock is passed in.
import { clamp } from "./geometry.mjs";

export function createPulseQueue({ cap = 6, dur = 900, stagger = 110, maxSpeed = 4, slow: slow0 = 1 } = {}) {
  let slow = slow0;
  const waiting = [], travelling = [];
  let lastStart = -Infinity;
  // slow > 1 stretches every time (Presenter mode); it never changes the order or the cap
  const speed = () => clamp(1 + Math.max(0, waiting.length - cap) / cap, 1, maxSpeed);
  return {
    push(item) { waiting.push(item); },
    // Advance the clock. Returns what began and what finished travelling in this step.
    step(now) {
      const finished = [], started = [];
      for (let i = travelling.length - 1; i >= 0; i--) {
        const p = travelling[i];
        if (now >= p.startedAt + p.dur) { finished.unshift(p); travelling.splice(i, 1); }
      }
      while (waiting.length && travelling.length < cap && now - lastStart >= (stagger * slow) / speed()) {
        const s = speed(), p = waiting.shift();
        p.startedAt = now;
        p.dur = (dur * slow * (p.weight ?? 1)) / s;
        p.speed = s;
        travelling.push(p); started.push(p);
        lastStart = now;
      }
      return { started, finished };
    },
    // Everything not yet done, in order: used to settle all of it at once (tab hidden, reduced motion, a new run).
    drain() { const all = [...travelling, ...waiting]; travelling.length = 0; waiting.length = 0; return all; },
    // Drop waiting items matching a test (a part that changed again before its pulse began).
    remove(test) { for (let i = waiting.length - 1; i >= 0; i--) if (test(waiting[i])) waiting.splice(i, 1); },
    setSlow(v) { slow = v; },
    get speed() { return speed(); },
    get waiting() { return waiting.length; },
    get travelling() { return travelling.length; },
    get idle() { return !waiting.length && !travelling.length; },
  };
}
