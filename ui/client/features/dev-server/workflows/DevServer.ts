// The dev-server card's own state machine: what has been read, whether a click is in flight, and whether the
// one-time "this is what will run" question is open. Pure, so it is testable without a browser.
import type { DevServerStatus } from '../types';

export type DevServerSession = {
  status: DevServerStatus | null;
  /** A Start / Restart / Stop is in flight. */
  busy: boolean;
  /** The first-start question is showing. */
  confirming: boolean;
  error: string | null;
};

export type DevServerAction =
  | { type: 'STATUS'; status: DevServerStatus }
  | { type: 'UNREACHABLE' }
  | { type: 'BUSY'; busy: boolean }
  | { type: 'CONFIRMING'; on: boolean };

export const initialDevServerSession: DevServerSession = { status: null, busy: false, confirming: false, error: null };

export function devServerReducer(state: DevServerSession, action: DevServerAction): DevServerSession {
  switch (action.type) {
    case 'STATUS':
      return { ...state, status: action.status, error: null };
    case 'UNREACHABLE':
      return { ...state, error: 'Could not reach the Construct server.' };
    case 'BUSY':
      return { ...state, busy: action.busy };
    case 'CONFIRMING':
      return { ...state, confirming: action.on };
    default:
      return state;
  }
}
