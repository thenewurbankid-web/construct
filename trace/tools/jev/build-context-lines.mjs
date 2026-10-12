#!/usr/bin/env node
// Regenerate trace/tools/jev/data/context-lines.jsonl from the bench logs copied under data/runs/<run>/ (#881).
//   node tools/jev/build-context-lines.mjs            # writes the dataset, prints label counts per run
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRun } from './contextLines.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const RUNS = join(HERE, 'data', 'runs');
const OUT = join(HERE, 'data', 'context-lines.jsonl');
const readJsonl = (f) => (existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l)) : []);

const rows = [];
const counts = {};
for (const run of readdirSync(RUNS).sort()) {
  const rs = buildRun(run, readJsonl(join(RUNS, run, 'calls.jsonl')), readJsonl(join(RUNS, run, 'turns.jsonl')));
  // Collapse exact repeats (a refusal loop shows the same line before the same next action many times): keep one
  // row per (text, attempt, next attempt, label) with a weight, so a 189-turn loop does not drown the other runs.
  const byKey = new Map();
  for (const r of rs) {
    const k = `${r.text}|${r.attempt}|${r.next.attempt}|${r.label}`;
    if (byKey.has(k)) byKey.get(k).weight += 1; else byKey.set(k, Object.assign(r, { weight: 1 }));
  }
  const kept = [...byKey.values()];
  const c = (list, l) => list.filter((r) => r.label === l).length;
  counts[run] = { raw: rs.length, rows: kept.length, useful: c(kept, 'useful'), noise: c(kept, 'noise'), unclear: c(kept, 'unclear'), rawUseful: c(rs, 'useful'), rawNoise: c(rs, 'noise') };
  rows.push(...kept);
}
writeFileSync(OUT, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
console.log(`wrote ${rows.length} rows to ${OUT}`);
console.table(counts);
