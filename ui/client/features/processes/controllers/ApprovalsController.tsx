'use client';

import { useCallback, useState } from 'react';
import { buildApprovalRows } from '../domain/ApprovalRows';
import { buildReviewView } from '../domain/ReviewView';
import { ApprovalsList } from '../components/ApprovalsList';
import { summariesOf } from '../workflows/Processes';
import type { useProcesses } from '../hooks/useProcesses';

type ProcessesApi = ReturnType<typeof useProcesses>;

/** The Approvals tab (#371): every process with files waiting on a human, wherever you are in the
 * shell, not only the one currently selected in the Processes tab. Reuses the same review state and
 * loadReview/decide flow the Processes tab already drives, keyed by whichever row's "Review diff" was
 * clicked here instead of by the shared selection. */
export function ApprovalsController({ api }: { api: ProcessesApi }) {
  const { state, loadReview, decide } = api;
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const onReviewDiff = useCallback((id: string) => {
    setExpandedId(id);
    loadReview(id);
  }, [loadReview]);
  const onDismiss = useCallback(() => setExpandedId(null), []);

  const rs = expandedId ? state.reviews[expandedId] : undefined;
  const review = expandedId ? buildReviewView(expandedId, rs, state.notes, state.validations[expandedId] ?? null, state.deciding) : null;

  return (
    <ApprovalsList
      rows={buildApprovalRows(summariesOf(state))}
      expandedId={expandedId}
      review={review}
      reviewLoading={rs?.status === 'loading'}
      reviewError={rs?.status === 'error' ? rs.message : null}
      onReviewDiff={onReviewDiff}
      onDismiss={onDismiss}
      onDecide={decide}
    />
  );
}
