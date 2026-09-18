import type { WorkflowMachine } from '../types';

// Pure (DOMAIN-001) — turns one extracted machine into React Flow's
// node/edge model. Positions are a deterministic layered layout computed
// from the machine itself on every call (BFS depth from the initial state
// = column, order within a column = row) and never persisted — same
// "zero metadata on disk" contract as the visual JSX composer (#119).

export const START_NODE_ID = '__start__';
const COL_WIDTH = 230;
const ROW_HEIGHT = 96;
const NODE_WIDTH = 150;
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
  style?: Record<string, string | number>;
  data: { event: string; guard?: string; kind: string };
};

/** Human label for one transition: `EVENT [guard]`, with a kind prefix for
 * the non-`on` forms (after/always/onDone/invoke). */
export function transitionLabel(t: { event: string; guard?: string; kind: string }): string {
  const base = t.kind === 'after' ? `after ${t.event}ms` : t.event;
  return t.guard ? `${base} [${t.guard}]` : base;
}

export function buildMachineFlow(machine: WorkflowMachine): { nodes: StateNode[]; edges: TransitionEdge[] } {
  if (machine.error || machine.states.length === 0) return { nodes: [], edges: [] };

  const paths = new Set(machine.states.map((s) => s.path));
  const missing = [...new Set(machine.transitions.filter((t) => t.unresolved && t.rawTarget).map((t) => t.rawTarget as string))];

  // BFS depth from the initial state (children of a compound state are
  // reached through it, so treat "parent -> its initial child" as an edge).
  const adjacency = new Map<string, string[]>();
  for (const s of machine.states) adjacency.set(s.path, []);
  for (const t of machine.transitions) {
    if (t.target && adjacency.has(t.from)) adjacency.get(t.from)!.push(t.target);
  }
  for (const s of machine.states) {
    if (s.parent && s.initial) adjacency.get(s.parent)?.push(s.path);
  }
  const depth = new Map<string, number>();
  if (machine.initial) {
    depth.set(machine.initial, 1);
    const queue = [machine.initial];
    while (queue.length) {
      const cur = queue.shift()!;
      for (const next of adjacency.get(cur) || []) {
        if (!depth.has(next)) {
          depth.set(next, depth.get(cur)! + 1);
          queue.push(next);
        }
      }
    }
  }
  const unreachableDepth = Math.max(0, ...depth.values()) + 1;
  for (const s of machine.states) if (!depth.has(s.path)) depth.set(s.path, unreachableDepth);

  const rowsInColumn = new Map<number, number>();
  const place = (col: number) => {
    const row = rowsInColumn.get(col) ?? 0;
    rowsInColumn.set(col, row + 1);
    return { x: col * COL_WIDTH, y: row * ROW_HEIGHT };
  };

  const internalByState = new Map<string, string[]>();
  for (const t of machine.transitions) {
    if (t.targetless || t.target === t.from) {
      const list = internalByState.get(t.from) || [];
      list.push(`${t.target === t.from ? '↻ ' : '• '}${transitionLabel(t)}`);
      internalByState.set(t.from, list);
    }
  }

  const nodes: StateNode[] = [];
  if (machine.initial) {
    nodes.push({
      id: START_NODE_ID,
      type: 'stateNode',
      position: { x: 0, y: 0 },
      data: { label: '', path: START_NODE_ID, kind: 'start', initial: false, final: false, compound: false, internal: [], width: 18 },
    });
  }
  for (const s of machine.states) {
    nodes.push({
      id: s.path,
      type: 'stateNode',
      position: place(depth.get(s.path)!),
      data: {
        label: s.path,
        path: s.path,
        kind: 'state',
        initial: s.initial,
        final: s.final,
        compound: s.type === 'compound',
        internal: internalByState.get(s.path) || [],
        width: NODE_WIDTH,
      },
    });
  }
  for (const raw of missing) {
    nodes.push({
      id: `missing:${raw}`,
      type: 'stateNode',
      position: place(unreachableDepth + 1),
      data: { label: `? ${raw}`, path: raw, kind: 'missing', initial: false, final: false, compound: false, internal: [], width: NODE_WIDTH },
    });
  }
  // Start marker sits one column left of the initial state, vertically centred on it.
  const start = nodes.find((n) => n.id === START_NODE_ID);
  const initialNode = nodes.find((n) => n.id === machine.initial);
  if (start && initialNode) start.position = { x: initialNode.position.x - 70, y: initialNode.position.y + 14 };

  const edges: TransitionEdge[] = [];
  if (machine.initial) {
    edges.push({ id: 'start', source: START_NODE_ID, target: machine.initial, sourceHandle: 'out-r', targetHandle: 'in-l', label: '', markerEnd: ARROW, data: { event: '', kind: 'start' } });
  }
  for (const s of machine.states) {
    if (s.parent && s.initial) {
      edges.push({
        id: `init:${s.path}`, source: s.parent, target: s.path, sourceHandle: 'out-r', targetHandle: 'in-l', label: 'initial', markerEnd: ARROW,
        style: { strokeDasharray: '4 3' }, data: { event: 'initial', kind: 'initial' },
      });
    }
  }
  machine.transitions.forEach((t, i) => {
    if (t.targetless || t.target === t.from) return;
    const target = t.target ?? `missing:${t.rawTarget}`;
    if (!paths.has(t.from)) return;
    const backward = depth.has(target) ? depth.get(target)! <= depth.get(t.from)! : false;
    edges.push({
      id: `t${i}:${t.from}:${t.event}:${target}`,
      source: t.from,
      target,
      sourceHandle: backward ? 'out-b' : 'out-r',
      targetHandle: backward ? 'in-b' : 'in-l',
      label: transitionLabel(t),
      markerEnd: ARROW,
      style: t.unresolved ? { strokeDasharray: '2 4' } : undefined,
      data: { event: t.event, guard: t.guard, kind: t.kind },
    });
  });
  return { nodes, edges };
}
