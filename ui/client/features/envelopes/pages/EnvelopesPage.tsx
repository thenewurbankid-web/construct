import { ComposeStage } from '../components/ComposeStage';
import { EnvelopesList } from '../components/EnvelopesList';
import type { ComposeApi, EnvelopePreview, EnvelopesViewModel, FlowCatalogueEntry, RunApi, SaveApi } from '../types';

// Presentation-only: all state comes from the controller.
export function EnvelopesPage({
  view,
  onRun,
  onLoad,
  compose,
  catalogue,
  save,
  run,
  onOpenProcesses,
  previews,
  previewError,
  selected,
  onSelect,
}: {
  view: EnvelopesViewModel;
  onRun: () => void;
  onLoad: (name: string) => void;
  compose: ComposeApi;
  catalogue: FlowCatalogueEntry[];
  save: SaveApi;
  run: RunApi;
  onOpenProcesses: () => void;
  previews: EnvelopePreview[];
  previewError: string | null;
  selected: number | null;
  onSelect: (index: number | null) => void;
}) {
  return (
    <div className="ev-page">
      <EnvelopesList view={view} onRun={onRun} onLoad={onLoad} />
      <ComposeStage
        compose={compose}
        catalogue={catalogue}
        save={save}
        run={run}
        onOpenProcesses={onOpenProcesses}
        previews={previews}
        previewError={previewError}
        selected={selected}
        onSelect={onSelect}
      />
    </div>
  );
}
