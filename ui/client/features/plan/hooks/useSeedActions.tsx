'use client';

import { useCallback, type Dispatch } from 'react';
import { analyseImpact, proposeSeeds } from '../services/SeedsApi';
import type { ScreenAction, ScreenState } from '../domain/PlanTypes';

/**
 * Ticket text to impact. Proposals are a text match on the server (no model); you confirm each one. The
 * impact is a graph computation over the units you picked and the proposals you confirmed.
 */
export function useSeedActions(state: ScreenState, dispatch: Dispatch<ScreenAction>) {
  const text = state.ticket.body || state.ticket.title;

  const propose = useCallback(async () => {
    dispatch({ type: 'PROPOSALS_LOADING' });
    const r = await proposeSeeds(text);
    dispatch(r.ok ? { type: 'PROPOSALS_LOADED', proposals: r.data } : { type: 'PROPOSALS_FAILED', error: r.error });
  }, [text, dispatch]);

  const analyse = useCallback(async () => {
    dispatch({ type: 'IMPACT_LOADING' });
    const r = await analyseImpact(state.picked, state.accepted, text);
    const seeds = { explicit: state.picked.length, inferred: state.accepted.length };
    dispatch(r.ok ? { type: 'IMPACT_LOADED', impact: r.data, seeds } : { type: 'IMPACT_FAILED', error: r.error });
  }, [text, state.picked, state.accepted, dispatch]);

  return { propose, analyse };
}
