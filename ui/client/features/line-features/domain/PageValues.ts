// Two modes: the parts the Features chat can open on a page: the names of the values a person can change without code
// (settable props of plain text, numbers or yes/no), each once, in page order. Pure.
import type { LinePageNode, LinePageTree } from '../types';

const PLAIN = new Set(['string', 'number', 'boolean']);

export function pageValues(tree: LinePageTree): string[] {
  const out: string[] = [];
  const walk = (node: LinePageNode) => {
    for (const p of node.settable ? node.props : []) if (p.name && PLAIN.has(p.kind) && !out.includes(p.name)) out.push(p.name);
    node.children.forEach(walk);
  };
  tree.roots.forEach(walk);
  return out;
}
