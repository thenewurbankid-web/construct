// Train Line case generator (Claude's side, owner 2026-10-11): imaginary cases over imaginary worlds (corpus.mjs) and
// the Line sample, for every intent of the catalog, with paraphrases, refusals and questions. A case is KEPT only when
// Construct verifies every gold route (verify.mjs, in scratch copies). Cases are stored delexicalized (slots only).
import crypto from 'node:crypto';
import fs from 'node:fs';
import { INTENT_IDS } from './contract.mjs';
import { INTENT_DEFS, goldFor, fitsShape } from './routes.mjs';
import { WORLD_IDS, isHeldOut, materialize, worldKey } from './corpus.mjs';
import { factsOf, factsHash } from './facts.mjs';
import { verifyCase, wordsOf } from './verify.mjs';

const hash = (s) => crypto.createHash('sha256').update(s).digest('hex');

/** The facts of a world, read once from a scratch copy. */
const factsCache = new Map();
/**
 * The facts of a world, read once from a scratch copy and cached.
 * @param {any} world
 * @returns {any}
 */
export function worldFacts(world) {
  const k = worldKey(world);
  if (!factsCache.has(k)) {
    const dir = materialize(world);
    try { factsCache.set(k, factsOf(dir)); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }
  return factsCache.get(k);
}

/**
 * In the owner's review sample: a fixed 1 in 6 of Claude's cases, by id (deterministic, spread over every intent).
 * @param {string} id
 * @returns {boolean}
 */
export const inSample = (id) => parseInt(id.slice(-4), 16) % 6 === 0;

/**
 * The candidate cases of one world (not verified yet).
 * @param {{kind: 'corpus', id: string, variant?: string}|{kind: 'sample'}} world
 * @param {{all?: boolean, now?: string}} [o] `all`: every shape and slot set (the sample world); otherwise one of each, rotated.
 * @returns {any[]}
 */
export function candidates(world, o = {}) {
  const n = world.kind === 'sample' ? 0 : Number(world.id.slice(1));
  const variant = world.kind === 'sample' ? null : (world.variant ?? 'clean');
  const facts = worldFacts(world);
  const words = wordsOf(world);
  const out = [];
  INTENT_IDS.forEach((intent, ii) => {
    const def = INTENT_DEFS[intent];
    if (variant && !def.variants.includes(variant)) return;
    const shapes = [...new Set(def.wordings.map((w) => w.shape))];
    const shapeList = o.all ? shapes : [shapes[(n + ii) % shapes.length]];
    for (const wantShape of shapeList) {
      const sets = def.slotSets(facts, words, wantShape).map((s) => (s.slots ? s : { shape: wantShape, slots: s }));
      const chosen = o.all ? sets : sets.length ? [sets[(n + ii) % sets.length]] : [];
      chosen.forEach((set, si) => {
        const shape = set.shape === 'any' ? wantShape : set.shape;
        const fitting = def.wordings.filter((w) => fitsShape(w, shape));
        if (!fitting.length) return;
        const picks = [fitting[(n + si + ii) % fitting.length]];
        for (const w of [...new Set(picks)]) {
          const gold = goldFor(intent, shape);
          const id = `tc-${hash(JSON.stringify([worldKey(world), intent, w.text, set.slots])).slice(0, 12)}`;
          out.push({
            id, intent, request: w.text, slots: set.slots, world,
            split: world.kind === 'corpus' && isHeldOut(world.id) ? 'heldout' : 'train',
            factsHash: factsHash(facts), gold,
            labelledBy: 'claude', status: 'draft', notes: [], sample: inSample(id), verified: { routes: {} },
            createdAt: o.now ?? new Date().toISOString(),
          });
        }
      });
    }
  });
  return out;
}

/**
 * Generate and verify. Returns the kept cases and, for the record, the dropped ones with why.
 * @param {{worlds?: any[], now?: string, onCase?: (c: any, ok: boolean) => void}} [o]
 * @returns {{kept: any[], dropped: {id: string, intent: string, world: string, why: string[]}[]}}
 */
export function generate(o = {}) {
  const worlds = o.worlds ?? [{ kind: 'sample' }, ...WORLD_IDS.flatMap((id) => ['clean', 'cross-feature', 'missing-base'].map((variant) => ({ kind: 'corpus', id, variant })))];
  const kept = [];
  const dropped = [];
  const seen = new Set();
  for (const world of worlds) {
    for (const c of candidates(world, { all: world.kind === 'sample', now: o.now })) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      const v = verifyCase(c);
      const at = o.now ?? new Date().toISOString();
      c.verified = { routes: Object.fromEntries(Object.entries(v.routes).map(([k, r]) => [k, { ok: r.ok, at }])) };
      o.onCase?.(c, v.ok);
      if (v.ok) kept.push(c); else dropped.push({ id: c.id, intent: c.intent, world: worldKey(world), why: Object.entries(v.routes).filter(([, r]) => !r.ok).map(([k, r]) => `${k}: ${r.sentence}`) });
    }
  }
  return { kept, dropped };
}
