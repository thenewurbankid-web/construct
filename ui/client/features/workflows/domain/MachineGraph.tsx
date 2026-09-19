import dagre from '@dagrejs/dagre';
import type { WorkflowMachine } from '../types';

// Pure (DOMAIN-001) — turns one extracted machine into React Flow's
// node/edge model. Positions come from a layered left-to-right layout
// (dagre, MIT) computed from the machine itself on every call and never
// persisted — same "zero metadata on disk" contract as the visual JSX
// composer (#119). Edge labels are laid out as real boxes (#217), so two
// labels can't land on top of each other; dagre has no randomness, so the
// same source always gives the same picture.

export const START_NODE_ID = '__start__';
const NODE_WIDTH = 150;
const START_SIZE = 14;
const LABEL_HEIGHT = 20;
const CHAR_WIDTH = 6.4; // 11px UI font, generous
const MONO_CHAR = 6.2; // 10px monospace lines inside a node
const ARROW = { type: 'arrowclosed' } as const;

export type StateNodeData = {
  label: string;
  path: string;
  kind: 'state' | 'start' | 'missing';
  initial: boolean;
  final: boolean;
  compound: boolean;
  /** Transitions that don't move anywhere else visible: self-loops and
   * targetless (actions-only) handlers, listed on the node itself. */
  internal: string[];
  width: number;
};

export type StateNode = { id: string; type: 'stateNode'; position: { x: number; y: number }; data: StateNodeData };

export type TransitionEdge = {
  id: string;
  source: string;
  target: string;
  sourceHandle: string;
  targetHandle: string;
  label: string;
  markerEnd: { type: 'arrowclosed' };
  reconnectable: boolean;
  type: 'flowEdge';
  style?: Record<string, string | number>;
  data: {
    event: string;
    guard?: string;
    kind: string;
    from: string;
    editable: boolean;
    /** Route computed by the layout (start .. end, label point in the middle). */
    points: { x: number; y: number }[];
    /** Where the label sits, centred — the layout reserved this box for it. */
    labelX: number;
    labelY: number;
  };
};

/** Human label for one transition: `EVENT [guard]`, with a kind prefix for
 * the non-`on` forms (after/always/onDone/invoke). */
export function transitionLabel(t: { event: string; guard?: string; kind: string }): string {
  const base = t.kind === 'after' ? `after ${t.event}ms` : t.event;
  return t.guard ? `${base} [${t.guard}]` : base;
}

function nodeSize(label: string, internal: string[], tags: number): { width: number; height: number } {
  const widest = Math.max(label.length * 7.4 + 24, ...internal.map((l) => l.length * MONO_CHAR + 24));
  const width = Math.max(NODE_WIDTH, Math.ceil(widest));
  const height = 34 + (tags ? 12 : 0) + internal.length * 16;
  return { width, height };
}

