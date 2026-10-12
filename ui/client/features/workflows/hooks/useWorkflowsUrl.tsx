'use client';

import { useEffect } from 'react';
import { announcePlace } from '@/lib/urlPlace';

/** Two modes: the feature and workflow file picked Under the hood go into the URL (?feature=, ?file=, the Workflows
 * chat's levels), so the chat and its breadcrumb follow. Nothing is written until a feature is picked. */
export function useWorkflowsUrl(feature: string, file: string) {
  useEffect(() => {
    if (!feature) return;
    const q = new URLSearchParams(window.location.search);
    if (q.get('feature') === feature && (q.get('file') ?? '') === file) return;
    q.set('feature', feature);
    if (file) q.set('file', file);
    else q.delete('file');
    window.history.replaceState(null, '', `${window.location.pathname}?${q.toString()}${window.location.hash}`);
    announcePlace();
  }, [feature, file]);
}
