'use client';

import { useEffect, useState } from 'react';
import type { ComponentType } from 'react';
import type { ThreadmarkFeedback, ThreadmarkFeedbackContext, ThreadmarkProps } from 'threadmark-react';
import { loadReviewOverlay } from '../services/ReviewOverlayLoader';

/**
 * Mounts the threadmark-react design-review overlay -- dev-only design-review annotation tool
 * (#454). Renders nothing, and never imports the package, unless NEXT_PUBLIC_REVIEW_OVERLAY=1 is
 * set (never true for the hosted build). Mount once, near the app root (see app/layout.tsx).
 *
 * Feedback stays local: threadmark-react keeps annotations and screenshot evidence in this
 * browser's memory only. Nothing here persists or transmits them -- a reviewer uses the overlay's
 * own "C" keyboard shortcut (once Review mode is on, Command/Ctrl+Shift+F) to copy the current
 * annotations as structured Markdown when they want to paste them somewhere. See
 * docs/design/README.md.
 */
export function ReviewOverlayController() {
  const [Overlay, setOverlay] = useState<ComponentType<ThreadmarkProps> | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadReviewOverlay().then((mod) => {
      if (!cancelled && mod) setOverlay(() => mod.Threadmark);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!Overlay) return null;

  const handleFeedbackCreate = (feedback: ThreadmarkFeedback, _context: ThreadmarkFeedbackContext) => {
    // Local only -- see the module comment. No storage, no network call.
    console.info('[design-review] feedback captured locally (not persisted, not sent anywhere)', feedback);
  };

  return (
    <Overlay
      projectKey="construct-cockpit-dev"
      environment="local"
      onFeedbackCreate={handleFeedbackCreate}
      onError={(error) => console.error('[design-review] overlay error', error)}
    />
  );
}
