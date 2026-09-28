'use client';

import { useMemo } from 'react';
import { ReactFlow, Background, type NodeTypes, type NodeProps, type Node } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useMachineFlow, type WorkflowMachine, type StateNodeData } from '@/features/workflows';

type InsetNodeData = StateNodeData & { current: boolean };
type InsetNodeType = Node<InsetNodeData, 'stateNode'>;

function InsetNode({ data }: NodeProps<InsetNodeType>) {
  if (data.kind === 'start') return <div className="cd-flow-start" data-testid="cd-flow-start" />;
  const cls = ['cd-flow-state', data.kind === 'missing' ? 'missing' : '', data.current ? 'current' : ''].filter(Boolean).join(' ');
  return (
    <div className={cls} data-testid={`cd-flow-state-${data.path}`}>
      {data.label}
    </div>
  );
}

const NODE_TYPES: NodeTypes = { stateNode: InsetNode };

type Props = { machine: WorkflowMachine; current: string | null };

/** #380 "Flow inset": a small, read-only diagram of the component's machine (reusing the Workflows
 * screen's own layout, `useMachineFlow`), with the state chosen in the State switcher highlighted. */
export function FlowInset({ machine, current }: Props) {
  const { nodes, edges } = useMachineFlow(machine);
  const styledNodes = useMemo(() => nodes.map((n) => ({ ...n, data: { ...n.data, current: n.data.path === current } })), [nodes, current]);
  const plainEdges = useMemo(() => edges.map((e) => ({ ...e, type: undefined })), [edges]);

  if (nodes.length === 0) return <p className="hint">This machine has no states to draw.</p>;
  return (
    <div className="cd-flow-inset" data-testid="cd-flow-inset">
      <ReactFlow
        nodes={styledNodes}
        edges={plainEdges}
        nodeTypes={NODE_TYPES}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        colorMode="dark"
        fitView
        fitViewOptions={{ padding: 0.15 }}
        proOptions={{ hideAttribution: true }}
      >
        <Background />
      </ReactFlow>
    </div>
  );
}
