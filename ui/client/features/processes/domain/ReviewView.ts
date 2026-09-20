// Pure (DOMAIN-001): the approval gate's review in display form. The one rule that matters lives
// here as data: Approve is on only when the gate says `applicable`, and a refusal has no override.
import type { DecisionNote, DiffLine, Review, ReviewArtifact, ReviewRow, ReviewState, ReviewView, Validation } from '../types.ts';

/** Classify a unified diff line for colouring. Presentation only: the text itself is untouched. */
export function diffLines(diff: string | null): DiffLine[] {
  if (!diff) return [];
  const lines = diff.replace(/\n$/, '').split('\n');
  return lines.map((text, key) => {
    let kind: DiffLine['kind'] = 'ctx';
    if (text.startsWith('@@')) kind = 'hunk';
    else if (/^(diff --git|index |--- |\+\+\+ |new file|deleted file|similarity|old mode|new mode)/.test(text)) kind = 'meta';
    else if (text.startsWith('+')) kind = 'add';
    else if (text.startsWith('-')) kind = 'del';
    return { key, kind, text };
  });
}

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

export function validationText(v: Validation | null): { text: string | null; violations: string[]; ok: boolean } {
  if (!v) return { text: null, violations: [], ok: true };
  if (!v.ran) return { text: `The architecture check could not run after applying: ${v.error ?? 'unknown reason'}. Nothing was reverted.`, violations: [], ok: false };
  if (v.newViolations.length === 0) return { text: 'Checked after applying: no new architecture violations.', violations: [], ok: true };
  return {
    text: `Checked after applying: ${v.newViolations.length} new architecture violation(s). Nothing was reverted; fix them or undo the change yourself.`,
    violations: v.newViolations.map((x) => `${x.rule ?? 'rule'} ${x.file ?? ''}: ${x.message ?? ''}`.trim()),
    ok: false,
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
