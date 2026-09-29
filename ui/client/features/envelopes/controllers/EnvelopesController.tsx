'use client';

import '../components/envelopes.css';
import { buildEnvelopesView } from '../domain/EnvelopesView';
import { useEnvelopes } from '../hooks/useEnvelopes';
import { EnvelopesPage } from '../pages/EnvelopesPage';

/** The Envelopes tab of the Features screen's Browser pane (#395/#771): every named, reusable flow saved
 * for this project via `construct pipeline save` (#759), read-only. Compose (add/reorder/remove steps, a
 * step picker grounded in PLAN_FLOWS with Mechanical/AI provenance) and save/run are #772, a later slice. */
export function EnvelopesController() {
  const envelopes = useEnvelopes();
  const view = buildEnvelopesView(envelopes.state);
  return <EnvelopesPage view={view} onRun={envelopes.run} />;
}
