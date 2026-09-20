import type { ReactNode } from 'react';
import type { PagesEditorNode } from '../types';
import { PagesBrowser } from './PagesBrowser';
import { TreePanel } from './TreePanel';

type PagesBrowserTabProps = {
  feature: string;
  onFeatureChange: (feature: string) => void;
  features: string[];
  file: string;
  onOpen: (file: string) => void;
  files: string[];
  loading: boolean;
  roots: PagesEditorNode[] | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** 'files' (the default, unchanged) or 'flow' (#328). */
  view: 'files' | 'flow';
  /** The Files | Flow switch, supplied by the controller. */
  switcher: ReactNode;
  /** The Flow view (and a file opened from it), supplied by the controller. */
  flow: ReactNode;
};

// Browser-pane content of the Pages Editor: a Files | Flow switch, then either the feature/page picker with
// the open page's JSX tree beneath it (Files) or the feature's flow (Flow, #328). Presentation-only.
export function PagesBrowserTab({ roots, selectedId, onSelect, view, switcher, flow, ...browser }: PagesBrowserTabProps) {
  return (
    <div className="pe-browser">
      {switcher}
      {view === 'files' ? (
        <>
          <PagesBrowser {...browser} />
          {roots && <TreePanel roots={roots} selectedId={selectedId} onSelect={onSelect} />}
        </>
      ) : (
        <>
          <PagesBrowser {...browser} showPages={false} />
          {flow}
        </>
      )}
    </div>
  );
}
