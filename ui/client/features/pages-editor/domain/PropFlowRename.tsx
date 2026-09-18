import type { PagesEditorNode } from '../types';

// Pure (DOMAIN-001) — #77 follow-up to #55/#75: cross-level prop rename
// tracing for the prop-flow diagram. Split out of PropFlowLayout.tsx
// (READ-002, ≤200 lines/file) since this is a self-contained concern:
// given the tree, find every place a prop was renamed while passing
// through an intermediate component, and expose a name -> canonical-group
// lookup so PropFlowLayout's color assignment can group renamed pill names
// together instead of purely by literal name.
//
// A node's own *received* attribute (how its parent named it, e.g.
// `title={label}`) and one of that same node's own *outgoing* attributes
// (how it names an identifier on one of its own JSX children, e.g.
// `value={label}`) refer to the same underlying value whenever both were
// supplied the exact same source identifier — even though neither
// attribute *name* matches the other, or the identifier itself. E.g.
// `<Middle title={label}><Grandchild value={label}/></Middle>`: Middle's
// own `title` attribute and the `value` attribute it hands down to
// Grandchild both resolve to the same `label` identifier, so `title` and
// `value` are the same traced value under two different names.

/** One (node, receivedName, outgoingAttrName) rename link found this way. */
export type RenameLink = { node: PagesEditorNode; receivedName: string; outgoingAttrName: string };

export function findRenameLinks(roots: PagesEditorNode[]): RenameLink[] {
  const links: RenameLink[] = [];
  const walk = (node: PagesEditorNode) => {
    // Which of this node's own received attribute names were supplied each
    // source identifier (usually one name per identifier, but nothing
    // stops the same identifier being passed under two attribute names).
    // `p.kind !== 'identifier'` already rules out a spread (the only kind
    // with a null `name`), but PropData isn't a discriminated union, so
    // TypeScript still sees `name: string | null` here — the `p.name ===
    // null` checks below are redundant at runtime but satisfy that.
    const receivedNamesByValue = new Map<string, string[]>();
    for (const p of node.props) {
      if (p.kind !== 'identifier' || typeof p.value !== 'string' || p.name === null) continue;
      if (!receivedNamesByValue.has(p.value)) receivedNamesByValue.set(p.value, []);
      receivedNamesByValue.get(p.value)!.push(p.name);
    }
    for (const child of node.children) {
      for (const p of child.props) {
        if (p.kind !== 'identifier' || typeof p.value !== 'string' || p.name === null) continue;
        const receivedNames = receivedNamesByValue.get(p.value);
        if (!receivedNames) continue;
        for (const receivedName of receivedNames) {
          if (receivedName !== p.name) links.push({ node, receivedName, outgoingAttrName: p.name });
        }
      }
      walk(child);
    }
  };
  for (const r of roots) walk(r);
  return links;
}

/** Small union-find over prop names, so a chain of rename links (however
 * many intermediate components deep) canonicalizes to one shared group —
 * used by PropFlowLayout to color renamed names identically. */
export class RenameUnionFind {
  private parent = new Map<string, string>();

  private find(name: string): string {
    let root = name;
    while (this.parent.has(root) && this.parent.get(root) !== root) root = this.parent.get(root)!;
    // Path compression.
    let cur = name;
    while (this.parent.has(cur) && this.parent.get(cur) !== root) {
      const next = this.parent.get(cur)!;
      this.parent.set(cur, root);
      cur = next;
    }
    return root;
  }

  union(a: string, b: string): void {
    if (!this.parent.has(a)) this.parent.set(a, a);
    if (!this.parent.has(b)) this.parent.set(b, b);
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }

  /** Canonical group name for `name`, or `name` itself if it was never
   * linked to anything (the common, non-renamed case). */
  canonical(name: string): string {
    return this.parent.has(name) ? this.find(name) : name;
  }
}

export function buildRenameUnionFind(links: RenameLink[]): RenameUnionFind {
  const uf = new RenameUnionFind();
  for (const link of links) uf.union(link.receivedName, link.outgoingAttrName);
  return uf;
}
