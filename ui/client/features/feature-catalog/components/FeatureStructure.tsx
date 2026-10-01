import type { ReactNode } from 'react';
import { LivePreviewPanel, type LivePreviewView } from '@/features/live-preview';
import { StructureViewSwitch, type StructureView } from './StructureViewSwitch';
import './feature-catalog.css';

type Props = {
  view: StructureView;
  onChange: (view: StructureView) => void;
  tree: ReactNode;
  flow: ReactNode;
  /** #840 -- "Preview beside": off by default (design 8's "preview is optional outside Pages/Components"). */
  previewOn: boolean;
  onTogglePreview: () => void;
  previewView: LivePreviewView;
};

/** The switch plus whichever of the two already-rendered views (Tree, Flow) is chosen (#790). The choice
 * itself lives here, not in the controller (CONTROLLER-001: controllers only compose and wire). */
export function FeatureStructure({ view, onChange, tree, flow, previewOn, onTogglePreview, previewView }: Props) {
  const content = view === 'tree' ? tree : flow;
  return (
    <div className="fc-structure" data-testid="fc-structure">
      <div className="fc-structure-head">
        <StructureViewSwitch view={view} onChange={onChange} />
        <button type="button" className="dg-btn" aria-pressed={previewOn} data-testid="fc-preview-toggle" onClick={onTogglePreview}>
          Preview beside
        </button>
      </div>
      {previewOn ? (
        <div className="fc-split">
          <div className="fc-split-main">{content}</div>
          <div className="fc-split-preview" data-testid="fc-preview-beside">
            <LivePreviewPanel {...previewView} />
          </div>
        </div>
      ) : (
        content
      )}
    </div>
  );
}
