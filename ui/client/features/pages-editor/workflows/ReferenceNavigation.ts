import { emptyTrail, startTrail } from '../domain/TrailHistory';
import { goBack, goForward, goTo } from '../domain/TrailMoves';
import { pushStep, refreshRoot } from '../domain/TrailSteps';
import { canBack, canForward } from '../domain/TrailAvailability';
import type { NavView, Trail, TrailStep } from '../types';

// Pure (WORKFLOW-001) — the click-to-navigate state machine (#321): load the open page, follow a
// reference to a new step, move back/forward along the trail.
export type ReferenceNavigationState = {
  trail: Trail;
  loading: boolean;
  /** Set when the open page could not be read. */
  error: string | null;
  /** Set when a hop failed (the reference stopped resolving between draw and click). */
  hopError: string | null;
};

export type ReferenceNavigationAction =
  | { type: 'RESET' }
  | { type: 'LOADING' }
  | { type: 'ROOT_LOADED'; view: NavView }
  | { type: 'ROOT_REFRESHED'; view: NavView }
  | { type: 'LOAD_FAILED'; error: string }
  | { type: 'FOLLOWED'; step: TrailStep }
  | { type: 'HOP_FAILED'; error: string }
  | { type: 'BACK' }
  | { type: 'FORWARD' }
  | { type: 'GOTO'; index: number };

export const initialReferenceNavigation: ReferenceNavigationState = { trail: emptyTrail, loading: false, error: null, hopError: null };

export function referenceNavigationReducer(state: ReferenceNavigationState, action: ReferenceNavigationAction): ReferenceNavigationState {
  switch (action.type) {
    case 'RESET':
      return initialReferenceNavigation;
    case 'LOADING':
      return { ...state, trail: emptyTrail, loading: true, error: null, hopError: null };
    case 'ROOT_LOADED':
      return { trail: startTrail(action.view), loading: false, error: null, hopError: null };
    case 'ROOT_REFRESHED':
      return { ...state, trail: refreshRoot(state.trail, action.view), loading: false, error: null };
    case 'LOAD_FAILED':
      return { ...state, loading: false, error: action.error };
    case 'FOLLOWED':
      return { ...state, trail: pushStep(state.trail, action.step), hopError: null };
    case 'HOP_FAILED':
      return { ...state, hopError: action.error };
    case 'BACK':
      return canBack(state.trail) ? { ...state, trail: goBack(state.trail), hopError: null } : state;
    case 'FORWARD':
      return canForward(state.trail) ? { ...state, trail: goForward(state.trail), hopError: null } : state;
    case 'GOTO':
      return { ...state, trail: goTo(state.trail, action.index), hopError: null };
    default:
      return state;
  }
}
