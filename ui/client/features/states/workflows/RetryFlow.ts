// Pure (WORKFLOW-001: no react import): the sample error's retry flow on the
// /states reference page. Idle -> retrying -> counted, then idle again.
export type RetryState = { retries: number; retrying: boolean };

export type RetryAction = { type: 'RETRY_STARTED' } | { type: 'RETRY_FINISHED' };

export const initialRetryState: RetryState = { retries: 0, retrying: false };

export function retryReducer(state: RetryState, action: RetryAction): RetryState {
  switch (action.type) {
    case 'RETRY_STARTED':
      return { ...state, retrying: true };
    case 'RETRY_FINISHED':
      return { retries: state.retries + 1, retrying: false };
    default:
      return state;
  }
}
