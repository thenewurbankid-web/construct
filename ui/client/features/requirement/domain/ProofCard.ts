// Pure (DOMAIN-001): the proof of a generated screen (#653, part of #616) as the words and flags the Proof card draws. Every rule
// is the server's (packages/core/proof.mjs proofStatus and proofSummary, ui/server requirementProofApi.mjs); this only says
// which state the card is in, why a button is off, and what the chain summary reads. Nothing here is decided by a model.
import type { ProofButtonView, ProofFailureView, ProofNoteView, ProofNoticeView, ProofView } from '../types.ts';
import { PROOF_REASON } from './ProofSkip.ts';
import { proofTargetOf } from './ProofTarget.ts';
import type { ProofFailure, ProofState, ReadResult, ScreenState } from './RequirementTypes.ts';

const STATE_WORD: Record<ProofState, { symbol: string; word: string }> = {
  pending: { symbol: '○', word: 'Pending' },
  green: { symbol: '✓', word: 'Green' },
  failed: { symbol: '✗', word: 'Failed' },
  skipped: { symbol: '↷', word: 'Skipped' },
};

/** The two options this slice makes work; the others show what they will do and stay off (no View/edit code or Fill with AI route exists yet). */
const ACTION: Record<string, 'run' | 'skip'> = { 'run-proof': 'run', 'skip-proof': 'skip' };
const OFF_REASON: Record<string, string> = {
  'edit-code': 'Not wired here yet: View/edit code will open the unit whose state is wrong, in the code editor.',
  'fill-with-ai': 'Not wired here yet: Fill with AI will propose the fix as a reviewable diff, and the proof stays as it is.',
  'regenerate-screen': 'Not wired here yet: this will write the screen\'s files again from its shape.',
};
const TESTID: Record<string, string> = { 'run-proof': 'proof-run', 'skip-proof': 'proof-skip' };

/** The state of the card: a skip that stands wins; else the last run; else pending. */
export function proofStateOf(state: ScreenState): ProofState {
  const { proof } = state;
  if (proof.skip.status === 'skipped') return 'skipped';
  return proof.run.result?.state ?? 'pending';
}

/** The chain of the screen is complete when the proof is green or explicitly skipped; the line always says which, never a plain "complete". */
export function chainLine(state: ProofState, reason: string | null, passed: number, running: boolean): { complete: boolean; line: string } {
  if (running) return { complete: false, line: 'incomplete (the proof is running)' };
  if (state === 'green') return { complete: true, line: `complete (proof green: ${passed} passed)` };
  if (state === 'skipped') return { complete: true, line: `complete (proof skipped: ${reason ?? ''})` };
  if (state === 'failed') return { complete: false, line: 'incomplete (the proof failed: fix the screen and run it again, or skip it with a reason)' };
  return { complete: false, line: 'incomplete (the proof has not run yet)' };
}

function failureView(f: ProofFailure): ProofFailureView {
  const test = { id: 'test', text: `Test: ${f.test}` };
  if (f.kind === 'app') {
    const reached = f.reached ? `, the screen reached ${f.reached}` : '';
    return {
      kind: 'app', symbol: '✗', heading: 'The app behaved differently', summary: f.summary, message: null,
      facts: [{ id: 'failing-state', text: `Failing state: ${f.expected ?? 'unknown'}${reached}` }, test],
      notes: ['The proof found what it binds to, so this one is worth fixing in the screen.'],
    };
  }
  if (f.kind === 'convention') {
    return {
      kind: 'convention', symbol: '⚠', heading: 'Harness problem, not a product bug', summary: f.summary, message: f.message,
      facts: [test, ...(f.selector ? [{ id: 'looked-for', text: `Looked for: ${f.selector}` }] : [])],
      notes: f.fix ? [`How to fix it. ${f.fix}`] : [],
    };
  }
  return { kind: 'other', symbol: '⚠', heading: 'The proof could not finish', summary: f.summary, message: f.message, facts: [test], notes: [] };
}

