import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import type { StateNodeData } from '../hooks/useMachineFlow';

// One XState state as a React Flow node. Left = incoming, right = outgoing
// forward transitions, bottom = backward (loop-back) transitions. Initial
// is marked by the start dot + arrow (a separate `start` node), final by a
// double border, compound by a badge.
type StateNodeType = Node<StateNodeData, 'stateNode'>;

export function StateFlowNode({ data }: NodeProps<StateNodeType>) {
  if (data.kind === 'start') {
    return (
      <div className="wf-start-dot" title="initial state" data-testid="wf-start">
        <Handle id="out-r" type="source" position={Position.Right} isConnectable={false} className="wf-handle" />
      </div>
    );
  }
  const cls = ['wf-state', data.final ? 'final' : '', data.initial ? 'initial' : '', data.kind === 'missing' ? 'missing' : ''].filter(Boolean).join(' ');
  return (
    <div className={cls} style={{ width: data.width }} data-testid={`wf-state-${data.path}`}>
      <Handle id="in-l" type="target" position={Position.Left} className="wf-handle" />
      <Handle id="in-b" type="target" position={Position.Bottom} className="wf-handle" style={{ left: '30%' }} />
      <div className="wf-state-name">{data.label}</div>
      <div className="wf-state-tags">
        {data.initial && <span className="wf-tag">initial</span>}
        {data.final && <span className="wf-tag final">final</span>}
        {data.compound && <span className="wf-tag">compound</span>}
        {data.kind === 'missing' && <span className="wf-tag missing">unresolved target</span>}
      </div>
      {data.internal.map((line) => (
        <div key={line} className="wf-internal">{line}</div>
      ))}
      <Handle id="out-r" type="source" position={Position.Right} className="wf-handle" />
      <Handle id="out-b" type="source" position={Position.Bottom} className="wf-handle" style={{ left: '70%' }} />
    </div>
  );
}
