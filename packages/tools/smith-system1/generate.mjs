#!/usr/bin/env node
// #940 Smith System 1 -- the training/eval data generator. Deterministic, no model, no network: reads the repo's
// sources (sources.mjs), builds the dataset (lib.mjs buildDataset) and writes
//   <out>/train.jsonl  val.jsonl  test.jsonl  eval.jsonl  stats.json
//
//   node packages/tools/smith-system1/generate.mjs [--out DIR] [--no-smith] [--quiet]
//
// --out defaults to /tmp/construct-smith-system1 (outside the repo; packages/tools/dev/heavy.sh prunes stale
// /tmp/construct-* folders). --no-smith skips Smith's translations (the linked atomic-codemod), e.g. on a machine
// without it.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDataset, toJsonl } from './lib.mjs';
import { atomPairs, contractPairs, ledgerEval, pagesEval, probePairs, readProbe, smithPairs } from './sources.mjs';

export const DEFAULT_OUT = '/tmp/construct-smith-system1';

/**
 * Collect every source and build the dataset. Pure apart from reading the repo (and Smith, unless `smith: false`).
 * @param {{smith?: boolean, summarizeCode?: Function, roots?: readonly string[]}} [o]
 */
export async function generate(o = {}) {
  const probe = readProbe();
  const ev = ledgerEval(probe);
  const pages = pagesEval();
  const evalPairs = [...ev.pairs, ...pages.pairs];
  const evalSlices = {};
  for (const p of evalPairs) evalSlices[p.meta.slice] = (evalSlices[p.meta.slice] ?? 0) + 1;
  const atoms = await atomPairs();
  const contracts = contractPairs();
  const samples = probePairs(probe);
  const smith = o.smith === false ? { pairs: [], counts: { smithSkipped: true } } : await smithPairs(o);
  const extra = { ...atoms.counts, ...contracts.counts, ...samples.counts, ...smith.counts, ...ev.counts, ledgerFactsWithoutCodeList: ev.unresolvedFacts, evalSlices };
  return buildDataset([...atoms.pairs, ...contracts.pairs, ...samples.pairs, ...smith.pairs], evalPairs, extra);
}

/** Write a dataset to a folder; returns the file paths. */
export function write(ds, out) {
  fs.mkdirSync(out, { recursive: true });
  const files = {};
  for (const k of ['train', 'val', 'test', 'eval']) {
    files[k] = path.join(out, `${k}.jsonl`);
    fs.writeFileSync(files[k], toJsonl(ds[k]));
  }
  files.stats = path.join(out, 'stats.json');
  fs.writeFileSync(files.stats, `${JSON.stringify(ds.stats, null, 2)}\n`);
  return files;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const i = argv.indexOf('--out');
  const out = path.resolve(i >= 0 ? argv[i + 1] : DEFAULT_OUT);
  const ds = await generate({ smith: !argv.includes('--no-smith') });
  write(ds, out);
  if (!argv.includes('--quiet')) {
    console.log(`Wrote ${ds.stats.total} pairs (train ${ds.stats.splits.train}, val ${ds.stats.splits.val}, test ${ds.stats.splits.test}) and ${ds.stats.splits.eval} eval pairs to ${out}.`);
    console.log(JSON.stringify(ds.stats, null, 2));
  }
}
