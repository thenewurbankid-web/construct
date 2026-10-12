#!/usr/bin/env node
// #892: score the drafter's static classifier against jev on the gold labels (data/intent-gold.jsonl).
//   node trace/tools/jev/eval-intent.mjs [--gold file] [--seed n] [--no-jev] [--jev-url http://127.0.0.1:8765] [--out dir] [--json]
// Per label set (intent, object, slot exact; layers exact + micro F1), static vs jev, on all rows and on the held-out
// split (`--seed`, the same split train_intent.py holds out); the top confusion pairs; the fork rate and how often a fork
// would have held the gold value (the beam-rescue proxy). Writes <out>/intent-eval.md and .json; always exits 0.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyJev, closedLabels, forksOf, DEFAULT_GATE } from '../../../packages/engine/line/drafter/classifyJev.mjs';
import { readGold, readRequest, splitOf, CATALOG, GOLD_FILE, HERE } from './intentGold.mjs';

export const REPORT_DIR = path.join(HERE, 'reports');
const LABELS = /** @type {const} */ (['intent', 'object', 'slot', 'layers']);

/** @param {string[]} g @param {string[]} p */
const overlap = (g, p) => ({ tp: p.filter((x) => g.includes(x)).length, fp: p.filter((x) => !g.includes(x)).length, fn: g.filter((x) => !p.includes(x)).length });
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const pct = (n, d) => (d ? Math.round((n / d) * 1000) / 10 : null);

/**
 * Read every gold row with static and (optionally) jev. Rows are processed in id order, so a run is deterministic for a
 * deterministic jev.
 * @param {any[]} gold
 * @param {{choose?: any, jev?: boolean, baseUrl?: string, seed?: number, gate?: number, timeoutMs?: number}} [o]
 */
export async function scoreRows(gold, o = {}) {
  const seed = o.seed ?? 0;
  const gate = o.gate ?? DEFAULT_GATE;
  const rows = [];
  for (const g of [...gold].sort((a, b) => a.id.localeCompare(b.id))) {
    const { d, normalized, staticLabels } = readRequest(g.project, g.request);
    let jevLabels = null; let conf = null;
    if (o.jev !== false) {
      const jl = await classifyJev(normalized, d.slots, CATALOG, { choose: o.choose, baseUrl: o.baseUrl, timeoutMs: o.timeoutMs ?? 15000 });
      jevLabels = closedLabels(jl, d.slots, d.bindings);
      conf = jl?.confidences ?? null;
    }
    rows.push({ id: g.id, split: splitOf(g.id, seed), uncertain: Boolean(g.uncertain), request: g.request, normalized: d.request, gold: g.gold, static: staticLabels, jev: jevLabels, confidence: conf, forks: forksOf(staticLabels, jevLabels, conf, gate) });
  }
  return rows;
}

/**
 * Metrics of one predictor ('static' | 'jev') over scored rows.
 * @param {any[]} rows @param {'static'|'jev'} who
 */
export function metrics(rows, who) {
  const have = rows.filter((r) => r[who]);
  const m = { n: have.length };
  for (const k of ['intent', 'object', 'slot']) m[k] = pct(have.filter((r) => same(r.gold[k], r[who][k])).length, have.length);
  m.layersExact = pct(have.filter((r) => same([...r.gold.layers].sort(), [...r[who].layers].sort())).length, have.length);
  const t = have.reduce((a, r) => { const o = overlap(r.gold.layers, r[who].layers); return { tp: a.tp + o.tp, fp: a.fp + o.fp, fn: a.fn + o.fn }; }, { tp: 0, fp: 0, fn: 0 });
  const p = t.tp / (t.tp + t.fp || 1); const rc = t.tp / (t.tp + t.fn || 1);
  m.layersF1 = have.length ? Math.round((2 * p * rc) / (p + rc || 1) * 1000) / 10 : null;
  return m;
}

/** Top confusion pairs "gold -> predicted" per label, both predictors. @param {any[]} rows @param {number} [top] */
export function confusions(rows, top = 10) {
  const c = new Map();
  for (const r of rows) for (const who of ['static', 'jev']) {
    if (!r[who]) continue;
    for (const k of LABELS) {
      const g = k === 'layers' ? r.gold.layers.join('+') || '-' : String(r.gold[k]);
      const p = k === 'layers' ? r[who].layers.join('+') || '-' : String(r[who][k]);
      if (g === p) continue;
      const key = `${who}|${k}|${g}|${p}`;
      c.set(key, (c.get(key) ?? 0) + 1);
    }
  }
  return [...c].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, top).map(([k, n]) => { const [who, label, gold, pred] = k.split('|'); return { who, label, gold, pred, n }; });
}

/** Fork rate and the beam-rescue proxy. @param {any[]} rows */
export function forkStats(rows) {
  const answered = rows.filter((r) => r.jev);
  const forked = answered.filter((r) => r.forks.length);
  const forks = answered.flatMap((r) => r.forks.map((f) => ({ ...f, gold: r.gold[f.label] })));
  const norm = (v) => (Array.isArray(v) ? [...v].sort() : v);
  const contained = forks.filter((f) => same(norm(f.gold), norm(f.static)) || same(norm(f.gold), norm(f.jev)));
  const rescued = forks.filter((f) => !same(norm(f.gold), norm(f.static)) && same(norm(f.gold), norm(f.jev)));
  const byLabel = Object.fromEntries(LABELS.map((l) => [l, forks.filter((f) => f.label === l).length]));
  return { answered: answered.length, forkedRows: forked.length, forkRate: pct(forked.length, answered.length), forkLabels: forks.length, byLabel, containsGold: pct(contained.length, forks.length), rescues: rescued.length };
}

