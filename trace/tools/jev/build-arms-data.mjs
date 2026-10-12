#!/usr/bin/env node
// #903: gold labels -> training rows for the scikit-learn arms (data/arms-train.jsonl, gitignored), in exactly the
// shape the lr / nb arms read at run time (trace/src/beam/arms.mjs armSklearn): normalized tokens (slot tokens, no
// project names) and slot shapes.
//   node trace/tools/jev/build-arms-data.mjs [--gold file] [--seed n] [--out file]
// Row: {id, split: "train"|"test", read: {tokens: [{t, slot?, kind?}], slots}, gold: {intent, object, slot: slot id|null, layers}}
// `split` is the seeded hash eval-intent.mjs uses, so train_arms.py fits only what the eval calls train.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { slotKey } from '../../../packages/engine/line/drafter/classifyJev.mjs';
import { readGold, readRequest, splitOf, GOLD_FILE, HERE } from './intentGold.mjs';

export const ARMS_TRAIN_FILE = path.join(HERE, 'data', 'arms-train.jsonl');

/**
 * One gold record as an arms training row.
 * @param {any} g @param {number} seed
 */
export function armsRow(g, seed) {
  const { d } = readRequest(g.project, g.request);
  const sids = [...new Set(d.tokens.filter((x) => x.slot).map((x) => /** @type {string} */ (x.slot)))];
  const slot = sids.find((s) => slotKey(s, d.slots, d.bindings) === g.gold.slot) ?? null;
  return {
    id: g.id,
    split: splitOf(g.id, seed),
    read: { tokens: d.tokens.map(({ t, slot: s, kind }) => (s ? { t, slot: s, kind } : { t })), slots: d.slots },
    gold: { intent: g.gold.intent, object: g.gold.object ?? null, slot, layers: [...g.gold.layers] },
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const arg = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
  const seed = Number(arg('--seed') ?? 0);
  const rows = readGold(arg('--gold') ?? GOLD_FILE).map((g) => armsRow(g, seed));
  const out = arg('--out') ?? ARMS_TRAIN_FILE;
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  const n = (s) => rows.filter((r) => r.split === s).length;
  console.log(`${rows.length} rows (train ${n('train')}, held-out ${n('test')}, seed ${seed}) -> ${path.relative(process.cwd(), out)}`);
}
