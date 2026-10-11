// The Line project read as a state machine: loading -> ready | error, and LOAD starts over from any state.
import type { LineProjectEvent, LineProjectState } from '../types.ts';

export const initialLineProject: LineProjectState = { status: 'loading' };

export function lineProjectReducer(_state: LineProjectState, event: LineProjectEvent): LineProjectState {
  switch (event.type) {
    case 'LOAD':
      return { status: 'loading' };
    case 'LOADED':
      return { status: 'ready', project: event.project };
    case 'FAILED':
      return { status: 'error', sentence: event.sentence };
  }
}
