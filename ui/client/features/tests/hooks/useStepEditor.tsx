'use client';

import { useCallback, useEffect, useMemo, useReducer } from 'react';
import { changeCount, problemsOf } from '../domain/StepChanges';
import { stepRows } from '../domain/StepView';
import { fetchSteps } from '../services/StepsApi';
import type { StepEditorState, StepFields } from '../types';
import { initialStepEditor, stepEditorReducer } from '../workflows/StepEditorMachine';
import { useStepReview } from './useStepReview';

/** The step editor for one feature's tests: open a test as a step document, edit its steps, review the diff, save.
 * Every rule about what may be written lives on the server (and in core); the client only drafts and asks. */
export function useStepEditor(feature: string) {
  const [state, dispatch] = useReducer(stepEditorReducer, initialStepEditor);
  useEffect(() => dispatch({ type: 'CLOSE' }), [feature]);
  const editing: Extract<StepEditorState, { status: 'editing' }> | null = state.status === 'editing' ? state : null;
  const open = useCallback(async (name: string) => {
    dispatch({ type: 'OPEN', name });
    dispatch({ type: 'LOADED', doc: await fetchSteps(feature, name) });
  }, [feature]);
  const { review, confirm } = useStepReview(feature, editing, dispatch);
  const view = useMemo(() => (editing ? { rows: stepRows(editing.draft, editing.original), changes: changeCount(editing.draft, editing.original), problems: problemsOf(editing.draft) } : null), [editing]);
  return {
    state, view, open, review, confirm,
    reopen: () => (state.status === 'editing' ? open(state.name) : Promise.resolve()),
    close: () => dispatch({ type: 'CLOSE' }),
    select: (key: number) => dispatch({ type: 'SELECT', key }),
    patch: (key: number, patch: Partial<StepFields>) => dispatch({ type: 'PATCH', key, patch }),
    add: (kind: 'event' | 'state' | 'check-text') => dispatch({ type: 'ADD', kind }),
    remove: (key: number) => dispatch({ type: 'REMOVE', key }),
    restore: (key: number) => dispatch({ type: 'RESTORE', key }),
    move: (key: number, dir: -1 | 1) => dispatch({ type: 'MOVE', key, dir }),
    discard: () => dispatch({ type: 'DISCARD' }),
    back: () => dispatch({ type: 'REVIEW_BACK' }),
  };
}
