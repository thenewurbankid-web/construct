'use client';

import { useCallback, useState } from 'react';
import type { ApplyResult, LineFixNoticeState } from '../types';

/** A screen's notice of the last fix applied from any of its problems: every answer becomes the notice, and a
 * landed one calls `onLanded` (re-read the project, re-run validate). */
export function useLineFixNotice(onLanded: () => void): LineFixNoticeState {
  const [notice, setNotice] = useState<ApplyResult | null>(null);
  const onResult = useCallback(
    (result: ApplyResult) => {
      setNotice(result);
      if (result.ok) onLanded();
    },
    [onLanded],
  );
  return { notice, onResult };
}
