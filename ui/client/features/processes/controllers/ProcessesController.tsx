'use client';

import { buildDetailView } from '../domain/DetailView';
import { buildListRows } from '../domain/ListRows';
import { buildReviewView } from '../domain/ReviewView';
import type { useProcesses } from '../hooks/useProcesses';
import { ProcessesPage } from '../pages/ProcessesPage';
import { summariesOf } from '../workflows/Processes';

type ProcessesApi = ReturnType<typeof useProcesses>;

/** The Processes tab body. The state lives in the shell (so the top-bar count is real while the
 * drawer is closed); this only turns it into what the page shows. */
export function ProcessesController({ api }: { api: ProcessesApi }) {
  const { state, select, control, loadDiff, loadReview, decide } = api;
  const selected = state.selectedId ? state.details[state.selectedId] : null;
  const rs = state.selectedId ? state.reviews[state.selectedId] : undefined;
  const review = state.selectedId
    ? buildReviewView(state.selectedId, rs, state.notes, state.validations[state.selectedId] ?? null, state.deciding)
    : null;
  return (
    <ProcessesPage
      rows={buildListRows(summariesOf(state), state.selectedId)}
      detail={selected ? buildDetailView(selected) : null}
      diffs={state.diffs}
      review={review}
      reviewLoading={rs?.status === 'loading'}
      reviewError={rs?.status === 'error' ? rs.message : null}
      onReview={loadReview}
      onDecide={decide}
      busy={state.busyId !== null}
      notice={state.notice}
      error={state.error}
      live={state.live || !state.loaded}
      onSelect={select}
      onControl={control}
      onShowDiff={loadDiff}
    />
  );
}
