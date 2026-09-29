'use client';

import { useCallback, useState } from 'react';
import '../components/envelopes.css';
import { buildEnvelopesView } from '../domain/EnvelopesView';
import { useCompose } from '../hooks/useCompose';
import { useEnvelopePreviews } from '../hooks/useEnvelopePreviews';
import { useEnvelopes } from '../hooks/useEnvelopes';
import { useFlowCatalogue } from '../hooks/useFlowCatalogue';
import { useRun } from '../hooks/useRun';
import { useSave } from '../hooks/useSave';
import { fetchFlow } from '../services/EnvelopesApi';
import { EnvelopesPage } from '../pages/EnvelopesPage';

/** The Envelopes tab of the Features screen's Browser pane (#395/#771/#772): every named, reusable flow saved
 * for this project via `construct pipeline save` (#759); a compose center stage -- add/reorder/remove steps
 * from the real plan-flow catalogue (reusing the Plan screen's own `/api/plan/context`), each step's
 * Mechanical/AI provenance shown as a chip, "Load" seeding the draft from a saved flow; a per-step envelope
 * preview (schemas/envelope.v1.json's input shape, computed deterministically -- no generator runs);
 * "Save this flow" as a preview/confirm write through #759's saveFlow; and "Run this flow" through the same
 * Process/Approvals path Plan mode's "Run plan" uses -- never a new or bypass execution mechanism.
 *
 * `onOpenProcesses` comes in as a prop (see EnvelopesShellTab.tsx) rather than `useShellDrawer()` here: this
 * component renders inside the Browser pane's tab slot, which sits outside `ShellDrawerContext.Provider`. */
export function EnvelopesController({ onOpenProcesses }: { onOpenProcesses: () => void }) {
  const envelopes = useEnvelopes();
  const view = buildEnvelopesView(envelopes.state);
  const catalogue = useFlowCatalogue();
  const compose = useCompose();
  const save = useSave(compose.state.steps, envelopes.run);
  const run = useRun(compose.state.loadedFrom ?? (save.state.name.trim() || null), compose.state.steps, onOpenProcesses);
  const { previews, error: previewError } = useEnvelopePreviews(compose.state.steps);
  const [selected, setSelected] = useState<number | null>(null);

  const onLoad = useCallback(
    (name: string) => {
      fetchFlow(name).then((r) => {
        if (r.ok) compose.loadFlow(r.name, r.steps);
      });
      setSelected(null);
    },
    [compose],
  );

  return (
    <EnvelopesPage
      view={view}
      onRun={envelopes.run}
      onLoad={onLoad}
      compose={compose}
      catalogue={catalogue.rows}
      save={save}
      run={run}
      onOpenProcesses={onOpenProcesses}
      previews={previews}
      previewError={previewError}
      selected={selected}
      onSelect={setSelected}
    />
  );
}
