import { EnvelopesList } from '../components/EnvelopesList';
import type { EnvelopesViewModel } from '../types';

// Presentation-only: all state comes from the controller.
export function EnvelopesPage({ view, onRun }: { view: EnvelopesViewModel; onRun: () => void }) {
  return (
    <div className="ev-page">
      <EnvelopesList view={view} onRun={onRun} />
    </div>
  );
}
