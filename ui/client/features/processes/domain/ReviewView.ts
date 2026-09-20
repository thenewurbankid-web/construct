// Pure (DOMAIN-001): the approval gate's review in display form. The one rule that matters lives
// here as data: Approve is on only when the gate says `applicable`, and a refusal has no override.
import type { DecisionNote, Review, ReviewArtifact, ReviewRow, ReviewState, ReviewView, Validation } from './ReviewTypes.ts';
import { diffLines } from './DiffLines.ts';
import { validationText } from './ValidationText.ts';

export function verdictText(a: ReviewArtifact): string | null {
  if (!a.verdict) return null;
  const word = a.verdict.decision === 'approved' ? 'Approved' : 'Rejected';
  const by = a.verdict.by ? ` by ${a.verdict.by}` : '';
  const at = a.verdict.at ? ` at ${a.verdict.at.replace('T', ' ').replace(/\.\d+Z$/, 'Z')}` : '';
  return `${word}${by}${at}`;
}

export function reviewRow(a: ReviewArtifact, note: DecisionNote, busy: boolean): ReviewRow {
  const decided = a.verdict !== null;
  const canApprove = a.applicable && !decided && !!a.diffSha256 && a.refusals.length === 0;
  let approveOffReason: string | null = null;
  if (!canApprove && !decided) approveOffReason = a.refusals[0]?.message ?? 'The gate has not cleared this file.';
  return {
    path: a.path,
    change: a.change,
    diffLines: diffLines(a.diff),
    diffSha256: a.diffSha256,
    refusals: a.refusals,
    canApprove,
    canReject: !decided,
    approveOffReason,
    verdict: verdictText(a),
    model: a.llm ? `Written by a ${a.llm.provider ?? 'local'} model` : null,
    note,
    busy,
  };
}

export function buildReviewView(
  processId: string,
  state: ReviewState | undefined,
  notes: Record<string, DecisionNote>,
  validation: Validation | null,
  deciding: string | null,
): ReviewView | null {
  if (!state || state.status !== 'ready') return null;
  const review: Review = state.review;
  const v = validationText(validation);
  return {
    processId,
    rows: review.artifacts.map((a) => reviewRow(a, notes[`${processId}\n${a.path}`] ?? null, deciding !== null)),
    unrecorded: review.unrecordedBranchChanges,
    validationText: v.text,
    validationViolations: v.violations,
    validationOk: v.ok,
    resolved: review.resolved,
  };
}
