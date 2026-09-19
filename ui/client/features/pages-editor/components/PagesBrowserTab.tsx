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
};

// Browser-pane content of the Pages Editor: the feature/page picker with the open page's JSX tree beneath it.
export function PagesBrowserTab({ roots, selectedId, onSelect, ...browser }: PagesBrowserTabProps) {
  return (
    <div className="pe-browser">
      <PagesBrowser {...browser} />
      {roots && <TreePanel roots={roots} selectedId={selectedId} onSelect={onSelect} />}
    </div>
  );
}
