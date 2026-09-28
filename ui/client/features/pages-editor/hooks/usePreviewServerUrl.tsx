'use client';

import { useCallback, useRef } from 'react';
import type { DevServerUrlInfo } from '@/features/dev-server';

type Framing = { connectTo: (url: string, previewUrl?: string | null, previewNonce?: string | null) => void; release: (url: string) => void };

/**
 * #378: the dev server the Cockpit started is framed like any other preview URL. Returns the handler the
 * dev-server card calls with its address; on a stop only that address is let go, so a URL the person typed
 * themselves is left alone. #443: frames the injecting proxy's address (`previewUrl`) when one is up, so
 * click-to-source can read fiber data with nothing installed in the target app; falls back to the plain
 * `url` when the proxy isn't wired for this project's origin.
 */
export function usePreviewServerUrl({ connectTo, release }: Framing) {
  const last = useRef<string | null>(null);
  return useCallback(({ url, previewUrl, previewNonce }: DevServerUrlInfo) => {
    const framed = previewUrl ?? url;
    if (framed) {
      last.current = framed;
      connectTo(framed, previewUrl, previewNonce);
    } else if (last.current) {
      release(last.current);
      last.current = null;
    }
  }, [connectTo, release]);
}
