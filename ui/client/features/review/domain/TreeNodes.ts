// Pure (DOMAIN-001): the changed-units tree as data (#351). The screen shows the same files three ways (by feature
// then layer, by layer, flat); each is ONE list of nodes that the component only draws. The keyboard model over
// them is TreeNav.ts.
import type { FeatureGroup, LayerView, TreeFile, TreeGrouping, TreeNodeView } from '../types.ts';

const fileNode = (grouping: TreeGrouping, file: TreeFile, showLayer: boolean): TreeNodeView => ({
  id: `${grouping}|file:${file.path}`, kind: 'file', label: file.name, count: null, file, showLayer, testId: 'review-file', data: { 'data-path': file.path }, children: [],
});

/** The nodes of the tree for one grouping. Every id is unique, and prefixed by the grouping so each view keeps its own open/closed state. */
export function buildTreeNodes(grouping: TreeGrouping, byFeature: FeatureGroup[], byLayer: LayerView[], flat: TreeFile[]): TreeNodeView[] {
  if (grouping === 'files') return flat.map((f) => fileNode(grouping, f, true));
  if (grouping === 'layer') {
    return byLayer.map((l) => ({
      id: `layer|${l.layer}`, kind: 'layer', label: l.label, count: l.fileCount, file: null, showLayer: false, testId: 'review-layer-group', data: { 'data-layer': l.layer },
      children: l.files.map((f) => fileNode(grouping, f, false)),
    }));
  }
  return byFeature.map((f) => ({
    id: `feature|${f.key}`, kind: 'feature', label: f.label, count: f.fileCount, file: null, showLayer: false, testId: 'review-feature', data: { 'data-feature': f.name || 'outside' },
    children: f.layers.map((l) => ({
      id: `feature|${f.key}|layer:${l.layer}`, kind: 'layer', label: l.label, count: l.files.length, file: null, showLayer: false, testId: 'review-layer', data: { 'data-layer': l.layer },
      children: l.files.map((file) => fileNode(grouping, file, false)),
    })),
  }));
}

/** The node with this id, anywhere in the tree. */
export function findNode(nodes: TreeNodeView[], id: string): TreeNodeView | null {
  for (const n of nodes) {
    if (n.id === id) return n;
    const inner = findNode(n.children, id);
    if (inner) return inner;
  }
  return null;
}

/** The file row for a path in this grouping (a file appears once per grouping). */
export function findFileNode(nodes: TreeNodeView[], path: string | null): TreeNodeView | null {
  if (!path) return null;
  for (const n of nodes) {
    if (n.file?.path === path) return n;
    const inner = findFileNode(n.children, path);
    if (inner) return inner;
  }
  return null;
}
