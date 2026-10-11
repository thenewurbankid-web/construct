#!/usr/bin/env node
// Train Line seed: generate Claude's proposed cases over the Line sample and the imaginary worlds, keep only the ones
// Construct verifies (every gold route applies in a scratch copy and its checks pass), and store them as line/train/
// cases.jsonl through the Train Line store (Construct's writer, logged as Claude's).
//
//   node packages/tools/line-train/seed.mjs                       every world, one process
//   node packages/tools/line-train/seed.mjs --shard 0/4 --out x   one quarter of the worlds into a JSONL file
//   node packages/tools/line-train/seed.mjs --merge a b c d       store the shards' cases (replaces the stored seed)
import fs from 'node:fs';
import { WORLD_IDS } from '@line/construct-engine/line/train/corpus';
import { generate } from '@line/construct-engine/line/train/generate';
import { createTrainStore, CASES } from '@line/construct-engine/line/train/store';

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const now = new Date().toISOString();

if (args[0] === '--merge') {
  const cases = args.slice(1).flatMap((f) => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)));
  const store = createTrainStore();
  fs.rmSync(`${store.root}/${CASES}`, { force: true });
  createTrainStore().put(cases, 'claude', 'propose', 'generated and verified by packages/tools/line-train/seed.mjs');
  console.log(`Stored ${cases.length} verified cases in ${store.root}/${CASES}.`);
} else {
  const [k, n] = String(opt('--shard') ?? '0/1').split('/').map(Number);
  const all = [{ kind: 'sample' }, ...WORLD_IDS.flatMap((id) => ['clean', 'cross-feature', 'missing-base'].map((variant) => ({ kind: 'corpus', id, variant })))];
  const worlds = all.filter((_, i) => i % n === k);
  const { kept, dropped } = generate({ worlds, now });
  const out = opt('--out');
  if (out) fs.writeFileSync(out, kept.map((c) => JSON.stringify(c)).join('\n') + '\n');
  else createTrainStore().put(kept, 'claude', 'propose', 'generated and verified by packages/tools/line-train/seed.mjs');
  console.log(`Kept ${kept.length} cases; dropped ${dropped.length} that Construct did not verify.`);
  for (const d of dropped) console.log(`  dropped ${d.intent} on ${d.world}: ${d.why.join(' | ')}`);
}
