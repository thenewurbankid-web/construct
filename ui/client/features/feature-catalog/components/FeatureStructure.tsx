import type { ReactNode } from 'react';
import { StructureViewSwitch, type StructureView } from './StructureViewSwitch';
import './feature-catalog.css';

type Props = { view: StructureView; onChange: (view: StructureView) => void; tree: ReactNode; flow: ReactNode };

/** The switch plus whichever of the two already-rendered views (Tree, Flow) is chosen (#790). The choice
 * itself lives here, not in the controller (CONTROLLER-001: controllers only compose and wire). */
export function FeatureStructure({ view, onChange, tree, flow }: Props) {
  return (
    <div className="fc-structure" data-testid="fc-structure">
      <StructureViewSwitch view={view} onChange={onChange} />
      {view === 'tree' ? tree : flow}
    </div>
  );
}
