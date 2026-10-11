import type { CodeFragment, LinePageNode, LinePageTree, PagePart, PartProp } from '../types';

function editableProps(node: LinePageNode): PartProp[] {
  const props: PartProp[] = [];
  for (const p of node.settable ? node.props : []) {
    if (!p.name) continue;
    if (p.kind === 'string' && typeof p.value === 'string') props.push({ name: p.name, kind: 'string', value: p.value });
    else if (p.kind === 'number' && typeof p.value === 'number') props.push({ name: p.name, kind: 'number', value: p.value });
    else if (p.kind === 'boolean' && typeof p.value === 'boolean') props.push({ name: p.name, kind: 'boolean', value: p.value });
  }
  return props;
}

/** The parts of a page, depth first, each with the props a person can change without code (plain text, numbers,
 * yes/no). Props written as code (identifiers, expressions, spreads) are left to "View/edit code"; fragments are
 * not parts (their children are). */
export function pageParts(tree: LinePageTree): PagePart[] {
  const out: PagePart[] = [];
  const walk = (node: LinePageNode, depth: number) => {
    if (!node.isFragment) out.push({ nodeId: node.id, tag: node.tag, depth, props: editableProps(node) });
    for (const c of node.children) walk(c, node.isFragment ? depth : depth + 1);
  };
  for (const r of tree.roots) walk(r, 0);
  return out;
}

/** The value typed into an input, as the prop's own kind. Null when it cannot be one (e.g. "abc" for a number). */
export function coerceValue(kind: PartProp['kind'], raw: string | boolean): string | number | boolean | null {
  if (kind === 'boolean') return typeof raw === 'boolean' ? raw : raw === 'true';
  if (kind === 'number') {
    const n = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : NaN;
    return Number.isFinite(n) ? n : null;
  }
  return String(raw);
}

/** The parts with the code fragments that sit on each (by page-tree id); a part with none is left as it is. */
export function withFragments(parts: PagePart[], fragments: CodeFragment[]): PagePart[] {
  return parts.map((part) => {
    const own = fragments.filter((f) => f.nodeId === part.nodeId);
    return own.length ? { ...part, fragments: own } : part;
  });
}
