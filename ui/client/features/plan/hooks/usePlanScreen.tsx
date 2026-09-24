'use client';

import { useCallback, useMemo, useReducer } from 'react';
import { initialScreen, screenReducer } from '../workflows/PlanMachine';
import { usePlanContext } from './usePlanContext';
import { usePlanNote } from './usePlanNote';
import { usePlanRun } from './usePlanRun';
import { usePlanValidation } from './usePlanValidation';
import { useSeedActions } from './useSeedActions';
import { useStepActions } from './useStepActions';
import type { Ticket } from '../domain/PlanTypes';

/**
 * Everything the Plan screen does, composed from small hooks. No model is called from here or from anything
 * it calls: proposals are a text match on the server, the impact is a graph computation, and the plan is
 * judged by the server's validator after every edit.
 */
export function usePlanScreen(onStarted: () => void) {
  const [state, dispatch] = useReducer(screenReducer, initialScreen);
  usePlanContext(dispatch);
  const flows = useMemo(() => state.context?.flows ?? [], [state.context]);
  const { plan, stale, canRun } = usePlanValidation(state, dispatch);
  const seeds = useSeedActions(state, dispatch);
  const steps = useStepActions(state, dispatch, flows);
  const note = usePlanNote(state, dispatch);
  const noteForRun = useMemo(() => ({ flush: note.flush, resync: note.resync }), [note.flush, note.resync]);
  const run = usePlanRun(plan, dispatch, onStarted, noteForRun);
  const setTicket = useCallback((t: Partial<Ticket>) => dispatch({ type: 'TICKET', ticket: t }), []);
  const togglePick = useCallback((ref: string) => dispatch({ type: 'TOGGLE_PICK', ref }), []);
  const toggleAccept = useCallback((ref: string) => dispatch({ type: 'TOGGLE_ACCEPT', ref }), []);
  return { state, stale, canRun, run, setTicket, togglePick, toggleAccept, noteActions: { onRetry: note.retry, onLoadTheirs: note.loadTheirs, onKeepMine: note.keepMine, onKeepPlan: note.keepPlan }, ...seeds, ...steps };
}
