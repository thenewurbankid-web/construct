// im3 + j5 eval: does memory raise the drafter's preferred-route accuracy on Train Line's held-out cases?
// Memory is per project, so each held-out world is one project: for every case, its memory holds the person's picks
// of the OTHER held-out cases of the same world (leave-one-out; the case's own answer is never in its memory), each
// recorded as the gold-preferred drafted route. Scored with and without memory; recall quality is the share of cases
// whose top recalled record chose the same kind of route as the case's gold (non-neural, and with embeddings when on).
//   node packages/engine/line/memory/eval.mjs [--embed]
import { fileURLToPath } from 'node:url';
import { createTrainStore, DEFAULT_TRAIN_ROOT } from '../train/store.mjs';
import { evaluateCase } from '../train/service.mjs';
import { recordsFromTraining } from '../train/records.mjs';
import { worldKey } from '../train/corpus.mjs';
import { MEMORY_VERSION } from './contract.mjs';
import { memoryOver, recallFrom } from './recall.mjs';
import { createOllamaEmbedder, recallWithEmbeddings } from './embed.mjs';

const STEP = 'drafter.route';
const share = (xs) => (xs.length ? Math.round((xs.filter(Boolean).length / xs.length) * 1000) / 1000 : null);

/**
 * A pick as the memory record a person's pick in Cockpit makes.
 * @param {any} pick @param {number} n
 * @returns {import('./contract.mjs').MemoryRecord}
 */
const asRecord = (pick, n) => ({
  v: MEMORY_VERSION, id: `m-eval${String(n).padStart(4, '0')}`, step: STEP, at: new Date(Date.UTC(2026, 9, 1, 0, 0, n)).toISOString(), ...pick.context,
  options: pick.options, proposed: pick.proposed, kind: 'picked', chosen: pick.chosen, by: 'person', agreed: pick.chosen === pick.proposed,
});

/**
 * Run the with/without-memory eval.
 * @param {{cases?: any[], embed?: ((texts: string[]) => Promise<number[][]>)|null, limitWorlds?: number}} [o]
 */
export async function memoryEval(o = {}) {
  const cases = o.cases ?? createTrainStore({ root: DEFAULT_TRAIN_ROOT }).all();
  const records = recordsFromTraining(cases);
  const held = cases.filter((c) => c.split === 'heldout' && c.status !== 'disputed');
  const worlds = [...new Set(held.map((c) => worldKey(c.world)))].slice(0, o.limitWorlds ?? Infinity);
  const rows = [];
  for (const w of worlds) {
    const mine = held.filter((c) => worldKey(c.world) === w);
    const base = mine.map((c) => evaluateCase(c, { records, withPick: true }));
    const picks = base.map((b, i) => (b?.pick ? asRecord(b.pick, i) : null));
    for (let i = 0; i < mine.length; i++) {
      if (!base[i]) continue;
      const others = /** @type {any[]} */ (picks.filter((p, j) => p && j !== i));
      const withMem = evaluateCase(mine[i], { records, memory: memoryOver(others) });
      const pick = base[i].pick;
      const top = pick ? recallFrom(others, STEP, pick.context, 1)[0] ?? null : null;
      const topE = pick && o.embed ? (await recallWithEmbeddings(others, STEP, pick.context, 1, o.embed))[0] ?? null : null;
      rows.push({ world: w, id: mine[i].id, without: base[i].preferred, with: withMem?.preferred ?? 0, pick: Boolean(pick),
        recallHit: pick ? Boolean(top && top.record.chosen === pick.chosen) : null, sameIntent: pick ? others.some((r) => r.intent === pick.context.intent && r.chosen === pick.chosen) : null, recallAny: pick ? Boolean(top) : null,
        embedHit: pick && o.embed ? Boolean(topE && topE.record.chosen === pick.chosen) : null });
    }
  }
  const picked = rows.filter((r) => r.pick);
  return {
    cases: rows.length, worlds: worlds.length,
    preferredWithout: share(rows.map((r) => r.without)), preferredWith: share(rows.map((r) => r.with)),
    changed: rows.filter((r) => r.with !== r.without).map((r) => ({ id: r.id, without: r.without, with: r.with })),
    recall: { cases: picked.length, top1: share(picked.map((r) => r.recallHit)), top1WhenAnswerIsInMemory: share(picked.filter((r) => r.sameIntent).map((r) => r.recallHit)), answerInMemory: picked.filter((r) => r.sameIntent).length, recalledAny: share(picked.map((r) => r.recallAny)), embeddingsTop1: o.embed ? share(picked.map((r) => r.embedHit)) : null, embeddingsTop1WhenAnswerIsInMemory: o.embed ? share(picked.filter((r) => r.sameIntent).map((r) => r.embedHit)) : null },
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const embed = process.argv.includes('--embed') ? createOllamaEmbedder() : null;
  const r = await memoryEval({ embed });
  console.log(JSON.stringify(r, null, 2));
}
