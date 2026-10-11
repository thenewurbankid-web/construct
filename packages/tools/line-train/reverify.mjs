#!/usr/bin/env node
// Train Line re-verification: every stored case is read (a case stored before 2026-10-11 names a mirrored intent id
// and is read with the drafter catalog's id, train/contract.mjs TRAIN_INTENT_MAP), each of its gold routes is applied
// again in its own scratch copy of the case's world (train/verify.mjs, through Construct's writer, never the real
// project), and the cases are stored again through the Train Line store with fresh verification stamps. A case whose
// route no longer verifies is dropped and listed. Nothing outside line/train/ is written.
//
//   node packages/tools/line-train/reverify.mjs            re-verify and store (one logged action)
//   node packages/tools/line-train/reverify.mjs --dry-run  re-verify and report only
import { createTrainStore } from '@line/construct-engine/line/train/store';
import { verifyCase } from '@line/construct-engine/line/train/verify';
import { assertTrainCase } from '@line/construct-engine/line/train/contract';

const dry = process.argv.includes('--dry-run');
const store = createTrainStore();
const at = new Date().toISOString();
const kept = [];
const dropped = [];
for (const c of store.all()) {
  const v = verifyCase(c);
  let shape = null;
  try { assertTrainCase(c); } catch (e) { shape = String(/** @type {any} */ (e).message); }
  if (v.ok && !shape) kept.push({ ...c, verified: { routes: Object.fromEntries(Object.keys(v.routes).map((k) => [k, { ok: true, at }])) } });
  else dropped.push({ id: c.id, intent: c.intent, world: c.world, why: shape ? [shape] : Object.entries(v.routes).filter(([, r]) => !r.ok).map(([k, r]) => `${k}: ${r.sentence}`) });
}
if (!dry) store.rewrite(kept, 'claude', 'reverify', `${kept.length} cases re-verified in scratch copies; ${dropped.length} dropped`);
console.log(`${dry ? 'Would keep' : 'Kept'} ${kept.length} cases; ${dropped.length} did not verify${dry ? '' : ' and were dropped'}.`);
for (const d of dropped) console.log(`  ${d.id} ${d.intent} on ${d.world.kind === 'sample' ? 'sample' : `${d.world.id}:${d.world.variant}`}: ${d.why.join(' | ')}`);