/** @param {any[]} rows @param {{seed: number, jev: string}} meta */
export function summarize(rows, meta) {
  const parts = { all: rows, 'held-out': rows.filter((r) => r.split === 'test') };
  const tables = Object.fromEntries(Object.entries(parts).map(([k, rs]) => [k, { static: metrics(rs, 'static'), jev: metrics(rs, 'jev'), forks: forkStats(rs) }]));
  const cover = {};
  for (const r of rows) cover[r.gold.intent] = (cover[r.gold.intent] ?? 0) + 1;
  // Layers are recall-tuned in static (it over-includes on purpose), so their pairs get their own short list.
  const all = confusions(rows, 1000);
  return { ...meta, rows: rows.length, uncertain: rows.filter((r) => r.uncertain).length, tables, confusions: all.filter((c) => c.label !== 'layers').slice(0, 10), layerConfusions: all.filter((c) => c.label === 'layers').slice(0, 5), coverage: cover };
}

const cell = (v) => (v === null || v === undefined ? '—' : `${v}%`);

/** The markdown report. @param {ReturnType<typeof summarize>} s */
export function renderMarkdown(s) {
  const out = [`# Intent eval: static vs jev`, '', `Gold: ${s.rows} rows (${s.uncertain} marked uncertain), seed ${s.seed}. jev: ${s.jev}.`, ''];
  for (const [name, t] of Object.entries(s.tables)) {
    out.push(`## ${name} (static n=${t.static.n}, jev n=${t.jev.n})`, '', '| label | static | jev |', '|---|---|---|');
    for (const [k, label] of [['intent', 'intent (exact)'], ['object', 'object (exact)'], ['slot', 'slot (exact)'], ['layersExact', 'layers (exact set)'], ['layersF1', 'layers (micro F1)']]) out.push(`| ${label} | ${cell(t.static[k])} | ${cell(t.jev[k])} |`);
    const f = t.forks;
    out.push('', f.answered ? `Forks: ${f.forkedRows}/${f.answered} rows (${cell(f.forkRate)}), ${f.forkLabels} fork labels (intent ${f.byLabel.intent}, object ${f.byLabel.object}, slot ${f.byLabel.slot}, layers ${f.byLabel.layers}); a fork held the gold value ${cell(f.containsGold)} of the time; jev alone was right on ${f.rescues} of them (beam rescues).` : 'Forks: jev did not answer, so there are none.', '');
  }
  out.push('## Top confusions: intent, object, slot (gold -> predicted, top 10)', '', '| who | label | gold | predicted | n |', '|---|---|---|---|---|');
  for (const c of s.confusions) out.push(`| ${c.who} | ${c.label} | ${c.gold} | ${c.pred} | ${c.n} |`);
  out.push('', '## Top confusions: layers (top 5)', '', '| who | gold | predicted | n |', '|---|---|---|---|');
  for (const c of s.layerConfusions) out.push(`| ${c.who} | ${c.gold} | ${c.pred} | ${c.n} |`);
  out.push('', '## Gold coverage per intent', '', Object.entries(s.coverage).sort().map(([k, n]) => `${k} ${n}`).join(' · '), '');
  return out.join('\n');
}

/** jev's weights as /health reports them (or why it is not there). @param {string} [base] */
async function jevHealth(base) {
  try { const r = await fetch(`${base || process.env.JEV_URL || 'http://127.0.0.1:8765'}/health`, { signal: AbortSignal.timeout(2000) }); const j = await r.json(); return `up, weights ${j.weights}`; } catch { return 'not running'; }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const arg = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
  try {
    const seed = Number(arg('--seed') ?? 0);
    const useJev = !argv.includes('--no-jev');
    const baseUrl = arg('--jev-url');
    const jev = useJev ? await jevHealth(baseUrl) : 'off (--no-jev)';
    const rows = await scoreRows(readGold(arg('--gold') ?? GOLD_FILE), { jev: useJev && jev !== 'not running', baseUrl, seed });
    const s = summarize(rows, { seed, jev });
    const dir = arg('--out') ?? REPORT_DIR;
    fs.mkdirSync(dir, { recursive: true });
    const md = renderMarkdown(s);
    fs.writeFileSync(path.join(dir, 'intent-eval.md'), md);
    fs.writeFileSync(path.join(dir, 'intent-eval.json'), JSON.stringify({ at: new Date().toISOString(), ...s, scored: rows }, null, 1));
    console.log(argv.includes('--json') ? JSON.stringify(s) : `${md}\nWrote ${path.relative(process.cwd(), path.join(dir, 'intent-eval.md'))}`);
  } catch (err) {
    console.log(`eval-intent could not run: ${/** @type {Error} */ (err).message}`);
  }
}
