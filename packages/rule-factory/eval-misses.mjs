// im1 -- the eval sources of the miss report: Train Line's held-out eval (gold routes by Claude, verified by Construct)
// and the drafter eval (its gold corpus). Both score the REAL drafter and say, per case, what was offered, what was
// recommended and which gold routes were found; misses.mjs classifies them. Running both takes about 30 seconds.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { missesFromEvalCase } from './misses.mjs';

/**
 * Classified misses of a finished Train Line eval (`{cases}` as evaluateAll or the store's last eval keeps them).
 * @param {{cases: any[]} | null | undefined} result
 * @returns {import('./contract.mjs').ClassifiedMiss[]}
 */
export function trainMisses(result) {
  return (result?.cases ?? []).flatMap((e) => missesFromEvalCase('train', e));
}

/**
 * Classified misses of a drafter eval report (drafter/eval.mjs runEval).
 * @param {{results: any[]} | null | undefined} rep
 * @returns {import('./contract.mjs').ClassifiedMiss[]}
 */
export function drafterMisses(rep) {
  return (rep?.results ?? []).flatMap((r) => missesFromEvalCase('drafter-eval', r));
}

/**
 * Run both evals now (nothing is written) and classify their misses.
 * @param {{trainRoot?: string, train?: boolean, drafter?: boolean}} [o] `trainRoot`: where Train Line's cases live
 *   (default: the repo's line/ folder).
 * @returns {Promise<{train: import('./contract.mjs').ClassifiedMiss[], drafter: import('./contract.mjs').ClassifiedMiss[], numbers: {train: any, drafter: any}}>}
 */
export async function runEvalMisses(o = {}) {
  const out = { train: [], drafter: [], numbers: { train: null, drafter: null } };
  if (o.drafter !== false) {
    const { runEval, DEFAULT_CORPUS } = await import('@line/construct-engine/line/drafter/eval');
    const rep = runEval(JSON.parse(fs.readFileSync(DEFAULT_CORPUS, 'utf8')));
    out.drafter = drafterMisses(rep);
    out.numbers.drafter = { n: rep.overall.n, recall: rep.overall.recall, precision: rep.overall.precision, preferred: rep.overall.preferredOk };
  }
  if (o.train !== false) {
    const { evaluateAll } = await import('@line/construct-engine/line/train/service');
    const { recordsFromTraining, memoOf, INDEX } = await import('@line/construct-engine/line/train/records');
    const { DEFAULT_TRAIN_ROOT, CASES } = await import('@line/construct-engine/line/train/store');
    const root = o.trainRoot ?? DEFAULT_TRAIN_ROOT;
    const cases = fs.readFileSync(path.join(root, CASES), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    let memo = new Map();
    try { memo = memoOf(fs.readFileSync(path.join(root, INDEX), 'utf8')); } catch { /* built on the fly */ }
    const result = evaluateAll(cases, new Date().toISOString(), { records: recordsFromTraining(cases, { memo }) });
    out.train = trainMisses(result);
    const avg = (k) => Math.round((result.cases.reduce((a, e) => a + e[k], 0) / Math.max(1, result.cases.length)) * 1000) / 1000;
    out.numbers.train = { n: result.cases.length, recall: avg('recall'), precision: avg('precision'), preferred: avg('preferred') };
  }
  return out;
}

/** Where the repo keeps the last eval miss snapshot (Settings shows it): `construct line misses --eval --save`. */
export const SNAPSHOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../line/rule-factory/eval-misses.json');

/**
 * The last eval miss snapshot, or null when there is none or it cannot be read.
 * @param {string} [file]
 * @returns {{at: string, numbers: any, misses: import('./contract.mjs').ClassifiedMiss[]} | null}
 */
export function readSnapshot(file = SNAPSHOT) {
  try { const s = JSON.parse(fs.readFileSync(file, 'utf8')); return Array.isArray(s?.misses) ? s : null; } catch { return null; }
}

/**
 * Keep the eval misses as the repo's snapshot (`construct line misses --eval --save`), for Settings' miss report.
 * @param {Awaited<ReturnType<typeof runEvalMisses>>} r
 * @param {string} [file]
 * @returns {string} The file written.
 */
export function writeSnapshot(r, file = SNAPSHOT) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify({ at: new Date().toISOString().slice(0, 10), numbers: r.numbers, misses: [...r.train, ...r.drafter] }, null, 1)}\n`);
  return file;
}
