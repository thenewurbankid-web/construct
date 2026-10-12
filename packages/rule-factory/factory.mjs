// cs2 -- the static rule factory end to end, behind `construct line rules propose|gate|apply --dir <project>`:
//
//   propose  collect misses (plan feedback, validate findings, decision traces, the reason ledger, and the drafter on
//            Train Line's train split from the Construct checkout), label them (jev, else the rules, plus any filled
//            labelling JSONL), and turn the labels into rule proposals. Writes line/rules/proposals.json and
//            line/rules/labelling.jsonl in the project's Line state folder (through the writer's Line-state path).
//   gate     measure every proposal on the held-out evals (gate.mjs); writes line/rules/gate.json.
//   apply    a person applies what passed, through Construct's writer, to the Construct checkout's rule files.
// Every step works without jev, Ollama or a linked @mx/reason, and says when it fell back.
import fs from 'node:fs';
import path from 'node:path';
import { writeLineState } from '@line/construct-engine/transactional-writer';
import { LEXICON } from '@line/construct-engine/line/drafter/lexicon';
import { rerankFixes } from '@line/construct-engine/line/fix-ranking';
import { FACTORY_FILES } from './contract.mjs';
import { missesFromFindings, readPlanMisses, readTraceMisses, readLedgerMisses, missesFromDrafts, staticShare } from './collect.mjs';
import { readTrainCases, draftTrainSplit } from './drafter-misses.mjs';
import { labelItemsOf, labelWithJev, labellingJsonl, importLabelling } from './label.mjs';
import { proposeRules } from './propose.mjs';
import { gateProposals, workerScorer } from './gate.mjs';
import { choose, applyProposals, CHECKOUT } from './apply.mjs';

const readJson = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };

/**
 * Validate's Line findings for a project, with typed fixes; none (and a sentence) when validate cannot run.
 * @param {string} root
 * @returns {Promise<{findings: any[], note: string|null}>}
 */
async function findingsOf(root) {
  try {
    const { lineFindings } = await import('@line/construct-engine/line/model');
    return { findings: lineFindings(root), note: null };
  } catch (e) {
    return { findings: [], note: `Validate could not run (${String(/** @type {any} */ (e)?.message ?? e).split('\n')[0]}), so its findings are not counted.` };
  }
}

/**
 * propose: collect, label, propose; writes the factory's files into the project's Line state folder.
 * @param {{root: string, checkout?: string, ledger?: string, limit?: number, drafter?: boolean, jev?: boolean, labels?: string, decide?: any, stateDir?: any}} o
 * @returns {Promise<{records: number, misses: number, bySource: Record<string, {total: number, misses: number}>, shares: any[], labelling: any, proposals: any[], skipped: any[], notes: string[], files: string[]}>}
 */
export async function propose(o) {
  const checkout = o.checkout ?? CHECKOUT;
  const notes = [];
  const plan = readPlanMisses(o.root);
  const f = await findingsOf(o.root);
  if (f.note) notes.push(f.note);
  const traces = await readTraceMisses(o.root, o.stateDir ? { stateDir: o.stateDir } : {});
  if (traces.note) notes.push(traces.note);
  const ledgerDir = o.ledger ?? path.join(o.root, 'line', 'reasoning');
  const ledger = readLedgerMisses(ledgerDir);
  if (ledger.skipped) notes.push(`${ledger.skipped} reason-ledger file${ledger.skipped === 1 ? ' was' : 's were'} unreadable and skipped.`);
  let drafts = [];
  if (o.drafter !== false) {
    const cases = readTrainCases(checkout);
    if (!cases.length) notes.push('Train Line has no cases in this checkout, so the drafter\'s misses are not collected.');
    else drafts = draftTrainSplit(cases, { limit: o.limit });
  }
  const records = [...plan, ...missesFromFindings(f.findings), ...traces.records, ...ledger.records, ...missesFromDrafts(drafts)];
  const bySource = {};
  for (const r of records) { const s = bySource[r.source] ?? { total: 0, misses: 0 }; s.total += 1; s.misses += r.miss ? 1 : 0; bySource[r.source] = s; }
  let items = labelItemsOf(records);
  // A filled labelling file (a person or Claude, offline) is read first: its answers stand over jev's and the rules'.
  const labelsFile = o.labels ?? path.join(o.root, FACTORY_FILES.labelling);
  let imported = { imported: 0, refused: /** @type {any[]} */ ([]) };
  if (fs.existsSync(labelsFile)) { const r = importLabelling(fs.readFileSync(labelsFile, 'utf8'), items); items = r.items; imported = r; }
  const labelling = await labelWithJev(items, o.jev === false ? { off: 'it was turned off for this run with --no-jev' } : o.decide ? { decide: o.decide } : {});
  const { proposals, skipped } = proposeRules(labelling.items, { lexicon: LEXICON });
  const at = new Date().toISOString();
  const files = [
    writeLineState(o.root, FACTORY_FILES.proposals, `${JSON.stringify({ at, checkout: path.relative(o.root, checkout) || '.', bySource, shares: staticShare(records), labelling: { ...labelling, items: undefined, imported: imported.imported, refused: imported.refused }, items: labelling.items, proposals, skipped }, null, 2)}\n`),
    writeLineState(o.root, FACTORY_FILES.labelling, labellingJsonl(labelling.items)),
  ];
  for (const r of imported.refused) notes.push(r.sentence);
  return { records: records.length, misses: records.filter((r) => r.miss).length, bySource, shares: staticShare(records), labelling: { ...labelling, items: undefined, imported: imported.imported }, proposals, skipped, notes, files };
}

/**
 * gate: measure the last proposals; writes line/rules/gate.json.
 * @param {{root: string, checkout?: string, score?: any, onProgress?: (s: string) => void, onlyTrain?: number, onlyDrafter?: number}} o
 * @returns {Promise<{report: import('./contract.mjs').GateReport|null, sentence: string, file: string|null}>}
 */
export async function gate(o) {
  const doc = readJson(path.join(o.root, FACTORY_FILES.proposals));
  if (!doc) return { report: null, file: null, sentence: 'There are no proposals yet; run `construct line rules propose` first.' };
  const checkout = o.checkout ?? CHECKOUT;
  const report = await gateProposals(doc.proposals, { score: o.score ?? workerScorer({ checkout, onlyTrain: o.onlyTrain, onlyDrafter: o.onlyDrafter }), rerank: rerankFixes, onProgress: o.onProgress });
  const file = writeLineState(o.root, FACTORY_FILES.gate, `${JSON.stringify(report, null, 2)}\n`);
  return { report, file, sentence: report.sentence };
}

/**
 * apply: a person applies what passed (or the `ids` they name) to the checkout's rule files, through the writer.
 * @param {{root: string, checkout?: string, ids?: string[], by?: string}} o
 * @returns {{ok: boolean, sentence: string, files: string[]}}
 */
export function apply(o) {
  const doc = readJson(path.join(o.root, FACTORY_FILES.proposals));
  const report = readJson(path.join(o.root, FACTORY_FILES.gate));
  const c = choose(doc?.proposals ?? [], report, o.ids);
  if (!c.ok) return { ok: false, sentence: c.sentence, files: [] };
  const r = applyProposals(c.chosen, { checkout: o.checkout ?? CHECKOUT, by: o.by });
  return { ok: r.committed, sentence: r.sentence, files: r.files };
}
