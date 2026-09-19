'use client';

import { useCallback, useEffect, useReducer, useRef } from 'react';
import { scheduleRetry } from '../services/RetryTimer';
import { initialRetryState, retryReducer } from '../workflows/RetryFlow';

/** Drives the /states reference page: pressing "Try again" on the sample error
 * shows a short retrying state, then counts the attempt. */
export function useStatesGallery() {
  const [state, dispatch] = useReducer(retryReducer, initialRetryState);
  const cancel = useRef<(() => void) | null>(null);

  const retry = useCallback(() => {
    dispatch({ type: 'RETRY_STARTED' });
    cancel.current = scheduleRetry(() => dispatch({ type: 'RETRY_FINISHED' }));
  }, []);

  useEffect(() => () => cancel.current?.(), []);

  return { retries: state.retries, retrying: state.retrying, retry };
}
