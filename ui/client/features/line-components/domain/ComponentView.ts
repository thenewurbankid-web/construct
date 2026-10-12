// Pure (DOMAIN-001): what the Components editor shows, from the server's LineComponentEditor and a step's answer.
import type { ComponentDiagram, DiagramLayout, EditorNotice, EditorTab, LineComponentEditor, RefusalView, StateGraph, StepAnswer } from '../types.ts';

/** The tabs, in order, with their labels. */
export const EDITOR_TABS: readonly { id: EditorTab; label: string }[] = Object.freeze([
  { id: 'behaviour', label: 'Behaviour' },
  { id: 'events', label: 'Events' },
  { id: 'states', label: 'States' },
]);

/** A tab id from the URL, or Behaviour. */
export const tabOf = (raw: string | null): EditorTab => (raw === 'events' || raw === 'states' ? raw : 'behaviour');

/** A behaviour's state graph laid out by the shared workflow diagram layout, with the current state marked. */
export function stateGraph(d: ComponentDiagram, layout: DiagramLayout): StateGraph {
  const placed = layout({ states: d.states, transitions: d.transitions, initial: d.initial });
  const at = new Map(placed.nodes.map((n) => [n.id, n]));
  const nodes = d.states.flatMap((s) => {
    const n = at.get(s.id);
    return n ? [{ id: s.id, label: s.label, sentence: s.sentence, x: n.x, y: n.y, w: n.w, h: n.h, initial: s.initial, current: s.id === d.current }] : [];
  });
  const text = [`Now: ${d.states.find((s) => s.id === d.current)?.label ?? d.current}.`, ...d.transitions.map((t) => `From ${t.from}, ${t.event.toLowerCase()} goes to ${t.to}.`)];
  return { nodes, edges: placed.edges.map((e) => ({ id: e.id, d: e.d, label: e.label, lx: e.lx, ly: e.ly })), width: placed.width, height: placed.height, text };
}

/** A step's answer as the notice under the editor: the step's sentence, or the refusal with its typed fixes. */
export function noticeOf(a: StepAnswer): EditorNotice {
  if (a.ok) return { ok: true, sentence: a.sentence };
  const refusal: RefusalView = {
    sentence: a.sentence,
    code: a.code ?? null,
    fixes: (a.fixes ?? []).flatMap((f) => (f.step ? [{ id: f.id, label: f.sentence, step: { tool: f.step.tool, args: { ...f.step.args } }, recommended: f.rank === 1 }] : [])),
  };
  return { ok: false, refusal };
}

/** The editor's heading line: what the component is and where it comes from. */
export function headline(c: LineComponentEditor): string {
  if (c.kind === 'library') return `${c.name}: a library component.`;
  return `${c.name}: a component of ${c.feature ?? 'a feature'}${c.baseName ? `, based on ${c.baseName}` : ''}.`;
}

/** A suggested name for a new component: the feature and the library name (orders + Disclosure = OrdersDisclosure). */
export function suggestName(feature: string, libraryName: string): string {
  if (!feature) return libraryName;
  return `${feature.charAt(0).toUpperCase()}${feature.slice(1)}${libraryName}`;
}

/** Whether the New component form can be sent: a library item, a feature and a name that reads as a component. */
export const canCreate = (libraryId: string, feature: string, name: string): boolean => Boolean(libraryId && feature && /^[A-Z][A-Za-z0-9]*$/.test(name.trim()));
