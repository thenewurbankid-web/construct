// K2b and K5b (#942): the plan is written as CODE (one prefilled sketch per function), and hardened Smith (canonical) turns it into the
// Smith plan with no model. Gaps (Smith's unhandled pieces: node type + code) go back to the same model, up to 2 rounds.
// K5b: the availability formatter end to end with that plan: qwen2.5-coder:1.5b fills the stub (best of 5, tsc gate),
// Smith validates the fill against the plan.
import { TASKS } from './tasks.mjs';
import { describe, matchPlan, norm } from './lib/smith.mjs';
import { tscGate, unitCheck } from './lib/gates.mjs';
import { replaceBody, stubProblems } from '../../../../packages/engine/line/path/stubs.mjs';
import { prefilledFunction, fillBody } from './lib/fill.mjs';

export const PLAN_MODELS = Object.freeze(['qwen2.5-coder:7b', 'qwen2.5-coder:1.5b']);
const ROUNDS = 2;
const full = (t, src) => `${t.prelude ?? ''}${src}`;
const sigs = (t) => t.stub.split('\n').filter((l) => l.startsWith('export function')).map((l) => l.replace(/\s*\{$/, ''));
export const sigOf = (t, fn) => sigs(t).find((s) => new RegExp(`^export function ${fn}\\(`).test(s));

// One function per request: the prompt carries only this function's signature, the assistant turn is that signature
// plus `{` (prefilled), and generation is cut at its closing brace, so each sketch is exactly one function.
export const SKETCH_SYSTEM = 'You write the plan for one Trace stub as a short TypeScript sketch of its body. The signature is already written and locked.';
export const sketchUser = (t, fn) => `Spec:\n${t.spec}\n\n${t.prelude ? `Types:\n${t.prelude}\n` : ''}Signature:\n${sigOf(t, fn)}\n\nSketch:`;
// Gap feedback for one function: its previous sketch and only its unhandled pieces, listed as examples of forms to avoid.
export const gapUser = (t, fn, code, gaps) => `${sketchUser(t, fn)}\n\nYour previous sketch:\n\`\`\`ts\n${code}\n\`\`\`\n\nSmith could not read these pieces, for example (node type: code):\n${gaps.map((g) => `- ${g.type}: ${g.code}`).join('\n')}\nWrite ${fn} again without these forms.`;

/** One function's gaps: its unhandled pieces, or the whole function when Smith could not read it. */
function gapsOf(fn, d) {
  if (!d[fn]) return [{ fn, kind: 'missing', type: 'FunctionDeclaration', code: `function ${fn} could not be read` }];
  return d[fn].unhandled.map((u) => ({ fn, ...u }));
}

/** One function's sketch (prefilled; extra functions the model writes on are cut). */
export async function sketchFn(t, fn, model, seed, prev = null, fetchImpl) {
  const signature = sigOf(t, fn);
  const user = prev ? gapUser(t, fn, prev.code, prev.gaps) : sketchUser(t, fn);
  return prefilledFunction({ model, system: SKETCH_SYSTEM, user, signature, seed, options: { num_predict: 768 }, fetchImpl });
}

/** One plan: a sketch per function, Smith, up to 2 gap rounds for the functions that still have gaps. */
export async function sketchPlan(t, model, seed) {
  let tokens = 0, calls = 0;
  const code = {};
  for (const [i, fn] of t.functions.entries()) {
    const r = await sketchFn(t, fn, model, seed + i);
    code[fn] = r.code; tokens += r.tokens; calls++;
  }
  const sketchOf = () => t.functions.map((fn) => code[fn]).join('\n\n');
  let d = await describe(full(t, sketchOf()), { canonical: true });
  let gaps = t.functions.flatMap((fn) => gapsOf(fn, d));
  const gapsByRound = [gaps.length];
  for (let round = 1; round <= ROUNDS && gaps.length; round++) {
    for (const [i, fn] of t.functions.entries()) {
      const own = gaps.filter((g) => g.fn === fn);
      if (!own.length) continue;
      const r = await sketchFn(t, fn, model, seed + round * 1000 + i, { code: code[fn], gaps: own });
      code[fn] = r.code; tokens += r.tokens; calls++;
    }
    d = await describe(full(t, sketchOf()), { canonical: true });
    gaps = t.functions.flatMap((fn) => gapsOf(fn, d));
    gapsByRound.push(gaps.length);
  }
  const plan = Object.fromEntries(t.functions.map((fn) => [fn, d[fn]?.sentences ?? []]));
  return { sketch: sketchOf(), plan, gaps, gapsByRound, rounds: gapsByRound.length - 1, tokens, calls };
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
      model, method: 'one prefilled sketch per function -> hardened Smith canonical; per-function gaps fed back up to 2 rounds; T=0.7 seeds 200-204', samples: n,
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

const FILL_SYSTEM = 'You fill the body of one Trace stub. The signature is already written and locked. The plan is Smith English, one sentence per statement, in order.';
const FILL_EXAMPLE = "Example.\nStub: function dueLabel(loan: Loan): string\nPlan:\n  If loan's renewed, return 'Renewed'.\n  It returns 'Renew'.\nFunction:\n```ts\nfunction dueLabel(loan: Loan): string {\n  if (loan.renewed) {\n    return 'Renewed';\n  }\n  return 'Renew';\n}\n```";

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
        // Prefilled fill: the 1.5b writes only this body (lib/fill.mjs).
        const c = await fillBody({ signature: sigOf(t, fn).replace(/^export /, ''), plan: lines, seed: 800 + r * 10 + k, system: FILL_SYSTEM, example: FILL_EXAMPLE });
        calls++; tokens += c.tokens;
        const sp = replaceBody(t.stub, fn, c.body);
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
