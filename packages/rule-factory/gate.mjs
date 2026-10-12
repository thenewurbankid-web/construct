// cs2 -- the accuracy gate. A proposal ships only when, measured with the proposal loaded on top of the shipped static
// rules (a worker process with LINE_STATIC_OVERLAY, gate-worker.mjs):
//   1. a held-out score rises: Train Line's held-out worlds (recall, precision, preferred), the drafter eval's held-out
//      cases (the held-out project and the held-out paraphrases: recall, precision, preferred), or, for a fix-rank
//      proposal, its held-out fix choices (the right fix ranked first);
//   2. nothing breaks: no case of either eval (any split) that passed before fails now (its preferred route, labels or
//      defer verdict lost, or its recall fell), no held-out score falls, and the drafter eval's pinned floors hold;
//   3. its own test passes: at least one of the Train cases it came from is now drafted right and none got worse (a
//      lexicon proposal), or the right fix now ranks first on its fix choices (a fix-rank proposal).
// The proposals that pass are then measured together once (a pair can interact); the report says so when together
// they break something. Scoring is injected (`score`), so the gate's logic is tested without drafting.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { assertGateReport } from './contract.mjs';
import { overlayOf } from './propose.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EPS = 1e-9;
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const round = (x) => (x === null ? null : Math.round(x * 1000) / 1000);

/**
 * @typedef {{id: string, recall: number, precision: number, preferred: number, heldOut?: boolean, labels?: number, deferOk?: number}} CaseScore
 * @typedef {{drafter: CaseScore[], train: CaseScore[], own: {id: string, preferred: number}[]}} Scored
 * @typedef {(overlay: import('@line/construct-engine/line/static-overlay').StaticOverlay|null, own: string[]) => Promise<Scored>} Scorer
 */

/** The drafter eval's floors (test/line-drafter-eval.test.mjs pins them; raise only). */
export const DRAFTER_FLOORS = Object.freeze({ precision: 0.958, preferred: 0.927 });

/**
 * The held-out scores of one measurement.
 * @param {Scored} s
 * @returns {import('./contract.mjs').GateScores}
 */
export function heldOutScores(s) {
  const agg = (cs) => ({ n: cs.length, recall: round(mean(cs.map((c) => c.recall))), precision: round(mean(cs.map((c) => c.precision))), preferred: round(mean(cs.map((c) => c.preferred))) });
  return { train: agg(s.train), drafter: agg(s.drafter.filter((c) => c.heldOut)) };
}

/** Cases that passed in `base` and fail in `next` (preferred route, labels or defer lost, or recall fell). */
export function regressionsOf(base, next) {
  const out = [];
  for (const [k, list] of /** @type {const} */ ([['drafter', 'drafter'], ['train', 'train']])) {
    const before = new Map(base[k].map((c) => [c.id, c]));
    for (const c of next[list]) {
      const b = before.get(c.id);
      const lost = (m) => b[m] === 1 && c[m] !== undefined && c[m] !== 1;
      if (b && (lost('preferred') || lost('labels') || lost('deferOk') || c.recall < b.recall - EPS)) out.push(`${k}:${c.id}`);
    }
  }
  return out;
}

/** The share of fix items whose right fix the rules rank first. */
function fixScore(items, rerank, rule) {
  if (!items.length) return null;
  return mean(items.map((it) => (rerank(rule, it.options.map((id) => ({ id })))[0]?.id === it.correct ? 1 : 0)));
}

/**
 * Gate the proposals.
 * @param {import('./contract.mjs').RuleProposal[]} proposals
 * @param {{score: Scorer, at?: string, rerank?: (rule: string, fixes: {id: string}[], rules?: any[]) => {id: string}[], onProgress?: (sentence: string) => void}} o
 *   `rerank`: fixRanking.mjs rerankFixes (for fix-rank proposals).
 * @returns {Promise<import('./contract.mjs').GateReport>}
 */
