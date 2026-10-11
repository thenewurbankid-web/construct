// One Line change at a time, as a state machine. "Base on this": idle -> base-on (pick feature and name) ->
// base-on-saving -> idle (landed) or back to base-on with the refusal sentence. "Promote to library": idle ->
// promote (confirm) -> promote-saving -> idle, or back to promote with the sentence. CANCEL returns to idle.
import type { ChangeEvent, ChangeState } from '../types.ts';

export const idleChange: ChangeState = { status: 'idle' };

export function lineChangeReducer(state: ChangeState, event: ChangeEvent): ChangeState {
  switch (event.type) {
    case 'OPEN_BASE_ON':
      if (state.status === 'base-on-saving' || state.status === 'promote-saving') return state;
      return { status: 'base-on', libraryId: event.libraryId, libraryName: event.libraryName, feature: event.feature, name: event.name, error: null };
    case 'SET_FEATURE':
      return state.status === 'base-on' ? { ...state, feature: event.feature, name: event.name, error: null } : state;
    case 'SET_NAME':
      return state.status === 'base-on' ? { ...state, name: event.name, error: null } : state;
    case 'OPEN_PROMOTE':
      if (state.status === 'base-on-saving' || state.status === 'promote-saving') return state;
      return { status: 'promote', featureItemId: event.featureItemId, name: event.name, error: null };
    case 'CANCEL':
      return state.status === 'base-on' || state.status === 'promote' ? idleChange : state;
    case 'SUBMIT':
      if (state.status === 'base-on') return { status: 'base-on-saving', libraryId: state.libraryId, libraryName: state.libraryName, feature: state.feature, name: state.name };
      if (state.status === 'promote') return { status: 'promote-saving', featureItemId: state.featureItemId, name: state.name };
      return state;
    case 'DONE':
      if (event.result.ok) return idleChange;
      if (state.status === 'base-on-saving') return { status: 'base-on', libraryId: state.libraryId, libraryName: state.libraryName, feature: state.feature, name: state.name, error: event.result.sentence };
      if (state.status === 'promote-saving') return { status: 'promote', featureItemId: state.featureItemId, name: state.name, error: event.result.sentence };
      return state;
  }
}
