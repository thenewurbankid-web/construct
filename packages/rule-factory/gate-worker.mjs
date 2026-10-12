#!/usr/bin/env node
// cs2 -- the accuracy gate's worker: one process per measurement, so the static rules load once with the proposal's
// overlay merged on top (LINE_STATIC_OVERLAY, read by the drafter's lexicon and the fix ranking at import) and nothing
// is written to a rule file. It scores, per case:
//   - the drafter's eval corpus (packages/engine/line/drafter/eval/corpus.json), its projects copied to a temp folder
//     first (outside any git work tree, so Line's checks spawn no git process),
//   - Train Line's held-out cases (worlds w30-w39), retrieval reading the train split only,
//   - the proposals' own Train cases (`--own`), retrieval reading the other worlds' train cases only.
// Prints one JSON object. Usage: node gate-worker.mjs --checkout <construct> [--own id,id] [--only-train n] [--only-drafter n]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runEval, DEFAULT_CORPUS } from '@line/construct-engine/line/drafter/eval';
import { evaluateAll } from '@line/construct-engine/line/train/service';
import { readTrainCases, draftTrainSplit } from './drafter-misses.mjs';

const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const checkout = path.resolve(opt('--checkout') ?? '.');
const own = (opt('--own') ?? '').split(',').filter(Boolean);
const cap = (n) => (opt(n) ? Number(opt(n)) : Infinity);

const corpus = JSON.parse(fs.readFileSync(DEFAULT_CORPUS, 'utf8'));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'line-rule-gate-'));
try {
  for (const p of Object.values(corpus.projects)) fs.cpSync(path.join(checkout, /** @type {any} */ (p).dir), path.join(tmp, /** @type {any} */ (p).dir), { recursive: true });
  const dCases = corpus.cases.slice(0, cap('--only-drafter'));
  const drafter = runEval({ ...corpus, cases: dCases }, { repoRoot: tmp }).results.map((r) => ({
    id: r.id, heldOut: r.split === 'heldout' || r.heldOut, recall: r.recall, precision: r.precision, preferred: r.preferredOk ? 1 : 0,
    labels: r.intentOk && r.layersOk && r.targetOk ? 1 : 0, deferOk: r.deferOk ? 1 : 0,
  }));
  const cases = readTrainCases(checkout);
  const heldIds = new Set(cases.filter((c) => c.split === 'heldout' && c.status !== 'disputed').slice(0, cap('--only-train')).map((c) => c.id));
  const train = evaluateAll(cases.filter((c) => c.split !== 'heldout' || heldIds.has(c.id)), 'gate').cases
    .map((e) => ({ id: e.id, recall: e.recall, precision: e.precision, preferred: e.preferred }));
  const mine = own.length ? draftTrainSplit(cases, { only: (c) => own.includes(c.id) }).map((r) => ({ id: r.caseId, preferred: r.preferred ? 1 : 0, words: r.words })) : [];
  process.stdout.write(`${JSON.stringify({ ok: true, overlay: Boolean(process.env.LINE_STATIC_OVERLAY), drafter, train, own: mine })}\n`);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
