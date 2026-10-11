// cs2 (scaffold) -- a miss collector that answers fixed records, for callers that test against the contract.

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
