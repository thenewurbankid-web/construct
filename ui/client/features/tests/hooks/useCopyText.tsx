'use client';

import { useCallback, useEffect, useState } from 'react';

/** Copy text for a ticket. `copied` is the key of what was last copied; when the browser will not let a page write the
 * clipboard, `copy` says so (false) and the caller leaves the text on screen to select. Reset whenever `scope` changes. */
export function useCopyText(scope: string) {
  const [copied, setCopied] = useState<string | null>(null);
  useEffect(() => setCopied(null), [scope]);

  const copy = useCallback(async (key: string, text: string): Promise<boolean> => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      return true;
    } catch {
      setCopied(null);
      return false;
    }
  }, []);

  return { copied, copy };
}
