// Train Line mock: the service's shape in memory, no disk, no scratch copies (for the contract tests and for building
// a client against). Same answers as the real service would give on the Line sample for its two fixed cases.
import { LineOpError } from '../contract.mjs';
import { INTENTS } from './contract.mjs';

const ROUTE = {
  id: 'inside', label: 'Inside <feature:F1> only', scope: { layers: ['components'], features: ['F1'], library: false },
  steps: [{ tool: 'line.baseOn', args: { libraryId: '<library:L1>', feature: '<feature:F1>', name: '<name:N1>' } }],
  expect: [{ hasItem: '<feature:F1>/components/<name:N1>' }, { noNewFindings: true }], cost: 1, risk: 'low', outcome: 'change',
};
const SLOTS = { F1: { type: 'feature', ref: 'feature#1' }, L1: { type: 'library', ref: 'library:components#0', kind: 'components' }, N1: { type: 'name', role: 'status', of: 'L1' } };
const baseCase = (id, labelledBy) => ({
  id, intent: 'add.component', request: 'Make <name:N1> in <feature:F1>, based on <library:L1>.', slots: SLOTS, world: { kind: 'sample' }, split: 'train',
  factsHash: 'mock', gold: { routes: [ROUTE], preferred: 'inside' }, labelledBy, status: labelledBy === 'owner' ? 'agreed' : 'draft', notes: [],
  sample: labelledBy === 'claude', verified: { routes: { inside: { ok: true, at: '2026-10-11T00:00:00.000Z' } } }, createdAt: '2026-10-11T00:00:00.000Z',
});
const FILLED_ROUTE = { id: 'inside', label: 'Inside orders only', touches: 'Touches components in orders.', steps: [{ tool: 'line.baseOn', args: { libraryId: 'components/Badge', feature: 'orders', name: 'StatusBadge' }, sentence: 'Make StatusBadge in orders, based on the library Badge.' }], checks: ['orders has a component StatusBadge.', 'Validate shows no new problems.'], cost: 1, risk: 'low', outcome: 'change', preferred: true };
const view = (c) => ({ ...c, filled: { request: 'Make StatusBadge in orders, based on Badge.', intentPhrase: INTENTS[0].phrase, routes: [FILLED_ROUTE], world: 'The Line sample project' } });

export function createMockTrainService() {
  const cases = [baseCase('tc-mock-claude', 'claude')];
  const log = [];
  return {
    log,
    worlds: () => ({ worlds: [{ key: 'sample', label: 'The Line sample project' }] }),
    cases: ({ filter = 'sample' } = {}) => {
      const list = cases.filter((c) => (filter === 'sample' ? c.sample : filter === 'mine' ? c.labelledBy === 'owner' : filter === 'claude' ? c.labelledBy === 'claude' : true));
      return { total: list.length, open: list.filter((c) => c.status === 'draft').length, cases: list.map(view) };
    },
    draft: ({ request }) => {
      if (!request || request.trim().length < 3) throw new LineOpError('Type what you want Line to do, in a sentence.', 'NO_REQUEST');
      return { request: 'Make <name:N1> in <feature:F1>, based on <library:L1>.', slots: SLOTS, intent: 'add.component', intentPhrase: INTENTS[0].phrase, via: 'template', confidence: 0.3, unknown: [], routes: [ROUTE], recommended: 'inside', world: 'sample', filled: { request: 'Make StatusBadge in orders, based on Badge.', routes: [{ ...FILLED_ROUTE, via: 'template', confidence: 0.3 }] } };
    },
    try: () => ({ ok: true, sentence: 'It works in a scratch copy: 2 of 2 checks pass.', steps: [{ sentence: 'Created StatusBadge.', ok: true }], checks: [{ sentence: 'orders has a component StatusBadge.', ok: true }, { sentence: 'Validate shows no new problems.', ok: true }] }),
    save: (input) => { const c = { ...baseCase(`tc-mock-${cases.length}`, 'owner'), intent: input.intent }; cases.push(c); log.push({ by: 'owner', action: 'save', caseId: c.id }); return { case: view(c) }; },
    review: ({ id, verdict, note }, by = 'owner') => {
      if (by !== 'owner') throw new LineOpError('Only the owner agrees or disagrees with a case.', 'NOT_OWNER');
      const c = cases.find((x) => x.id === id);
      if (!c) throw new LineOpError('That case is no longer there; reload the list.', 'UNKNOWN_CASE');
      c.status = verdict === 'agree' ? 'agreed' : 'disputed';
      if (verdict === 'disagree') c.notes.push({ by: 'owner', text: note || 'The owner disagrees.', at: '2026-10-11T00:00:00.000Z' });
      log.push({ by, action: verdict, caseId: id });
      return { case: view(c) };
    },
    scoreboard: () => {
      const agreed = cases.filter((c) => c.sample && c.status === 'agreed').length;
      const disagreed = cases.filter((c) => c.sample && c.status === 'disputed').length;
      const row = { cases: cases.length, heldout: 0, recall: null, precision: null, preferred: null, noRepair: null, sampled: 1, agreed, disagreed, agreement: agreed + disagreed ? agreed / (agreed + disagreed) : null };
      return { ok: true, lastRun: null, byFamily: { 'line.baseOn': { ...row, label: 'Make from the library' } }, byIntent: { 'add.component': { ...row, label: INTENTS[0].phrase } }, total: row, sentence: 'No eval has run yet; press Run eval.' };
    },
  };
}
