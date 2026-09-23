'use client';

import { useCallback, useRef } from 'react';

type Framing = { connectTo: (url: string) => void; release: (url: string) => void };

/**
 * #378: the dev server the Cockpit started is framed like any other preview URL. Returns the handler the
 * dev-server card calls with its address (and with `null` when it stops); on a stop only that address is let
 * go, so a URL the person typed themselves is left alone.
 */
export function usePreviewServerUrl({ connectTo, release }: Framing) {
  const last = useRef<string | null>(null);
  return useCallback((url: string | null) => {
    if (url) {
      last.current = url;
      connectTo(url);
    } else if (last.current) {
      release(last.current);
      last.current = null;
    }
  }, [connectTo, release]);
}
