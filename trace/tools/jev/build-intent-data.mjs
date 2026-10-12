#!/usr/bin/env node
// #892: gold labels -> jev training rows (data/intent-train.jsonl), with the exact state and questions the jev provider
// sends at run time (classifyJev.mjs jevQuestions; options numbered "1) add" as provider.mjs numbers them).
//   node trace/tools/jev/build-intent-data.mjs [--gold file] [--seed n] [--out file]
// Row: {id, split: "train"|"test", state: {part, facts}, questions: [{key, text, options, gold: index|null}]}
// `split` uses the same seeded hash as eval-intent.mjs, so the trainer holds out exactly what the eval calls held-out.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { jevQuestions, slotKey } from '../../../packages/engine/line/drafter/classifyJev.mjs';
import { readGold, readRequest, splitOf, GOLD_FILE, HERE, VERBS, OBJECTS } from './intentGold.mjs';

export const TRAIN_FILE = path.join(HERE, 'data', 'intent-train.jsonl');

/**
 * One gold record as a training row.
 * @param {any} g @param {number} seed
 */
export function trainRow(g, seed) {
  const { d, normalized } = readRequest(g.project, g.request);
  const qs = jevQuestions(normalized, d.slots);
  const [verb, ...rest] = g.gold.intent === 'unknown' ? [null] : g.gold.intent.split('.');
  const object = verb ? rest.join('.') : null;
  const goldOf = (key, options) => {
    if (key === 'verb') return verb ? VERBS.indexOf(verb) : null;
    if (key === 'object') return object ? Object.keys(OBJECTS).indexOf(object) : null;
    if (key === 'slot') { const i = qs.slotIds.findIndex((s) => slotKey(s, d.slots, d.bindings) === g.gold.slot); return i >= 0 ? i : options.length - 1; }
    if (key.startsWith('layer:')) return g.gold.layers.includes(key.slice(6)) ? 0 : 1;
    return null;
  };
  return {
    id: g.id,
    split: splitOf(g.id, seed),
    state: { part: qs.part, facts: qs.facts },
    questions: qs.questions.map((q) => ({ key: q.key, text: q.question, options: q.options.map((o, i) => `${i + 1}) ${o}`), gold: goldOf(q.key, q.options) })),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const arg = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
  const seed = Number(arg('--seed') ?? 0);
  const rows = readGold(arg('--gold') ?? GOLD_FILE).map((g) => trainRow(g, seed));
  const out = arg('--out') ?? TRAIN_FILE;
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  const n = (s) => rows.filter((r) => r.split === s).length;
  console.log(`${rows.length} rows (train ${n('train')}, held-out ${n('test')}, seed ${seed}) -> ${path.relative(process.cwd(), out)}`);
}
