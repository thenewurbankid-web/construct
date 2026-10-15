// K1, K2, K5 (#942): the kill-tests that need Smith (atomic-codemod linked). Called by run.mjs.
import { TASKS, PLAN_EXAMPLES, TEMPLATES } from './tasks.mjs';
import { smithOf, smithReady, matchPlan, planSentence, norm, isUnhandled } from './lib/smith.mjs';
import { smithLinks } from '../../../../packages/summarize/links.mjs';

const smithAt = () => ({ smithHead: smithLinks().codemod.head, smithRaw: process.env.CHAIN_SMITH_RAW === '1' });
import { tscGate, unitCheck } from './lib/gates.mjs';
import { chat, embed, cosine, MODELS } from './lib/ollama.mjs';
import { replaceBody, stubProblems } from '../../../../packages/engine/line/path/stubs.mjs';
import { planSchemaFor, planRequestUser, renderLine } from './lib/plan-lines.mjs';
import { fillBody } from './lib/fill.mjs';

const full = (t, src) => `${t.prelude ?? ''}${src}`;
const pct = (a, b) => Math.round((100 * a) / Math.max(b, 1));

/** Best cosine of each unmatched plan sentence against the unmatched code sentences (what a cosine fallback would see). */
async function fallbackScores(plan, smith) {
  const out = [];
  for (const [fn, lines] of Object.entries(plan)) {
    const want = lines.map((l) => norm(planSentence(l)));
    const got = (smith[fn] ?? []).map(norm);
    const missing = want.filter((w) => !got.includes(w));
    const extra = got.filter((g) => !want.includes(g));
    if (!missing.length || !extra.length) continue;
    const vecs = await embed([...missing, ...extra].map((s) => `search_query: ${s}`));
    for (let i = 0; i < missing.length; i++) {
      const best = Math.max(...extra.map((_, j) => cosine(vecs[i], vecs[missing.length + j])));
      out.push({ fn, plan: missing[i], best: +best.toFixed(4) });
    }
  }
  return out;
}

async function k1({ write }) {
  const rows = [];
  for (const t of TASKS) {
    const ref = await smithOf(full(t, t.reference));
    const refMatch = matchPlan(t.plan, ref);
    const mutants = [];
    for (const [i, m] of t.mutants.entries()) {
      const sm = await smithOf(full(t, m));
      const mm = matchPlan(t.plan, sm);
      mutants.push({ i: i + 1, unit: await unitCheck(full(t, m), t.check), score: +mm.score.toFixed(3), gaps: mm.gaps, smith: sm, fallback: await fallbackScores(t.plan, sm) });
    }
    rows.push({
      task: t.id, referenceUnit: await unitCheck(full(t, t.reference), t.check), referenceScore: +refMatch.score.toFixed(3), referenceGaps: refMatch.gaps, referenceSmith: ref,
      mutants, separated: mutants.every((m) => m.score < refMatch.score),
    });
  }
  const cos = rows.flatMap((r) => r.mutants.flatMap((m) => m.fallback.map((f) => f.best)));
  const summary = {
    method: 'exact template match (plan line -> summarize sentence form, normalized)', tasks: rows.length,
    referenceFullMatch: rows.filter((r) => r.referenceScore === 1).length, mutantsSeparated: `${rows.reduce((a, r) => a + r.mutants.filter((m) => m.score < r.referenceScore).length, 0)}/${rows.length * 2}`,
    maxMutantFallbackCosine: cos.length ? Math.max(...cos) : null,
    note: 'A cosine fallback must sit above maxMutantFallbackCosine or it lets a mutant step count as matched.',
  };
  Object.assign(summary, smithAt(), { unhandledSentences: rows.reduce((a, r) => a + Object.values(r.referenceSmith).flat().filter(isUnhandled).length + r.mutants.reduce((b, m) => b + Object.values(m.smith).flat().filter(isUnhandled).length, 0), 0) });
  summary.verdict = rows.every((r) => r.separated) ? 'pass' : 'kill';
  write('k1', { summary, rows });
  console.log('K1', JSON.stringify(summary));
}

// The plan writer: one function per request (only its signature in the prompt), every line one Smith template
// (an enum) with its slots, forced through `format` and rendered by lib/plan-lines.mjs.
export const PLAN_SYSTEM = [
  'You write the Trace test plan for one stub function: one line per statement of its body, in order.',
  'Each line picks one Smith template and fills its slots:',
  ...TEMPLATES.map((x) => `- ${x}`),
  'Use the input names of the signature. Answer with JSON only.',
].join('\n');

export async function writePlanFor(t, fn, seed, chatImpl = chat) {
  const r = await chatImpl({ system: PLAN_SYSTEM, user: planRequestUser(t, fn, PLAN_EXAMPLES), format: planSchemaFor(), options: { temperature: 0.7, seed } });
  const lines = (r.json?.lines ?? []).map(renderLine).filter(Boolean);
  return { lines, tokens: r.promptTokens + r.evalTokens, ms: r.ms };
}

