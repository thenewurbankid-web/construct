// cs2 -- mocks of the rule factory for callers that test against the contract: fixed miss records, label items, and a
// factory that answers fixed results and writes nothing.

/** Three plan decisions (two static, one a person's) and one validate finding static code cannot fix. */
export const MOCK_MISSES = Object.freeze([
  { id: 'plan:p1:s1', source: 'plan', step: 'line.baseOn', decidedBy: 'static', miss: false, staticChoice: 'pass', finalChoice: 'pass', sentence: 'Step 1 passed its checks.', ref: { file: 'line/plans/ses-cockpit.json', planId: 'p1', stepId: 's1' }, label: null },
  { id: 'plan:p1:s2', source: 'plan', step: 'line.baseOn', decidedBy: 'person', miss: true, staticChoice: null, finalChoice: 'leave', sentence: 'Step 2 needed the person, who left it as it is.', ref: { file: 'line/plans/ses-cockpit.json', planId: 'p1', stepId: 's2' }, label: null },
  { id: 'plan:p1:s3', source: 'plan', step: 'line.promote', decidedBy: 'static', miss: false, staticChoice: 'pass', finalChoice: 'pass', sentence: 'Step 3 passed its checks.', ref: { file: 'line/plans/ses-cockpit.json', planId: 'p1', stepId: 's3' }, label: null },
  { id: 'validate:LINE-BASE|features/a.tsx|1', source: 'validate', step: 'validate LINE-BASE', decidedBy: 'none', miss: true, staticChoice: null, finalChoice: null, sentence: 'Static code has no typed fix for this finding.', ref: { file: 'features/a.tsx', rule: 'LINE-BASE', line: 1 }, label: null },
]);

/** @param {import('./contract.mjs').MissRecord[]} [records] */
export function createMockMissCollector(records = /** @type {any} */ (MOCK_MISSES)) {
  return { collect: () => records.map((r) => ({ ...r, ref: { ...r.ref } })) };
}

/** Two labelled misses: a drafter word jev read as a verb, and a fix choice a person made differently. */
export const MOCK_LABEL_ITEMS = Object.freeze([
  { id: 'drafter:tc-1:attach', missId: 'drafter:tc-1', source: 'drafter', step: 'drafter add.component', kind: 'absent', question: 'In "<feature:F1> should attach a <library:L1>.", what does "attach" stand for?', options: ['verb:add', 'verb:remove', 'verb:promote', 'verb:update', 'verb:fix', 'grammar', 'catalog:component', 'none'], chosen: null, correct: 'verb:add', labelledBy: 'jev', rulesSaid: 'verb:add', facts: ['The request asks for add.component.'], about: { word: 'attach', caseId: 'tc-1', intent: 'add.component' } },
  { id: 'plan:p1:s3:fix', missId: 'plan:p1:s3:fix', source: 'plan', step: 'line.baseOn fix choice', kind: 'picked', question: 'Which option was right?', options: ['LINE-LAYOUT/stray-to-library:components', 'LINE-LAYOUT/stray-to-feature:orders:components', 'none'], chosen: 'LINE-LAYOUT/stray-to-library:components', correct: 'LINE-LAYOUT/stray-to-feature:orders:components', labelledBy: 'person', rulesSaid: 'LINE-LAYOUT/stray-to-feature:orders:components', facts: ['Step 3 applied a fix static code did not rank first.'], about: { rule: 'LINE-LAYOUT' } },
]);

/**
 * A factory that answers fixed results and writes nothing (Cockpit's and the CLI's own tests).
 * @returns {{propose: () => Promise<any>, gate: () => Promise<any>, apply: () => {ok: boolean, sentence: string, files: string[]}}}
 */
export function createMockFactory() {
  return {
    propose: async () => ({ records: 4, misses: 2, bySource: { plan: { total: 3, misses: 1 }, validate: { total: 1, misses: 1 } }, shares: [], labelling: { via: 'rules', sentence: 'jev was not available (mocked), so the rules labelled 0 of 0 misses and people 0.' }, proposals: [], skipped: [], notes: [], files: [] }),
    gate: async () => ({ report: null, file: null, sentence: 'There are no proposals yet; run `construct line rules propose` first.' }),
    apply: () => ({ ok: false, sentence: 'There is no gate report yet; run `construct line rules gate` first.', files: [] }),
  };
}
