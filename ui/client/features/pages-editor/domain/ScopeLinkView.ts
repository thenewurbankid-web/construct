// Pure (DOMAIN-001) — maps the server's scope/binding graph (core `buildScopeLinks`, #223) to a view
// model: a left column of the page's in-scope declarations, a right column of the selected element's
// props, colour-coded edges between them, and a list of flags. No layout pixels, no React: any
// renderer (the SVG ScopeLinkGraph today, xyflow or a table tomorrow) can consume it.
// Only type-level imports, so it can be unit-tested with plain Node (types are erased).
import type { ScopeEdge, ScopeFlag, ScopeLinkGraph, ScopeSourceItem, ScopeTargetItem, ScopeView } from '../types';

const PALETTE = ['#5b8cff', '#3fae5a', '#d98c2b', '#e05a5a', '#b25be0', '#2bc4d9', '#e0c62b', '#e05ba0'];

/** Colour for the n-th scope declaration (stable: follows declaration order). */
export function scopeColor(index: number): string {
  return PALETTE[index % PALETTE.length];
}

export function buildScopeView(graph: ScopeLinkGraph): ScopeView {
  const colorOf = new Map(graph.scope.map((d, i) => [d.name, scopeColor(i)]));
  const declared = graph.childProps ? new Set(graph.childProps.map((c) => c.name)) : null;
  const undeclared = new Set(graph.undeclared);
  const linkedNames = new Set(graph.links.flatMap((l) => l.from.map((f) => f.name)));
  const unusedInPage = new Set(graph.unusedScope);

  const sources: ScopeSourceItem[] = graph.scope.map((d) => ({
    name: d.name,
    kind: d.kind,
    color: colorOf.get(d.name) as string,
    linked: linkedNames.has(d.name),
    unusedInPage: unusedInPage.has(d.name),
  }));

  const targets: ScopeTargetItem[] = graph.links.map((l) => {
    const first = l.from[0];
    return {
      prop: l.prop,
      status: undeclared.has(l.prop) ? 'undeclared' : l.from.length > 0 || l.valueKind !== 'literal' ? 'bound' : 'literal',
      text: l.valueKind === 'literal' ? JSON.stringify(l.text) : l.text,
      color: first ? colorOf.get(first.name) ?? null : null,
      declared: declared ? declared.has(l.prop) : true,
    };
  });
  const passed = new Set(graph.links.map((l) => l.prop));
  for (const c of graph.childProps ?? []) {
    if (passed.has(c.name)) continue;
    targets.push({ prop: c.name, status: c.status === 'spread' ? 'spread' : 'unbound', text: '', color: null, declared: true });
  }

  const edges: ScopeEdge[] = [];
  for (const l of graph.links) {
    for (const f of l.from) edges.push({ from: f.name, to: l.prop, color: colorOf.get(f.name) as string });
  }

  const flags: ScopeFlag[] = [];
  for (const t of targets) {
    if (t.status === 'unbound') {
      const hint = graph.suggestions.includes(t.prop) ? ` — "${t.prop}" is in scope, wire it with auto-map` : '';
      flags.push({ level: 'warn', text: `Unbound prop "${t.prop}": the component declares it but nothing is passed${hint}` });
    }
    if (t.status === 'undeclared') flags.push({ level: 'warn', text: `Prop "${t.prop}" is passed but the component does not declare it` });
  }
  if (graph.isCustomComponent && !graph.childPropsResolved) {
    flags.push({ level: 'info', text: "The component's own props could not be resolved, so unbound props cannot be listed." });
  }
  for (const s of sources) {
    if (s.unusedInPage) flags.push({ level: 'info', text: `"${s.name}" is declared but never passed to any element` });
  }

  return { tag: graph.tag, sources, targets, edges, flags, childPropsResolved: graph.childPropsResolved };
}
