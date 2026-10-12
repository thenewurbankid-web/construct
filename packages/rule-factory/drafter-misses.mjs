// cs2 -- the drafter's misses on Train Line's TRAIN split (never a held-out world: those are the gate's yardstick).
// Each train case is drafted by the real drafter in a scratch copy of its world, with retrieval reading the train-split
// cases of the OTHER worlds only (leave one world out), so a case never finds itself as a precedent. A world's own
// words (its feature and item names) are dropped from what the drafter could not read: they are project words, never
// lexicon material. Offline and slow (a few hundred drafts); `limit` bounds it.
import fs from 'node:fs';
import path from 'node:path';
import { evaluateCase } from '@line/construct-engine/line/train/service';
import { recordsFromTraining } from '@line/construct-engine/line/train/records';
import { worldKey, isHeldOut } from '@line/construct-engine/line/train/corpus';
import { wordsOf } from '@line/construct-engine/line/train/verify';

/** Train Line's committed cases, relative to the Construct checkout. */
export const TRAIN_CASES = 'line/train/cases.jsonl';

/**
 * Train Line's cases (one JSON per line; unreadable lines skipped).
 * @param {string} checkout The Construct checkout.
 * @returns {any[]}
 */
export function readTrainCases(checkout) {
  let text = '';
  try { text = fs.readFileSync(path.join(checkout, TRAIN_CASES), 'utf8'); } catch { return []; }
  return text.split('\n').filter((l) => l.trim()).flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } });
}

/** A case's world is a train world (the sample, or a corpus world below the held-out ones). */
const trainWorld = (c) => c.world?.kind === 'sample' || (c.world?.kind === 'corpus' && !isHeldOut(c.world.id));

/**
 * Draft the train split and say, per case, whether the drafter recommended the gold preferred route.
 * @param {any[]} cases All Train cases (the held-out ones are only used to be left out).
 * @param {{limit?: number, only?: (c: any) => boolean}} [o]
 * @returns {{caseId: string, request: string, intent: string, drafted: string|null, preferred: boolean, words: string[]}[]}
 */
export function draftTrainSplit(cases, o = {}) {
  const train = cases.filter((c) => c.split === 'train' && c.status !== 'disputed' && trainWorld(c)).filter(o.only ?? (() => true)).slice(0, o.limit ?? Infinity);
  const byWorld = new Map();
  for (const c of train) byWorld.set(worldKey(c.world), [...(byWorld.get(worldKey(c.world)) ?? []), c]);
  const out = [];
  for (const [key, cs] of byWorld) {
    const records = recordsFromTraining(cases.filter((x) => x.split === 'train' && worldKey(x.world) !== key));
    const own = new Set(wordsOf(cs[0].world).flatMap((w) => String(w).replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/)));
    for (const c of cs) {
      const e = evaluateCase(c, { records });
      if (!e) continue;
      out.push({
        caseId: c.id, request: c.request, intent: c.intent, drafted: e.drafted ?? null, preferred: e.preferred === 1,
        words: [...new Set((e.unread ?? []).map((w) => String(w).toLowerCase()).filter((w) => /^[a-z]+$/.test(w) && !own.has(w)))],
      });
    }
  }
  return out;
}
