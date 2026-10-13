// Quick kill-tests for the English-loop chain (#942). One run, small N.
//   packages/tools/dev/heavy.sh node bench/isolation/chain/quick/run.mjs k3 k4 [k1 k2 k5]
// Writes bench/isolation/chain/quick/results/<test>.json. Calls only local qwen2.5-coder:1.5b and nomic-embed-text.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chat, embed, cosine, MODELS } from './lib/ollama.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, 'results');
fs.mkdirSync(OUT, { recursive: true });
const write = (name, data) => fs.writeFileSync(path.join(OUT, `${name}.json`), `${JSON.stringify(data, null, 2)}\n`);

async function k3() {
  const k = await import('./k3.mjs');
  const rows = [];
  for (const c of k.CASES) {
    const root = k.materialize(c);
    try {
      const f = k.buildFacts(root, c);
      const det = k.decide(c, f);
      const r = await chat({ system: k.SYSTEM, user: k.userPrompt(f.facts), format: k.schemaFor(f.candidates) });
      const a = r.json ?? {};
      rows.push({
        id: c.id, expect: c.expect, deterministic: det, answer: a,
        stepRight: a.step === c.expect.step, targetRight: a.target === c.expect.target, reasonRight: a.reason_id === c.expect.reason_id,
        right: a.step === c.expect.step && a.target === c.expect.target,
        promptTokens: r.promptTokens, evalTokens: r.evalTokens, ms: r.ms, facts: f.facts,
      });
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  }
  const n = rows.length;
  const pct = (key) => Math.round((100 * rows.filter((x) => x[key]).length) / n);
  const detRight = rows.filter((x) => JSON.stringify(x.deterministic) === JSON.stringify(x.expect)).length;
  const summary = { model: MODELS.coder, method: 'ollama format (closed enum JSON schema), T=0, seed 7', n, rightPct: pct('right'), stepPct: pct('stepRight'), targetPct: pct('targetRight'), reasonPct: pct('reasonRight'), deterministicRight: `${detRight}/${n}`, killBelow: 60 };
  summary.verdict = summary.rightPct >= 60 ? 'pass' : 'kill';
  write('k3', { summary, rows });
  console.log('K3', JSON.stringify(summary));
}

async function k4() {
  const k = await import('./k4.mjs');
  const atoms = k.readAtoms();
  const atomVecs = await embed(atoms.map((a) => `search_document: ${a.english}`));
  const qVecs = await embed(k.CASES.map((c) => `search_query: ${c.sentence}`));
  const rows = k.CASES.map((c, i) => {
    const exact = k.exactMatch(c.sentence, atoms);
    const ranked = k.rank(qVecs[i], atomVecs, atoms, cosine);
    const top = exact ? [exact, ...ranked.map((r) => r.id).filter((id) => id !== exact)] : ranked.map((r) => r.id);
    const rightScore = ranked.find((r) => r.id === c.atom).score;
    return { id: c.id, sentence: c.sentence, atom: c.atom, exact, top3: ranked.slice(0, 3).map((r) => ({ id: r.id, score: +r.score.toFixed(4) })), rightScore: +rightScore.toFixed(4), top1: top[0] === c.atom, inTop3: top.slice(0, 3).includes(c.atom) };
  });
  const n = rows.length;
  const right = rows.filter((r) => r.top1).map((r) => r.top3[0].score);
  const wrong = rows.filter((r) => !r.top1).map((r) => r.top3[0].score);
  const summary = {
    model: MODELS.embed, atoms: atoms.length, n,
    exactHits: rows.filter((r) => r.exact).length,
    top1Pct: Math.round((100 * rows.filter((r) => r.top1).length) / n), top3Pct: Math.round((100 * rows.filter((r) => r.inTop3).length) / n),
    minRightTop1Score: right.length ? Math.min(...right) : null, maxWrongTop1Score: wrong.length ? Math.max(...wrong) : null, killBelow: 50,
  };
  summary.verdict = summary.top1Pct >= 50 ? 'pass' : 'kill';
  write('k4', { summary, atoms: atoms.map((a) => a.id), rows });
  console.log('K4', JSON.stringify(summary));
}

const TESTS = { k3, k4 };
const want = process.argv.slice(2);
for (const t of want.length ? want : Object.keys(TESTS)) {
  if (!TESTS[t]) { const m = await import('./smith-tests.mjs'); await m.run(t, { write }); continue; }
  await TESTS[t]();
}
