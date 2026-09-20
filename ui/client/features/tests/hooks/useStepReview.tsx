'use client';

import { useCallback, type Dispatch } from 'react';
import { payloadOf } from '../domain/StepDraft';
import { fetchSteps, previewSteps, saveSteps } from '../services/StepsApi';
import type { StepEditorAction, StepEditorState } from '../types';

type Editing = Extract<StepEditorState, { status: 'editing' }>;

/** The two server round trips of an edit: ask for the diff (nothing is written), then write exactly that diff. */
export function useStepReview(feature: string, editing: Editing | null, dispatch: Dispatch<StepEditorAction>) {
  /** Ask the server to validate the edit and show what would change. */
  const review = useCallback(async () => {
    if (!editing) return;
    dispatch({ type: 'REVIEW_START' });
    const r = await previewSteps(feature, editing.name, editing.hash, payloadOf(editing.draft));
    if (!r.ok) return dispatch({ type: 'REVIEW_FAILED', message: r.error, stale: r.code === 'stale' });
    dispatch({ type: 'REVIEW_READY', resultSha: r.resultSha, changed: r.changed, rows: r.diff.rows, added: r.diff.stats.added, removed: r.diff.stats.removed });
  }, [editing, feature, dispatch]);

  /** Write the reviewed change, then reopen the saved file so the document is the file. */
  const confirm = useCallback(async () => {
    if (!editing || editing.review.status !== 'ready') return;
    const { resultSha } = editing.review;
    dispatch({ type: 'SAVE_START' });
    const r = await saveSteps(feature, editing.name, editing.hash, resultSha, payloadOf(editing.draft));
    if (!r.ok) return dispatch({ type: 'REVIEW_FAILED', message: r.error, stale: r.code === 'stale' || r.code === 'not-reviewed' });
    dispatch({ type: 'LOADED', doc: await fetchSteps(feature, editing.name), notice: `Saved to ${editing.path}. The file on disk is exactly what you reviewed.` });
  }, [editing, feature, dispatch]);

  return { review, confirm };
}
