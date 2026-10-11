'use client';

import { useLineDraft } from '../hooks/useLineDraft';
import { LineDraftPage } from '../pages/LineDraftPage';

/** The drafter box for a screen with a Plan panel; `onAdded` re-reads the plan after a route's steps joined it. Shows
 * nothing while the drafter is off on the server (LINE_DRAFTER unset). */
export function LineDraftController({ onAdded }: { onAdded: () => void }) {
  return <LineDraftPage draft={useLineDraft(onAdded)} />;
}
