'use client';

import { ReactFlow, Background, Controls, type NodeTypes } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useMachineFlow } from '../hooks/useMachineFlow';
import type { WorkflowMachine } from '../types';
import { StateFlowNode } from './StateFlowNode';

const NODE_TYPES: NodeTypes = { stateNode: StateFlowNode };

// One machine as a read-only React Flow diagram (states = nodes,
// transitions/guards = labeled edges, initial + final marked). Nodes are
// neither draggable nor connectable: the layout is derived from the source
// on every render and nothing about it is ever saved.
export function MachineCanvas({ machine }: { machine: WorkflowMachine }) {
  const { nodes, edges } = useMachineFlow(machine);
  const label = machine.exportName ? `${machine.exportName} (id: ${machine.id})` : `id: ${machine.id}`;

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
          <div className="wf-viewport">
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={NODE_TYPES}
              nodesDraggable={false}
              nodesConnectable={false}
              elementsSelectable={false}
              fitView
          colorMode="dark"
              fitViewOptions={{ padding: 0.25 }}
              proOptions={{ hideAttribution: true }}
            >
              <Background />
              <Controls showInteractive={false} />
            </ReactFlow>
          </div>
        </>
      )}
    </section>
  );
}
