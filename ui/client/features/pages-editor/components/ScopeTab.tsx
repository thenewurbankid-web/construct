import type { PagesEditorNode } from '../types';
import { ScopePanel } from './ScopePanel';

type ScopeTabProps = { feature: string; file: string; node: PagesEditorNode | null; contentHash: string };

// Tools-pane "Scope" tab: the selected element's scope links, with a plain-language empty state.
export function ScopeTab({ feature, file, node, contentHash }: ScopeTabProps) {
  if (!node) return <p className="hint">Select a tree node or preview element to see which page values flow into it.</p>;
  if (node.isFragment) return <p className="hint">Fragments have no props, so there are no scope links.</p>;
  return <ScopePanel feature={feature} file={file} nodeId={node.id} contentHash={contentHash} />;
}