export function buildMachineFlow(machine: WorkflowMachine): { nodes: StateNode[]; edges: TransitionEdge[] } {
  if (machine.error || machine.states.length === 0) return { nodes: [], edges: [] };

  const paths = new Set(machine.states.map((s) => s.path));
  const missing = [...new Set(machine.transitions.filter((t) => t.unresolved && t.rawTarget).map((t) => t.rawTarget as string))];

  const internalByState = new Map<string, string[]>();
  for (const t of machine.transitions) {
    if (t.targetless || t.target === t.from) {
      const list = internalByState.get(t.from) || [];
      list.push(`${t.target === t.from ? '↻ ' : '• '}${transitionLabel(t)}`);
      internalByState.set(t.from, list);
    }
  }

  // Every state, the unresolved-target placeholders and the start dot are
  // layout nodes; every transition (with its label) is a layout edge.
  const sizes = new Map<string, { width: number; height: number }>();
  const nodes: StateNode[] = [];
  if (machine.initial) {
    sizes.set(START_NODE_ID, { width: START_SIZE, height: START_SIZE });
    nodes.push({
      id: START_NODE_ID,
      type: 'stateNode',
      position: { x: 0, y: 0 },
      data: { label: '', path: START_NODE_ID, kind: 'start', initial: false, final: false, compound: false, internal: [], width: START_SIZE },
    });
  }
  for (const s of machine.states) {
    const internal = internalByState.get(s.path) || [];
    const size = nodeSize(s.path, internal, Number(s.initial) + Number(s.final) + Number(s.type === 'compound'));
    sizes.set(s.path, size);
    nodes.push({
      id: s.path,
      type: 'stateNode',
      position: { x: 0, y: 0 },
      data: { label: s.path, path: s.path, kind: 'state', initial: s.initial, final: s.final, compound: s.type === 'compound', internal, width: size.width },
    });
  }
  for (const raw of missing) {
    const id = `missing:${raw}`;
    const size = nodeSize(`? ${raw}`, [], 1);
    sizes.set(id, size);
    nodes.push({
      id,
      type: 'stateNode',
      position: { x: 0, y: 0 },
      data: { label: `? ${raw}`, path: raw, kind: 'missing', initial: false, final: false, compound: false, internal: [], width: size.width },
    });
  }

  type Pending = Omit<TransitionEdge, 'data' | 'type'> & { data: Omit<TransitionEdge['data'], 'points' | 'labelX' | 'labelY'> };
  const pending: Pending[] = [];
  if (machine.initial) {
    pending.push({ id: 'start', source: START_NODE_ID, target: machine.initial, sourceHandle: 'out-r', targetHandle: 'in-l', label: '', markerEnd: ARROW, reconnectable: false, data: { event: '', kind: 'start', from: '', editable: false } });
  }
  for (const s of machine.states) {
    if (s.parent && s.initial) {
      pending.push({
        id: `init:${s.path}`, source: s.parent, target: s.path, sourceHandle: 'out-r', targetHandle: 'in-l', label: 'initial', markerEnd: ARROW,
        style: { strokeDasharray: '4 3' }, reconnectable: false, data: { event: 'initial', kind: 'initial', from: s.parent, editable: false },
      });
    }
  }
  machine.transitions.forEach((t, i) => {
    if (t.targetless || t.target === t.from) return;
    const target = t.target ?? `missing:${t.rawTarget}`;
    if (!paths.has(t.from)) return;
    pending.push({
      id: `t${i}:${t.from}:${t.event}:${target}`,
      source: t.from,
      target,
      sourceHandle: 'out-r',
      targetHandle: 'in-l',
      label: transitionLabel(t),
      markerEnd: ARROW,
      style: t.unresolved ? { strokeDasharray: '2 4' } : undefined,
      reconnectable: !!t.editable,
      data: { event: t.event, guard: t.guard, kind: t.kind, from: t.from, editable: !!t.editable },
    });
  });

  const g = new dagre.graphlib.Graph({ multigraph: true });
  g.setGraph({ rankdir: 'LR', nodesep: 34, ranksep: 56, edgesep: 20, marginx: 10, marginy: 10 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const [id, size] of sizes) g.setNode(id, size);
  for (const e of pending) {
    if (!sizes.has(e.source) || !sizes.has(e.target)) continue;
    const w = e.label ? Math.ceil(e.label.length * CHAR_WIDTH + 14) : 0;
    g.setEdge(e.source, e.target, { width: w, height: e.label ? LABEL_HEIGHT : 0, labelpos: 'c' }, e.id);
  }
  dagre.layout(g);

  for (const n of nodes) {
    const p = g.node(n.id);
    const size = sizes.get(n.id)!;
    n.position = { x: p.x - size.width / 2, y: p.y - size.height / 2 };
  }

  const edges: TransitionEdge[] = [];
  for (const e of pending) {
    if (!sizes.has(e.source) || !sizes.has(e.target)) continue;
    const laid = g.edge(e.source, e.target, e.id);
    const backward = g.node(e.target).x < g.node(e.source).x;
    edges.push({
      ...e,
      type: 'flowEdge',
      // Loop-backs leave the left side and enter the right side, so the
      // route never doubles back through the node it starts from.
      sourceHandle: backward ? 'out-l' : e.sourceHandle,
      targetHandle: backward ? 'in-r' : e.targetHandle,
      data: { ...e.data, points: laid.points, labelX: laid.x ?? laid.points[Math.floor(laid.points.length / 2)].x, labelY: laid.y ?? laid.points[Math.floor(laid.points.length / 2)].y },
    });
  }
  return { nodes, edges };
}
