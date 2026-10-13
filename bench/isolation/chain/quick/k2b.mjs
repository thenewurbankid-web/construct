// K2b and K5b (#942): the plan is written as CODE (a short sketch), and hardened Smith (canonical) turns it into the
// Smith plan with no model. Gaps (Smith's unhandled pieces: node type + code) go back to the same model, up to 2 rounds.
// K5b: the availability formatter end to end with that plan: qwen2.5-coder:1.5b fills the stub (best of 5, tsc gate),
// Smith validates the fill against the plan.
import { TASKS } from './tasks.mjs';
import { describe, matchPlan, norm } from './lib/smith.mjs';
import { tscGate, unitCheck } from './lib/gates.mjs';
import { chat } from './lib/ollama.mjs';
import { replaceBody, stubProblems } from '../../../../packages/engine/line/path/stubs.mjs';

export const PLAN_MODELS = Object.freeze(['qwen2.5-coder:7b', 'qwen2.5-coder:1.5b']);
const ROUNDS = 2;
const full = (t, src) => `${t.prelude ?? ''}${src}`;
const fenced = (s) => (s.match(/```[a-z]*\n([\s\S]*?)```/) ?? [null, s])[1];
const sigs = (t) => t.stub.split('\n').filter((l) => l.startsWith('export function')).map((l) => l.replace(/\s*\{$/, ''));

const SKETCH_SYSTEM = 'You write the plan for Trace stubs as a short TypeScript sketch: each given signature with a body. Keep every signature exactly. Reply with one ```ts block and nothing else.';
const sketchUser = (t) => `Spec:\n${t.spec}\n\n${t.prelude ? `Types:\n${t.prelude}\n` : ''}Signatures:\n${sigs(t).join('\n')}\n\nSketch:`;
const gapUser = (t, sketch, gaps) => `${sketchUser(t)}\n\`\`\`ts\n${sketch}\n\`\`\`\n\nSmith could not read these pieces of the sketch (node type: code):\n${gaps.map((g) => `- ${g.type}: ${g.code}`).join('\n')}\nRewrite the sketch without these forms. Reply with one \`\`\`ts block.`;

/** Gaps: unhandled pieces, a parse error, or a missing function. */
function gapsOf(t, d) {
  const out = [];
  for (const [fn, v] of Object.entries(d)) for (const u of v.unhandled) out.push({ fn, ...u });
  for (const fn of t.functions) if (!d[fn]) out.push({ fn, kind: 'missing', type: 'FunctionDeclaration', code: `function ${fn} is missing` });
  return out;
}

/** One plan: sketch, Smith, up to 2 gap rounds. */
export async function sketchPlan(t, model, seed) {
  let tokens = 0, calls = 0;
  let r = await chat({ model, system: SKETCH_SYSTEM, user: sketchUser(t), options: { temperature: 0.7, seed, num_predict: 768 } });
  tokens += r.promptTokens + r.evalTokens; calls++;
  let sketch = fenced(r.content).trim();
  let d = await describe(full(t, sketch), { canonical: true });
  let gaps = gapsOf(t, d);
  const gapsByRound = [gaps.length];
  for (let round = 1; round <= ROUNDS && gaps.length; round++) {
    r = await chat({ model, system: SKETCH_SYSTEM, user: gapUser(t, sketch, gaps), options: { temperature: 0.7, seed: seed + round * 1000, num_predict: 768 } });
    tokens += r.promptTokens + r.evalTokens; calls++;
    sketch = fenced(r.content).trim();
    d = await describe(full(t, sketch), { canonical: true });
    gaps = gapsOf(t, d);
    gapsByRound.push(gaps.length);
  }
  const plan = Object.fromEntries(t.functions.map((fn) => [fn, d[fn]?.sentences ?? []]));
  return { sketch, plan, gaps, gapsByRound, rounds: gapsByRound.length - 1, tokens, calls };
}

export async function k2b({ write }) {
  const out = {};
  for (const model of PLAN_MODELS) {
    const rows = [];
    for (const t of TASKS) {
      for (let s = 0; s < 5; s++) {
        const p = await sketchPlan(t, model, 200 + s);
        const m = matchPlan(t.plan, p.plan);
        rows.push({ task: t.id, sample: s, ...p, score: +m.score.toFixed(3), match: m.score === 1, misses: m.gaps });
      }
    }
    const n = rows.length;
    const zeroAfter = (k) => rows.filter((r) => (r.gapsByRound[Math.min(k, r.gapsByRound.length - 1)] ?? 0) === 0).length;
    const summary = {
      model, method: 'code sketch (fenced ts) -> hardened Smith canonical; gaps fed back up to 2 rounds; T=0.7 seeds 200-204', samples: n,
      zeroGapsAfterRound: { 0: zeroAfter(0), 1: zeroAfter(1), 2: zeroAfter(2) },
      matchPct: Math.round((100 * rows.filter((r) => r.match).length) / n), meanScorePct: Math.round((100 * rows.reduce((a, r) => a + r.score, 0)) / n),
      perTaskMatch: Object.fromEntries(TASKS.map((t) => [t.id, `${rows.filter((r) => r.task === t.id && r.match).length}/5`])),
      meanRounds: +(rows.reduce((a, r) => a + r.rounds, 0) / n).toFixed(2), tokens: rows.reduce((a, r) => a + r.tokens, 0), calls: rows.reduce((a, r) => a + r.calls, 0), killBelow: 50,
    };
    summary.verdict = summary.matchPct >= 50 ? 'pass' : 'kill';
    out[model] = { summary, rows };
    console.log('K2b', JSON.stringify(summary));
  }
  write('k2b', out);
}

const FILL_SYSTEM = 'You fill the body of one Trace stub. The signature is locked. The plan is Smith English, one sentence per statement, in order. Reply with the body only, in one ```ts block.';
const FILL_EXAMPLE = "Example.\nStub: function dueLabel(loan: Loan): string\nPlan:\n  If loan's renewed, return 'Renewed'.\n  It returns 'Renew'.\nBody:\n```ts\nif (loan.renewed) {\n  return 'Renewed';\n}\nreturn 'Renew';\n```";

export async function k5b({ write }) {
  const t = TASKS.find((x) => x.id === 'availability');
  const fn = 'formatAvailability';
  const out = {};
  for (const model of PLAN_MODELS) {
    const runs = [];
    for (let r = 0; r < 5; r++) {
      const p = await sketchPlan(t, model, 700 + r);
      const lines = p.plan[fn];
      let tokens = p.tokens, calls = p.calls, chosen = null;
      const tries = [];
      for (let k = 0; k < 5 && !chosen && lines.length; k++) {
        const c = await chat({ system: FILL_SYSTEM, user: `${FILL_EXAMPLE}\n\nStub: ${sigs(t)[0].replace(/^export /, '')}\nPlan:\n${lines.map((l) => `  ${l}`).join('\n')}\nBody:`, options: { temperature: 0.7, seed: 800 + r * 10 + k } });
        calls++; tokens += c.promptTokens + c.evalTokens;
        const sp = replaceBody(t.stub, fn, fenced(c.content));
        if (!sp.ok) { tries.push({ k, splice: sp.code }); continue; }
        const diags = tscGate(full(t, sp.source));
        const stubs = stubProblems(sp.source, fn).map((x) => x.code);
        tries.push({ k, tsc: diags.length, stub: stubs });
        if (!diags.length && !stubs.length) chosen = sp.source;
      }
      let smith = null, vsPlan = false, vsRef = null, unit = false;
      if (chosen) {
        smith = (await describe(chosen, { canonical: true }))[fn]?.sentences ?? [];
        vsPlan = smith.length === lines.length && smith.every((s, i) => norm(s) === norm(lines[i]));
        vsRef = +matchPlan(t.plan, { [fn]: smith }).score.toFixed(3);
        unit = await unitCheck(chosen, t.check);
      }
      const planRight = matchPlan(t.plan, p.plan).score === 1;
      runs.push({ run: r, planModel: model, sketch: p.sketch, plan: lines, planGaps: p.gaps.length, planRight, tries, code: chosen, smith, pass: !!chosen && vsPlan, unit, passAndUnit: !!chosen && vsPlan && unit, vsRef, calls, tokens });
    }
    const summary = {
      planModel: model, coder: 'qwen2.5-coder:1.5b', runs: 5, pass: runs.filter((x) => x.pass).length, passAndUnit: runs.filter((x) => x.passAndUnit).length,
      plansRight: runs.filter((x) => x.planRight).length, tscClean: runs.filter((x) => x.code).length, unit: runs.filter((x) => x.unit).length,
      tokens: runs.reduce((a, x) => a + x.tokens, 0), calls: runs.reduce((a, x) => a + x.calls, 0),
      rule: 'pass = tsc- and stub-clean fill whose canonical Smith sentences equal the plan sentences, in order',
    };
    summary.verdict = summary.pass > 0 ? 'pass' : 'kill';
    out[model] = { summary, runs };
    console.log('K5b', JSON.stringify(summary));
  }
  write('k5b', out);
}
