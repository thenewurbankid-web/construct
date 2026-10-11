#!/usr/bin/env node
// The System 1 drafter's retrieval index of Train Line's seed (line/train/retrieval-index.json): every train-split case
// on a train world, verified and not disputed, as the drafter's slot-form transition records (train/records.mjs). Held-out
// cases and held-out worlds (w30-w39) are never in it. Train Line reads it so the first draft does not rebuild ~400
// cases' records; a case it does not hold (new, or its status changed) is built on the fly. Regenerate after the seed
// changes (test/line-train.test.mjs fails while it is stale).
//
//   node packages/tools/line-train/retrieval-index.mjs           write line/train/retrieval-index.json
//   node packages/tools/line-train/retrieval-index.mjs --check   exit 1 when the committed index is stale
import fs from 'node:fs';
import path from 'node:path';
import { createTrainStore, DEFAULT_TRAIN_ROOT } from '@line/construct-engine/line/train/store';
import { indexText, INDEX } from '@line/construct-engine/line/train/records';

const file = path.join(DEFAULT_TRAIN_ROOT, INDEX);
const text = indexText(createTrainStore().all());
let now = null;
try { now = fs.readFileSync(file, 'utf8'); } catch { /* none yet */ }
if (process.argv.includes('--check')) {
  if (now !== text) { console.log(`${INDEX} is stale; run node packages/tools/line-train/retrieval-index.mjs`); process.exit(1); }
  console.log(`${INDEX} is current.`);
} else {
  fs.writeFileSync(file, text);
  console.log(`Wrote ${INDEX}: ${Object.keys(JSON.parse(text).cases).length} train cases.`);
}
