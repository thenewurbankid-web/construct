#!/usr/bin/env node
// Evaluate a context-line scorer on data/context-lines.jsonl (#881): precision@k / recall@k of USEFUL lines per turn,
// and the tokens the top-5 / top-15 cut saves.
//   node tools/jev/eval-context.mjs --runs pilot-qwen-7b-r2                    # static scorer
//   node tools/jev/eval-context.mjs --runs pilot-qwen-7b-r2 --scores s.jsonl   # jev scores ({id, score} per line)
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rankLines, capFor } from './contextScore.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * @param {any[]} rows dataset rows @param {(r: any) => number} [score] a scorer; static when omitted
 * @param {number[]} [ks]
 */
export function evaluate(rows, score, ks = [1, 3, 5]) {
  const byAction = new Map();
  for (const r of rows) {
    const k = `${r.run}:${r.action}`;
    if (!byAction.has(k)) byAction.set(k, []);
    byAction.get(k).push(r);
  }
  const m = Object.fromEntries(ks.flatMap((k) => [[`p@${k}`, 0], [`r@${k}`, 0]]));
  let turns = 0;
  const tok = { all: 0, top5: 0, top15: 0, adaptive: 0, shown: 0, shownTurns: 0, allOnShownTurns: 0, top5OnShown: 0, top15OnShown: 0 };
  for (const lines of byAction.values()) {
    const { ranked } = rankLines(lines, { attempt: lines[0].attempt, score });
    const sum = (ls) => ls.reduce((a, l) => a + l.tokens, 0);
    tok.all += sum(ranked); tok.top5 += sum(ranked.slice(0, 5)); tok.top15 += sum(ranked.slice(0, 15));
    tok.adaptive += sum(ranked.slice(0, capFor(lines[0].refusalRepeat)));
    if (lines[0].shownTokens !== null && lines[0].shownTokens !== undefined) {
      tok.shownTurns += 1; tok.shown += lines[0].shownTokens; tok.allOnShownTurns += sum(ranked);
      tok.top5OnShown += sum(ranked.slice(0, 5)); tok.top15OnShown += sum(ranked.slice(0, 15));
    }
    const useful = ranked.filter((l) => l.label === 'useful').length;
    if (!useful) continue;
    turns += 1;
    for (const k of ks) {
      const hit = ranked.slice(0, k).filter((l) => l.label === 'useful').length;
      m[`p@${k}`] += hit / Math.min(k, ranked.length);
      m[`r@${k}`] += hit / useful;
    }
  }
  for (const k of Object.keys(m)) m[k] = turns ? +(m[k] / turns).toFixed(3) : null;
  return { turnsWithUseful: turns, turns: byAction.size, lines: rows.length, ...m, tokens: tok };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const arg = (n) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : null; };
  const runs = (arg('--runs') ?? '').split(',').filter(Boolean);
  const rows = readFileSync(arg('--data') ?? join(HERE, 'data', 'context-lines.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l))
    .filter((r) => !runs.length || runs.includes(r.run));
  let score;
  if (arg('--scores')) {
    const s = new Map(readFileSync(arg('--scores'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)).map((x) => [x.id, x.score]));
    score = (l) => s.get(l.id) ?? 0;
  }
  console.log(JSON.stringify(evaluate(rows, score)));
}