export async function writePlan(t, seed, chatImpl = chat, fns = t.functions) {
  const plan = {};
  let tokens = 0, ms = 0;
  for (const [i, fn] of fns.entries()) {
    const p = await writePlanFor(t, fn, seed * 10 + i, chatImpl);
    plan[fn] = p.lines; tokens += p.tokens; ms += p.ms;
  }
  return { plan, tokens, ms };
}

/** Model plan vs reference plan, both in sentence form. */
const planVsRef = (t, plan) => matchPlan(t.plan, Object.fromEntries(Object.entries(plan).map(([f, ls]) => [f, ls.map(planSentence)])));

async function k2({ write }) {
  const rows = [];
  for (const t of TASKS) {
    for (let s = 0; s < 5; s++) {
      const p = await writePlan(t, 100 + s);
      const m = planVsRef(t, p.plan);
      rows.push({ task: t.id, sample: s, plan: p.plan, score: +m.score.toFixed(3), matched: m.matched, planN: m.planN, gaps: m.gaps, tokens: p.tokens, ms: p.ms });
    }
  }
  const mean = rows.reduce((a, r) => a + r.score, 0) / rows.length;
  const perTask = Object.fromEntries(TASKS.map((t) => [t.id, Math.round((100 * rows.filter((r) => r.task === t.id).reduce((a, r) => a + r.score, 0)) / 5)]));
  const summary = { model: MODELS.coder, method: 'ollama format {plans:[{function, lines}]}, T=0.7, seeds 100-104', samples: rows.length, matchPct: Math.round(100 * mean), perTask, fullMatchSamples: rows.filter((r) => r.score === 1).length, killBelow: 50 };
  summary.verdict = summary.matchPct >= 50 ? 'pass' : 'kill';
  write('k2', { summary, rows });
  console.log('K2', JSON.stringify(summary));
}

async function k5({ write }) {
  const t = TASKS.find((x) => x.id === 'availability');
  const fn = 'formatAvailability';
  const signature = t.stub.split('\n')[0].replace(/^export /, '').replace(/\s*\{$/, '');
  const runs = [];
  for (let r = 0; r < 5; r++) {
    const p = await writePlan(t, 500 + r, chat, [fn]);
    const lines = p.plan[fn] ?? [];
    let tokens = p.tokens, calls = 1, chosen = null;
    const tries = [];
    for (let k = 0; k < 5 && !chosen; k++) {
      // The fill: signature prefilled, stopped at the function's closing brace (lib/fill.mjs).
      const c = await fillBody({ signature, plan: lines, seed: 600 + r * 10 + k });
      calls++; tokens += c.tokens;
      const sp = replaceBody(t.stub, fn, c.body);
      if (!sp.ok) { tries.push({ k, splice: sp.code }); continue; }
      const diags = tscGate(full(t, sp.source));
      const stubs = stubProblems(sp.source, fn).map((x) => x.code);
      tries.push({ k, tsc: diags.length, stub: stubs });
      if (!diags.length && !stubs.length) chosen = sp.source;
    }
    let smithPlan = null, smithRef = null, unit = false, smith = null;
    if (chosen) {
      smith = await smithOf(chosen);
      smithPlan = matchPlan({ [fn]: lines }, smith);
      smithRef = matchPlan(t.plan, smith);
      unit = await unitCheck(chosen, t.check);
    }
    const pass = !!chosen && smithPlan?.score === 1;
    runs.push({ run: r, plan: lines, planVsRef: +planVsRef(t, p.plan).score.toFixed(3), tries, code: chosen, smith, smithVsPlan: smithPlan && +smithPlan.score.toFixed(3), smithVsRef: smithRef && +smithRef.score.toFixed(3), unit, pass, passAndUnit: pass && unit, calls, tokens });
  }
  const summary = {
    model: MODELS.coder, runs: runs.length, pass: runs.filter((x) => x.pass).length, passAndUnit: runs.filter((x) => x.passAndUnit).length,
    unitOnly: runs.filter((x) => x.unit).length, tscPassed: runs.filter((x) => x.code).length,
    rule: 'pass = a tsc-clean, stub-clean body (best of 5) whose Smith English matches the model\'s own plan exactly',
  };
  Object.assign(summary, smithAt(), { unhandledSentences: runs.reduce((a, x) => a + (x.smith ? Object.values(x.smith).flat().filter(isUnhandled).length : 0), 0) });
  summary.verdict = summary.pass > 0 ? 'pass' : 'kill';
  write('k5', { summary, runs });
  console.log('K5', JSON.stringify(summary));
}

import { k2b, k5b } from './k2b.mjs';
import { runK6 } from './k6.mjs';

async function k6({ write }) {
  const r = await runK6();
  write('k6', r);
  console.log('K6', JSON.stringify(r.summary));
}

const TESTS = { k1, k2, k5, k2b, k5b, k6 };
export async function run(name, ctx) {
  if (!TESTS[name]) throw new Error(`Unknown test ${name}; use k1, k2, k5, k2b, k5b or k6.`);
  if (!smithReady()) throw new Error('atomic-codemod is not linked (smithLinks().codemod.ok is false): set ATOMIC_CODEMOD_SOURCE_DIR and SMITH_SOURCE_DIR.');
  await TESTS[name](ctx);
}
