'use client';

import { useCallback } from 'react';
import '../components/envelopes.css';
import { buildEnvelopesView } from '../domain/EnvelopesView';
import { useCompose } from '../hooks/useCompose';
import { useEnvelopes } from '../hooks/useEnvelopes';
import { useFlowCatalogue } from '../hooks/useFlowCatalogue';
import { fetchFlow } from '../services/EnvelopesApi';
import { EnvelopesPage } from '../pages/EnvelopesPage';

/** The Envelopes tab of the Features screen's Browser pane (#395/#771): every named, reusable flow saved for
 * this project via `construct pipeline save` (#759), plus a compose center stage -- add/reorder/remove steps
 * from the real plan-flow catalogue (PLAN_FLOWS/block-flows.mjs, reusing the Plan screen's own
 * `/api/plan/context`), each step's Mechanical/AI provenance shown as a chip. Loading a saved flow's row
 * ("Load") seeds the draft with its steps. No save/run yet -- that is #772, a later slice. */
export function EnvelopesController() {
  const envelopes = useEnvelopes();
  const view = buildEnvelopesView(envelopes.state);
  const catalogue = useFlowCatalogue();
  const compose = useCompose();

  const onLoad = useCallback(
    (name: string) => {
      fetchFlow(name).then((r) => {
        if (r.ok) compose.loadFlow(r.name, r.steps);
      });
    },
    [compose],
  );

  return <EnvelopesPage view={view} onRun={envelopes.run} onLoad={onLoad} compose={compose} catalogue={catalogue.rows} />;
}
