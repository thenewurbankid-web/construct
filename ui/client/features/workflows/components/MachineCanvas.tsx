'use client';

import { ReactFlow, Background, Controls, type Connection, type EdgeTypes, type NodeTypes } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useFitOnResize } from '../hooks/useFitOnResize';
import { useMachineFlow } from '../hooks/useMachineFlow';
import type { SelectedEdge, WorkflowEditRequest, WorkflowMachine } from '../types';
import { FlowEdge } from './FlowEdge';
import { StateFlowNode } from './StateFlowNode';

const FIT_PADDING = 0.06;
const NODE_TYPES: NodeTypes = { stateNode: StateFlowNode };
const EDGE_TYPES: EdgeTypes = { flowEdge: FlowEdge };

type MachineCanvasProps = {
  machine: WorkflowMachine;
  machineIndex: number;
  /** Ask for a visual edit (previewed as a diff, saved only on confirm). */
  onEdit: (req: WorkflowEditRequest) => void;
  /** true while a diff is awaiting confirmation or a request is in flight. */
  locked: boolean;
  /** This machine is the one the tools tabs (Narrative / Context / Edit) act on. */
  active: boolean;
  onActivate: (machineIndex: number) => void;
  /** Event name typed in the Edit tab; used when dragging a new transition. */
  eventName: string;
  hint: string | null;
  onHint: (hint: string | null) => void;
  onSelectEdge: (edge: SelectedEdge | null) => void;
};

// One machine as a React Flow diagram (states = nodes, transitions/guards =
// labeled edges, initial + final marked). Layout is derived from the source
// on every render and never saved anywhere (zero metadata). Editing (#61):
// dragging from one state's handle to another adds a transition (using the
// event name typed in the Edit tab), dragging an existing plain transition's
// arrowhead to another state retargets it; the Edit tab (in the shell's Tools
// panel) handles add/rename/remove state and remove transition. Every edit goes through
// onEdit -> diff preview -> Confirm; unsupported transitions (guarded,
// multi-branch, always/after/invoke) stay read-only.
export function MachineCanvas({ machine, machineIndex, onEdit, locked, active, onActivate, eventName, hint, onHint, onSelectEdge }: MachineCanvasProps) {
  const { nodes, edges } = useMachineFlow(machine);
  const { viewportRef, onInit } = useFitOnResize(FIT_PADDING);
  const label = machine.exportName ? `${machine.exportName} (id: ${machine.id})` : `id: ${machine.id}`;
  const canEdit = !machine.error && !locked;

  function handleConnect(c: Connection) {
    if (!canEdit || !c.source || !c.target || c.source === '__start__') return;
    if (!eventName.trim()) {
      onHint('Type the new transition’s event name in the Edit tab ("Event for new transitions") first, then drag again.');
      return;
    }
    onHint(null);
    onEdit({ machine: machineIndex, op: 'addTransition', from: c.source, event: eventName.trim(), target: c.target });
  }

  return (
    <section
      className={`wf-machine${active ? ' active' : ''}`}
      data-testid="wf-machine"
      aria-label={`Machine ${machine.id}`}
      onPointerDownCapture={() => onActivate(machineIndex)}
    >
      <h3>{label}</h3>
      {machine.error ? (
        <p className="status-error wf-machine-error" data-testid="wf-machine-error">
          Can&apos;t visualize this machine — {machine.error}. Only machines written as a plain object literal can be drawn; the source file was not changed.
        </p>
      ) : nodes.length === 0 ? (
        <p className="hint">This machine has no states.</p>
      ) : (
        <>
          <p className="hint wf-machine-meta">
            {machine.states.length} state(s), {machine.transitions.length} transition(s)
            {machine.line ? ` — defined at line ${machine.line}` : ''}. Edge labels are event names, with
            [guard] where one is set.
          </p>
          <div className={`wf-viewport${canEdit ? ' editable' : ''}`} ref={viewportRef}>
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={NODE_TYPES}
              edgeTypes={EDGE_TYPES}
              nodesDraggable={false}
              nodesConnectable={canEdit}
              edgesReconnectable={canEdit}
              elementsSelectable={canEdit}
              onConnect={handleConnect}
              onReconnect={(oldEdge, c) => {
                if (!canEdit || !oldEdge.data?.editable || !c.target || c.target === oldEdge.target) return;
                onEdit({ machine: machineIndex, op: 'retargetTransition', from: oldEdge.data.from as string, event: oldEdge.data.event as string, target: c.target });
              }}
              onEdgeClick={(_, edge) =>
                onSelectEdge(edge.data?.editable ? { from: edge.data.from as string, event: edge.data.event as string, label: `${edge.data.from} --${edge.data.event}--> ${edge.target}` } : null)
              }
              onPaneClick={() => onSelectEdge(null)}
              // colorMode only picks React Flow's built-in defaults; every colour is remapped to a theme token in workflows-shell.css.
              colorMode="dark"
              defaultMarkerColor="var(--text-muted)"
              fitView
              fitViewOptions={{ padding: FIT_PADDING }}
              onInit={onInit}
              proOptions={{ hideAttribution: true }}
            >
              <Background />
              <Controls showInteractive={false} />
            </ReactFlow>
          </div>
          {hint && active && <p className="status-error wf-hint">{hint}</p>}
        </>
      )}
    </section>
  );
}