export async function gateProposals(proposals, o) {
  const say = o.onProgress ?? (() => {});
  const ownIds = [...new Set(proposals.flatMap((p) => (p.test.kind === 'train-cases' ? p.test.caseIds : [])))];
  say(`Measuring the shipped rules (baseline, ${proposals.length} proposal${proposals.length === 1 ? '' : 's'} to gate).`);
  const base = await o.score(null, ownIds);
  const baseline = heldOutScores(base);
  const baseOwn = new Map(base.own.map((c) => [c.id, c.preferred]));
  const baseAll = heldOutScoresAll(base);
  /** @type {import('./contract.mjs').GateResult[]} */
  const results = [];
  for (const p of proposals) {
    say(`Measuring ${p.id}: ${p.sentence}`);
    const own = p.test.kind === 'train-cases' ? p.test.caseIds : [];
    const next = await o.score(overlayOf([p]), own);
    const withS = heldOutScores(next);
    const improved = [];
    const fell = [];
    for (const k of /** @type {const} */ (['train', 'drafter'])) {
      for (const m of /** @type {const} */ (['recall', 'precision', 'preferred'])) {
        if (withS[k][m] === null || baseline[k][m] === null) continue;
        if (withS[k][m] > baseline[k][m] + EPS) improved.push(`${k} ${m}`);
        if (withS[k][m] < baseline[k][m] - EPS) fell.push(`${k} ${m} fell`);
      }
    }
    let ownTest;
    if (p.test.kind === 'fix-items') {
      const rerank = o.rerank;
      const train = p.test.items.filter((x) => !x.heldOut); const held = p.test.items.filter((x) => x.heldOut);
      const before = (items) => fixScore(items, (_r, f) => f, p.change.rule);
      const after = (items) => fixScore(items, (r, f) => (rerank ? rerank(r, f, [p.change]) : f), p.change.rule);
      const own2 = train.length ? train : held;
      const ok = Boolean(rerank) && (after(own2) ?? 0) > (before(own2) ?? 0) + EPS;
      ownTest = { ok, sentence: ok ? `The right fix now ranks first on ${Math.round((after(own2) ?? 0) * 100)}% of its fix choices.` : 'The right fix does not rank first more often with this rule.' };
      if (held.length && (after(held) ?? 0) > (before(held) ?? 0) + EPS) improved.push('fix choices');
    } else {
      const now = next.own.filter((c) => own.includes(c.id));
      const fixed = now.filter((c) => c.preferred === 1 && baseOwn.get(c.id) !== 1).length;
      const worse = now.filter((c) => c.preferred !== 1 && baseOwn.get(c.id) === 1).length;
      const ok = fixed > 0 && worse === 0;
      ownTest = { ok, sentence: ok ? `${fixed} of its ${own.length} own case${own.length === 1 ? ' is' : 's are'} now drafted right.` : `None of its ${own.length} own case${own.length === 1 ? ' is' : 's are'} drafted right with it.` };
    }
    const regressions = regressionsOf(base, next);
    const all = heldOutScoresAll(next);
    const floors = [...fell, ...Object.entries(DRAFTER_FLOORS).filter(([m, f]) => baseAll[m] !== null && baseAll[m] >= f - EPS && all[m] !== null && all[m] < f - EPS).map(([m]) => `drafter floor ${m} not held`)];
    const pass = improved.length > 0 && regressions.length === 0 && floors.length === 0 && ownTest.ok;
    const why = [
      improved.length ? `${improved.join(', ')} rose` : 'no held-out score rose',
      regressions.length ? `${regressions.length} case${regressions.length === 1 ? '' : 's'} that passed now fail${regressions.length === 1 ? 's' : ''}` : null,
      floors.length ? floors.join(', ') : null,
      ownTest.ok ? null : 'its own test fails',
    ].filter(Boolean).join('; ');
    results.push({ proposalId: p.id, pass, with: withS, improved, regressions: [...regressions, ...floors], ownTest, sentence: `${pass ? 'Passes' : 'Held back'}: ${why}.` });
  }
  const passed = results.filter((r) => r.pass).map((r) => r.proposalId);
  let together = null;
  if (passed.length > 1) {
    say(`Measuring the ${passed.length} passing proposals together.`);
    const next = await o.score(overlayOf(proposals.filter((p) => passed.includes(p.id))), []);
    const regressions = regressionsOf(base, next);
    together = { ids: passed, with: heldOutScores(next), regressions, ok: regressions.length === 0 };
  }
  const sentence = `${passed.length} of ${proposals.length} proposal${proposals.length === 1 ? '' : 's'} passed the gate${together && !together.ok ? ', but together they break something: apply them one at a time' : ''}.`;
  return assertGateReport({ at: o.at ?? new Date().toISOString(), baseline, results, together, passed, sentence });
}

/** The drafter eval over every case (for its floors). */
function heldOutScoresAll(s) {
  return { recall: round(mean(s.drafter.map((c) => c.recall))), precision: round(mean(s.drafter.map((c) => c.precision))), preferred: round(mean(s.drafter.map((c) => c.preferred))) };
}

/**
 * The real scorer: one gate-worker process per measurement (the overlay in a temp file named by LINE_STATIC_OVERLAY).
 * @param {{checkout: string, onlyTrain?: number, onlyDrafter?: number, env?: Record<string, string|undefined>}} o
 * @returns {Scorer}
 */
export function workerScorer(o) {
  return (overlay, own) => new Promise((resolve, reject) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'line-rule-overlay-'));
    const file = path.join(dir, 'overlay.json');
    const env = { ...(o.env ?? process.env) };
    delete env.LINE_STATIC_OVERLAY;
    if (overlay) { fs.writeFileSync(file, JSON.stringify(overlay)); env.LINE_STATIC_OVERLAY = file; }
    const args = [path.join(HERE, 'gate-worker.mjs'), '--checkout', o.checkout, ...(own.length ? ['--own', own.join(',')] : []),
      ...(o.onlyTrain ? ['--only-train', String(o.onlyTrain)] : []), ...(o.onlyDrafter ? ['--only-drafter', String(o.onlyDrafter)] : [])];
    const child = spawn(process.execPath, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = ''; let err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('close', (code) => {
      fs.rmSync(dir, { recursive: true, force: true });
      const line = out.trim().split('\n').at(-1) ?? '';
      try {
        const r = JSON.parse(line);
        if (code === 0 && r.ok) { resolve(r); return; }
      } catch { /* reported below */ }
      reject(new Error(`The gate's measurement stopped (${err.trim().split('\n').at(-1) || `exit ${code}`}).`));
    });
  });
}
