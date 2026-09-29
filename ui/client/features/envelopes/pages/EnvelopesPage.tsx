import { ComposeStage } from '../components/ComposeStage';
import { EnvelopesList } from '../components/EnvelopesList';
import type { ComposeApi, EnvelopesViewModel, FlowCatalogueEntry } from '../types';

// Presentation-only: all state comes from the controller.
export function EnvelopesPage({
  view,
  onRun,
  onLoad,
  compose,
  catalogue,
}: {
  view: EnvelopesViewModel;
  onRun: () => void;
  onLoad: (name: string) => void;
  compose: ComposeApi;
  catalogue: FlowCatalogueEntry[];
}) {
  return (
    <div className="ev-page">
      <EnvelopesList view={view} onRun={onRun} onLoad={onLoad} />
      <ComposeStage compose={compose} catalogue={catalogue} />
    </div>
  );
}
