'use client';

import { useEffect, useState } from 'react';
import { previewEnvelopes } from '../services/EnvelopesApi';
import type { ComposeStep, EnvelopePreview } from '../types';

/** The envelope each step of the draft would receive (#395/#772), recomputed whenever the draft's steps
 * change. Empty steps means nothing to preview -- no request. */
export function useEnvelopePreviews(steps: ComposeStep[]): { previews: EnvelopePreview[]; error: string | null } {
  const [previews, setPreviews] = useState<EnvelopePreview[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (steps.length === 0) {
      setPreviews([]);
      setError(null);
      return;
    }
    let cancelled = false;
    previewEnvelopes(steps).then((r) => {
      if (cancelled) return;
      if (r.ok) {
        setPreviews(r.previews);
        setError(null);
      } else {
        setError(r.error);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [steps]);

  return { previews, error };
}
