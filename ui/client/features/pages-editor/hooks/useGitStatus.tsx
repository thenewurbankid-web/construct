'use client';

import { useEffect, useState } from 'react';
import { getPageGitStatus, type PageGitStatus } from '../services/GitStatusApi';

/** Tree-row dot (#829): whether the open page file differs from `main`. Computed once per open
 * file, refetched when its content hash changes (i.e. after every save). */
export function useGitStatus(feature: string, file: string, contentHash: string) {
  const [status, setStatus] = useState<PageGitStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    setStatus(null);
    getPageGitStatus(feature, file).then((r) => {
      if (!cancelled) setStatus(r);
    });
    return () => {
      cancelled = true;
    };
  }, [feature, file, contentHash]);

  return status;
}
