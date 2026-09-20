import type { FlowController, FlowData, FlowNode, FlowRow } from '../types.ts';

const BRANCHES = [
  ['behaviour', 'Behaviour path'],
  ['render', 'Render path'],
  ['other', 'Other imports'],
] as const;

/** `features/orders/hooks/useOrders.ts` -> `useOrders`. */
export function fileLabel(file: string): string {
  const name = file.slice(file.lastIndexOf('/') + 1);
  return name.replace(/\.(tsx?|jsx?|mjs|cjs)$/, '');
}

function countNodes(nodes: FlowNode[]): number {
  return nodes.reduce((n, node) => n + 1 + countNodes(node.children ?? []), 0);
}

function nodeRows(nodes: FlowNode[], parentId: string, depth: number, owner: string, out: FlowRow[]): void {
  nodes.forEach((node, i) => {
    const id = `${parentId}>${i}:${node.file}`;
    const children = node.children ?? [];
    out.push({ id, kind: 'node', depth, parentId, label: fileLabel(node.file), layer: node.layer, file: node.file, feature: node.feature ?? owner, foreign: node.feature !== undefined && node.feature !== owner, shownAbove: node.shownAbove === true, hasChildren: children.length > 0, count: 0 });
    nodeRows(children, id, depth + 1, owner, out);
  });
}

function controllerRows(c: FlowController, parentId: string, index: number, feature: string, out: FlowRow[]): void {
  const id = `${parentId}>c${index}:${c.file}`;
  const branches = BRANCHES.map(([key, title]) => ({ key, title, nodes: c[key] ?? [] })).filter((b) => b.nodes.length > 0);
  out.push({ id, kind: 'controller', depth: 1, parentId, label: fileLabel(c.file), layer: 'controller', file: c.file, feature, shownAbove: false, foreign: false, hasChildren: branches.length > 0, count: 0 });
  for (const b of branches) {
    const branchId = `${id}>${b.key}`;
    out.push({ id: branchId, kind: 'branch', depth: 2, parentId: id, label: b.title, layer: 'branch', file: null, feature, shownAbove: false, foreign: false, hasChildren: true, count: countNodes(b.nodes) });
    nodeRows(b.nodes, branchId, 3, feature, out);
  }
}

/** Every row of the flow tree, in drawing order and fully expanded: a route, then per feature (in the
 * route file's import order) each controller with its Behaviour path and Render path beneath it. */
export function flowRows(data: FlowData): FlowRow[] {
  const out: FlowRow[] = [];
  data.routes.forEach((route, r) => {
    const id = `r${r}:${route.route}`;
    const controllers = route.features.reduce((n, f) => n + f.controllers.length, 0);
    out.push({ id, kind: 'route', depth: 0, parentId: null, label: route.route, layer: 'route', file: route.file, feature: null, shownAbove: false, foreign: false, hasChildren: controllers > 0, count: route.features.length });
    route.features.forEach((f, fi) => f.controllers.forEach((c, ci) => controllerRows(c, id, fi * 100 + ci, f.feature, out)));
  });
  return out;
}

/** The rows that are drawn: everything under a collapsed row is left out. */
export function visibleRows(rows: FlowRow[], collapsed: string[]): FlowRow[] {
  const hidden = new Set(collapsed);
  const skip = new Set<string>();
  return rows.filter((row) => {
    const parentHidden = row.parentId !== null && (hidden.has(row.parentId) || skip.has(row.parentId));
    if (parentHidden) skip.add(row.id);
    return !parentHidden;
  });
}
