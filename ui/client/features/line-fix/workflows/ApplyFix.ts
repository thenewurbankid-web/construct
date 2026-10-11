// One fix at a time, as a state machine: idle -> applying -> done (landed or refused); APPLY while applying is
// ignored, so a double click sends one request.
import type { FixEvent, FixState } from '../types.ts';

export const idleFix: FixState = { phase: 'idle' };

export function applyFixReducer(state: FixState, event: FixEvent): FixState {
  switch (event.type) {
    case 'APPLY':
      return state.phase === 'applying' ? state : { phase: 'applying', fixId: event.fixId };
    case 'DONE':
      return state.phase === 'applying' ? { phase: 'done', result: event.result } : state;
  }
}

/** The refusal sentence the panel shows, or null (nothing sent yet, still applying, or it landed). */
export function refusalOf(state: FixState): string | null {
  return state.phase === 'done' && !state.result.ok ? state.result.sentence : null;
}
