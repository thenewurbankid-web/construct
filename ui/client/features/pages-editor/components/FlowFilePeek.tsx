'use client';

import type { NavReference, TrailItem, TrailStep } from '../types';
import { LinkedCode } from './LinkedCode';
import { ReferenceTrail } from './ReferenceTrail';

type FlowFilePeekProps = {
  steps: TrailStep[];
  index: number;
  items: TrailItem[];
  current: TrailStep | null;
  loading: boolean;
  error: string | null;
  hopError: string | null;
  onFollow: (ref: NavReference) => void;
  onBack: () => void;
  onForward: () => void;
  onSelect: (index: number) => void;
  onClose: () => void;
};

// A file opened from the Flow view (Ctrl/Cmd-click on a row, #328). It is the SAME navigation as the Pages
// editor's Navigate panel (#321): the same trail and the same links, whose references resolve on the server.
// Only the first view differs: a file the flow drew instead of a page. Presentation-only.
export function FlowFilePeek({ steps, index, items, current, loading, error, hopError, onFollow, onBack, onForward, onSelect, onClose }: FlowFilePeekProps) {
  return (
    <div className="flow-peek" data-testid="flow-peek">
      <div className="navigator-header">
        <h4>Opened from Flow</h4>
        <button type="button" className="ref-trail-nav" aria-label="Close opened file" onClick={onClose}>×</button>
      </div>
      {loading && <p className="hint">Reading references...</p>}
      {error && <p className="status-error">{error}</p>}
      {current && (
        <>
          <ReferenceTrail steps={steps} index={index} items={items} onSelect={onSelect} onBack={onBack} onForward={onForward} />
          <div className="navigator-file" data-testid="flow-peek-file">{current.view.path}</div>
          {hopError && <p className="status-error">{hopError}</p>}
          <LinkedCode source={current.view.source} references={current.view.references} onFollow={onFollow} label={`Source of ${current.view.path}`} />
        </>
      )}
    </div>
  );
}