/** Why the proof cannot be run or skipped yet, or null when it can. The order of the chain is shown plainly: approve, then prove. */
function whyNot(state: ScreenState): string | null {
  const { proof, approve } = state;
  if (proof.applied === true) return null;
  if (proof.applied === null) return 'Checking whether the plan\'s files are in the project...';
  if (approve.status === 'started') return 'The plan is approved: approve each of its files in the process, then run the proof.';
  return 'Approve the plan first: the proof runs against the files it writes.';
}

/** Run first (the primary button), then the closed options of the server's summary, each working or off with its reason. */
function buttonViews(state: ScreenState, blocked: string | null, running: boolean, label: string): { buttons: ProofButtonView[]; notes: ProofNoteView[] } {
  const { proof } = state;
  const busy = running || proof.skip.status === 'saving';
  const others = proof.options.filter((o) => o.id !== 'run-proof');
  const buttons: ProofButtonView[] = [
    { id: 'run-proof', testId: 'proof-run', label, variant: 'primary', action: 'run', disabled: blocked !== null || busy, why: 'Run the read-only proof of the screen.' },
    ...others.map((o): ProofButtonView => ({
      id: o.id, testId: TESTID[o.id] ?? `proof-option-${o.id}`, label: o.label, variant: 'ghost', action: ACTION[o.id] ?? 'off', why: o.why,
      disabled: ACTION[o.id] ? blocked !== null || busy || proof.skip.status === 'open' : true,
    })),
  ];
  const notes = others.filter((o) => !ACTION[o.id]).map((o): ProofNoteView => ({ id: o.id, text: `${o.label}. ${o.why} ${OFF_REASON[o.id] ?? 'Not wired here yet.'}` }));
  return { buttons, notes };
}

function noticeViews(state: ScreenState, running: boolean, counts: string | null): ProofNoticeView[] {
  const { proof } = state;
  const error = proof.run.error ?? proof.run.result?.error?.message ?? null;
  const notices: ProofNoticeView[] = [];
  if (counts) notices.push({ id: 'counts', tone: 'muted', role: undefined, text: counts });
  if (running) notices.push({ id: 'running', tone: 'muted', role: 'status', text: 'Running the proof...' });
  if (error) notices.push({ id: 'error', tone: 'error', role: 'alert', text: error });
  return notices;
}

/** The Proof card, or null when the plan proves nothing. */
export function buildProofView(state: ScreenState, result: ReadResult): ProofView | null {
  const target = proofTargetOf(result);
  if (!target) return null;
  const { proof } = state;
  const s = proofStateOf(state);
  const running = proof.run.status === 'running';
  const run = proof.run.result;
  const blocked = whyNot(state);
  const label = running ? 'Running...' : run || s === 'skipped' ? 'Run the proof again' : 'Run the proof';
  const counts = run && s !== 'skipped' ? `${run.counts.passed} passed, ${run.counts.failed} failed (${(run.durationMs / 1000).toFixed(1)} s, no browser)` : null;
  const saving = proof.skip.status === 'saving';
  return {
    feature: target.feature,
    screen: target.screen,
    state: s,
    symbol: STATE_WORD[s].symbol,
    stateLabel: STATE_WORD[s].word,
    headline: s === 'green' ? `The ${target.screen} screen is proven.` : s === 'skipped' ? `The proof of the ${target.screen} screen was skipped on purpose.` : s === 'failed' ? `The proof of the ${target.screen} screen failed.` : `Nothing has shown the ${target.screen} screen behaves yet.`,
    chain: chainLine(s, proof.skip.reason, run?.counts.passed ?? 0, running),
    notices: noticeViews(state, running, counts),
    failures: s === 'skipped' ? [] : (run?.failures ?? []).map(failureView),
    ...buttonViews(state, blocked, running, label),
    runReason: blocked ?? (saving ? 'Wait for the skip to be saved.' : null),
    skip: {
      open: proof.skip.status === 'open' || saving, saving, draft: proof.skip.draft, error: proof.skip.error, invalid: proof.skip.error !== null,
      hint: `${PROOF_REASON.min} to ${PROOF_REASON.max} characters, one line.`, max: PROOF_REASON.max, confirmLabel: saving ? 'Saving...' : 'Skip the proof',
    },
  };
}
