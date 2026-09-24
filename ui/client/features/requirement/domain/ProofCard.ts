// Pure (DOMAIN-001): the proof of a generated screen (#653, part of #616) as the words and flags the Proof card draws. Every rule
// is the server's (packages/core/proof.mjs proofStatus and proofSummary, ui/server requirementProofApi.mjs); this only says
// which state the card is in, why a button is off, and what the chain summary reads. Nothing here is decided by a model.
import type { ProofFailureView, ProofOptionView, ProofView } from '../types.ts';
import type { ProofFailure, ProofState, ReadResult, ScreenState } from './RequirementTypes.ts';

/** The reason of a skip is a sentence, not a shrug. Mirrors ui/server requirementProofApi.mjs PROOF_REASON (the server refuses the rest again). */
export const PROOF_REASON = { min: 8, max: 200 } as const;

const STATE_WORD: Record<ProofState, { symbol: string; word: string }> = {
  pending: { symbol: '○', word: 'Pending' },
  green: { symbol: '✓', word: 'Green' },
  failed: { symbol: '✗', word: 'Failed' },
  skipped: { symbol: '↷', word: 'Skipped' },
};

/** The two options this slice makes work; the others show what they will do and stay off (no View/edit code or Fill with AI route exists yet). */
const LIVE = new Set(['run-proof', 'skip-proof']);
const OFF_REASON: Record<string, string> = {
  'edit-code': 'Not wired here yet: View/edit code will open the unit whose state is wrong, in the code editor.',
  'fill-with-ai': 'Not wired here yet: Fill with AI will propose the fix as a reviewable diff, and the proof stays as it is.',
  'regenerate-screen': 'Not wired here yet: this will write the screen\'s files again from its shape.',
};

/** What a plan says it proves: the feature its `test.proof` step runs and the screen's name, or null when it proves nothing (no shaped unit). */
export function proofTargetOf(result: ReadResult | null): { feature: string; screen: string } | null {
  const step = result?.plan?.steps.find((s) => s.flow === 'test.proof' && typeof s.args?.feature === 'string');
  if (!step) return null;
  const name = typeof step.args.name === 'string' ? step.args.name.replace(/Screen\.proof\.test\.ts$/, '') : '';
  return { feature: String(step.args.feature), screen: name || result?.proof?.steps[0]?.name || 'the screen' };
}

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
  if (f.kind === 'app') {
    return { kind: 'app', heading: 'The app behaved differently', test: f.test, summary: f.summary, failingState: f.expected ?? null, expected: f.expected ?? null, reached: f.reached ?? null, message: null, fix: null };
  }
  if (f.kind === 'convention') {
    return { kind: 'convention', heading: 'Harness problem, not a product bug', test: f.test, summary: f.summary, failingState: null, expected: f.selector ?? null, reached: null, message: f.message, fix: f.fix ?? null };
  }
  return { kind: 'other', heading: 'The proof could not finish', test: f.test, summary: f.summary, failingState: null, expected: null, reached: null, message: f.message, fix: null };
}

/** Why the proof cannot be run or skipped yet, or null when it can. The order of the chain is shown plainly: approve, then prove. */
function whyNot(state: ScreenState): string | null {
  const { proof, approve } = state;
  if (proof.applied === true) return null;
  if (proof.applied === null) return 'Checking whether the plan\'s files are in the project...';
  if (approve.status === 'started') return 'The plan is approved: approve each of its files in the process, then run the proof.';
  return 'Approve the plan first: the proof runs against the files it writes.';
}

function optionViews(state: ScreenState, blocked: string | null): ProofOptionView[] {
  const { proof } = state;
  const busy = proof.run.status === 'running' || proof.skip.status === 'saving';
  return proof.options.filter((o) => o.id !== 'run-proof').map((o) => {
    const live = LIVE.has(o.id);
    const disabledReason = live ? (blocked ?? (busy ? 'Wait for the run to finish.' : null)) : (OFF_REASON[o.id] ?? 'Not wired here yet.');
    return { id: o.id, label: o.label, why: o.why, live, disabledReason };
  });
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
  const chain = chainLine(s, proof.skip.reason, run?.counts.passed ?? 0, running);
  return {
    feature: target.feature,
    screen: target.screen,
    state: s,
    symbol: STATE_WORD[s].symbol,
    stateLabel: STATE_WORD[s].word,
    headline: s === 'green' ? `The ${target.screen} screen is proven.` : s === 'skipped' ? `The proof of the ${target.screen} screen was skipped on purpose.` : s === 'failed' ? `The proof of the ${target.screen} screen failed.` : `Nothing has shown the ${target.screen} screen behaves yet.`,
    counts: run && s !== 'skipped' ? `${run.counts.passed} passed, ${run.counts.failed} failed (${(run.durationMs / 1000).toFixed(1)} s, no browser)` : null,
    chain,
    skippedReason: s === 'skipped' ? proof.skip.reason : null,
    running,
    runLabel: running ? 'Running...' : run || s === 'skipped' ? 'Run the proof again' : 'Run the proof',
    runDisabledReason: blocked ?? (proof.skip.status === 'saving' ? 'Wait for the skip to be saved.' : null),
    canRun: blocked === null && !running && proof.skip.status !== 'saving',
    failures: s === 'skipped' ? [] : (run?.failures ?? []).map(failureView),
    runError: proof.run.error ?? (run?.error ? run.error.message : null),
    options: optionViews(state, blocked),
    skip: { open: proof.skip.status === 'open' || proof.skip.status === 'saving', saving: proof.skip.status === 'saving', draft: proof.skip.draft, error: proof.skip.error, min: PROOF_REASON.min, max: PROOF_REASON.max },
  };
}

/** The skip reason to send, trimmed, or what is wrong with it: empty, too short, too long or not one line. */
export function skipReasonOf(draft: string): { ok: true; reason: string } | { ok: false; error: string } {
  const text = draft.trim();
  if (!text) return { ok: false, error: 'Give a reason for skipping the proof.' };
  if (/[\r\n]/.test(text)) return { ok: false, error: 'The reason is one line of plain text.' };
  if (text.length < PROOF_REASON.min) return { ok: false, error: `Give a reason of at least ${PROOF_REASON.min} characters, so the skip says why.` };
  if (text.length > PROOF_REASON.max) return { ok: false, error: `Keep the reason to ${PROOF_REASON.max} characters.` };
  return { ok: true, reason: text };
}
