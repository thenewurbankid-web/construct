// cs2 -- applying gated proposals: a person runs `construct line rules apply`; nothing else calls this. Only proposals
// the last gate report passed are applied (a subset with `ids`); several at once only when the gate measured them
// together without a regression. The rule files (the drafter's lexicon.json, fix-ranking.json) and the record of
// applied proposals (applied.json: each proposal with its own test case, re-checked by test/applied.test.mjs) are
// written through Construct's writer in one transaction, checked before anything lands.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTransaction } from '@line/construct-engine/transactional-writer';
import { mergeLexicon, assertLexicon } from '@line/construct-engine/line/drafter/lexicon';
import { assertFixRanking } from '@line/construct-engine/line/fix-ranking';
import { OBJECTS } from '@line/construct-engine/line/drafter/contract';
import { RULE_FILES } from './contract.mjs';
import { overlayOf } from './propose.mjs';

/** The record of applied proposals, relative to the Construct checkout. */
export const APPLIED_FILE = 'packages/rule-factory/applied.json';
/** The Construct checkout this package belongs to. */
export const CHECKOUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const read = (root, rel, fallback) => { try { return JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8')); } catch { return fallback; } };

/**
 * Which proposals may be applied, or why not.
 * @param {import('./contract.mjs').RuleProposal[]} proposals
 * @param {import('./contract.mjs').GateReport|null} report
 * @param {string[]} [ids] A subset (default: every proposal that passed).
 * @returns {{ok: true, chosen: import('./contract.mjs').RuleProposal[]}|{ok: false, sentence: string}}
 */
export function choose(proposals, report, ids) {
  if (!report) return { ok: false, sentence: 'There is no gate report yet; run `construct line rules gate` first.' };
  const want = ids?.length ? ids : report.passed;
  if (!want.length) return { ok: false, sentence: 'No proposal passed the gate, so there is nothing to apply.' };
  const notPassed = want.filter((id) => !report.passed.includes(id));
  if (notPassed.length) return { ok: false, sentence: `${notPassed.join(', ')} did not pass the gate, so ${notPassed.length === 1 ? 'it is' : 'they are'} not applied.` };
  const missing = want.filter((id) => !proposals.some((p) => p.id === id));
  if (missing.length) return { ok: false, sentence: `${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} not among the proposals the gate measured.` };
  if (want.length > 1 && !(report.together && report.together.ok && want.every((id) => report.together?.ids.includes(id)))) {
    return { ok: false, sentence: 'These proposals were not measured together without a regression; apply them one at a time with --id.' };
  }
  return { ok: true, chosen: proposals.filter((p) => want.includes(p.id)) };
}

/**
 * Apply the chosen proposals to the rule files through Construct's writer (one transaction, checked before it lands).
 * @param {import('./contract.mjs').RuleProposal[]} chosen
 * @param {{checkout?: string, at?: string, by?: string}} [o]
 * @returns {{committed: boolean, files: string[], sentence: string, violations: any[]}}
 */
export function applyProposals(chosen, o = {}) {
  const root = o.checkout ?? CHECKOUT;
  const overlay = overlayOf(chosen);
  const tx = createTransaction(root);
  const files = [];
  if (chosen.some((p) => p.target === 'lexicon')) {
    const lexicon = mergeLexicon(read(root, RULE_FILES.lexicon, null), overlay.lexicon);
    tx.writeFile(RULE_FILES.lexicon, `${JSON.stringify(lexicon, null, 1)}\n`);
    files.push(RULE_FILES.lexicon);
  }
  if (overlay.fixRanking?.length) {
    const doc = read(root, RULE_FILES['fix-ranking'], { rules: [] });
    for (const r of overlay.fixRanking) if (!doc.rules.some((x) => x.rule === r.rule && x.prefer === r.prefer && x.over === r.over)) doc.rules.push(r);
    tx.writeFile(RULE_FILES['fix-ranking'], `${JSON.stringify(doc, null, 2)}\n`);
    files.push(RULE_FILES['fix-ranking']);
  }
  const applied = read(root, APPLIED_FILE, { note: '', proposals: [] });
  for (const p of chosen) if (!applied.proposals.some((x) => x.id === p.id)) applied.proposals.push({ ...p, appliedAt: o.at ?? new Date().toISOString(), appliedBy: o.by ?? 'person' });
  tx.writeFile(APPLIED_FILE, `${JSON.stringify(applied, null, 2)}\n`);
  files.push(APPLIED_FILE);
  // The check before anything lands: every staged rule file parses and passes its own contract.
  const validate = (shadow) => {
    const violations = [];
    try {
      if (files.includes(RULE_FILES.lexicon)) assertLexicon(JSON.parse(fs.readFileSync(path.join(shadow, RULE_FILES.lexicon), 'utf8')), Object.keys(OBJECTS));
      if (files.includes(RULE_FILES['fix-ranking'])) assertFixRanking(JSON.parse(fs.readFileSync(path.join(shadow, RULE_FILES['fix-ranking']), 'utf8')).rules);
      JSON.parse(fs.readFileSync(path.join(shadow, APPLIED_FILE), 'utf8'));
    } catch (e) {
      violations.push({ rule: 'RULE-FACTORY', file: files[0], message: String(/** @type {any} */ (e)?.message ?? e).split('\n')[0] });
    }
    return { ok: violations.length === 0, violations };
  };
  const r = tx.commit({ validate });
  return {
    committed: r.committed, files, violations: r.violations,
    sentence: r.committed
      ? `Applied ${chosen.length} proposal${chosen.length === 1 ? '' : 's'} to ${files.filter((f) => f !== APPLIED_FILE).join(' and ')}; run the tests before you commit.`
      : `Nothing was applied: ${r.violations[0]?.message ?? 'the writer refused the change'}.`,
  };
}
