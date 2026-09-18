'use client';

import { useState } from 'react';
import { ReactFlow, Background, Controls, type Connection, type NodeTypes } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useMachineFlow } from '../hooks/useMachineFlow';
import type { WorkflowEditRequest, WorkflowMachine } from '../types';
import { StateFlowNode } from './StateFlowNode';
import { WorkflowEditPanel } from './WorkflowEditPanel';

const NODE_TYPES: NodeTypes = { stateNode: StateFlowNode };

type MachineCanvasProps = {
  machine: WorkflowMachine;
  machineIndex: number;
  /** Ask for a visual edit (previewed as a diff, saved only on confirm). */
  onEdit: (req: WorkflowEditRequest) => void;
  /** true while a diff is awaiting confirmation or a request is in flight. */
  locked: boolean;
};

type SelectedEdge = { from: string; event: string; label: string };

// One machine as a React Flow diagram (states = nodes, transitions/guards =
// labeled edges, initial + final marked). Layout is derived from the source
// on every render and never saved anywhere (zero metadata). Editing (#61):
// dragging from one state's handle to another adds a transition (using the
// event name typed in the panel), dragging an existing plain transition's
// arrowhead to another state retargets it, and the panel handles
// add/rename/remove state and remove transition. Every edit goes through
// onEdit -> diff preview -> Confirm; unsupported transitions (guarded,
// multi-branch, always/after/invoke) stay read-only.
export function MachineCanvas({ machine, machineIndex, onEdit, locked }: MachineCanvasProps) {
  const { nodes, edges } = useMachineFlow(machine);
  const [eventName, setEventName] = useState('');
  const [selected, setSelected] = useState<SelectedEdge | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const label = machine.exportName ? `${machine.exportName} (id: ${machine.id})` : `id: ${machine.id}`;
  const canEdit = !machine.error && !locked;

  function handleConnect(c: Connection) {
    if (!canEdit || !c.source || !c.target || c.source === '__start__') return;
    if (!eventName.trim()) {
      setHint('Type the new transition’s event name in "Event for new transitions" first, then drag again.');
      return;
    }
    setHint(null);
    onEdit({ machine: machineIndex, op: 'addTransition', from: c.source, event: eventName.trim(), target: c.target });
  }

  return (
    <section className="wf-machine" data-testid="wf-machine" aria-label={`Machine ${machine.id}`}>
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
          <div className={`wf-viewport${canEdit ? ' editable' : ''}`}>
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={NODE_TYPES}
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
                setSelected(edge.data?.editable ? { from: edge.data.from as string, event: edge.data.event as string, label: `${edge.data.from} --${edge.data.event}--> ${edge.target}` } : null)
              }
              onPaneClick={() => setSelected(null)}
              colorMode="dark"
              fitView
              fitViewOptions={{ padding: 0.25 }}
              proOptions={{ hideAttribution: true }}
            >
              <Background />
              <Controls showInteractive={false} />
            </ReactFlow>
          </div>
          {hint && <p className="status-error wf-hint">{hint}</p>}
          <WorkflowEditPanel
            machine={machine}
            machineIndex={machineIndex}
            disabled={!canEdit}
            eventName={eventName}
            onEventNameChange={setEventName}
            selectedTransition={selected}
            onEdit={(req) => {
              setSelected(null);
              onEdit(req);
            }}
          />
        </>
      )}
    </section>
  );
}
