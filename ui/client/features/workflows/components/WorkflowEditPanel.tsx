'use client';

import { useState } from 'react';
import { Input, Select } from '@/components/ui';
import type { WorkflowEditRequest, WorkflowMachine } from '../types';

type Props = {
  machine: WorkflowMachine;
  machineIndex: number;
  disabled: boolean;
  eventName: string;
  onEventNameChange: (v: string) => void;
  selectedTransition: { from: string; event: string; label: string } | null;
  onEdit: (req: WorkflowEditRequest) => void;
};

// The non-canvas half of visual editing (#61): add / rename / remove a
// state, add a transition without dragging, remove the selected
// transition. Presentation + local form state only; requests go up via
// onEdit and are previewed as a diff before anything is written.
export function WorkflowEditPanel({ machine, machineIndex, disabled, eventName, onEventNameChange, selectedTransition, onEdit }: Props) {
  const [newState, setNewState] = useState('');
  const [subject, setSubject] = useState(machine.states[0]?.path ?? '');
  const [renameTo, setRenameTo] = useState('');
  const [from, setFrom] = useState(machine.states[0]?.path ?? '');
  const [to, setTo] = useState(machine.states[0]?.path ?? '');
  const m = machineIndex;
  const paths = machine.states.map((s) => s.path);
  const options = paths.map((p) => (
    <option key={p} value={p}>{p}</option>
  ));

  return (
    <div className="wf-edit-panel" data-testid="wf-edit-panel">
      <h4>Edit (every change is previewed as a diff before it is saved)</h4>
      <div className="wf-edit-row">
        <Input aria-label="New state name" placeholder="new state name" value={newState} onChange={(e) => setNewState(e.target.value)} disabled={disabled} />
        <button type="button" disabled={disabled || !newState.trim()} onClick={() => onEdit({ machine: m, op: 'addState', name: newState.trim() })}>
          Add state
        </button>
      </div>
      <div className="wf-edit-row">
        <Select aria-label="State to rename or remove" value={subject} onChange={(e) => setSubject(e.target.value)} disabled={disabled}>{options}</Select>
        <Input aria-label="Rename to" placeholder="new name" value={renameTo} onChange={(e) => setRenameTo(e.target.value)} disabled={disabled} />
        <button type="button" disabled={disabled || !renameTo.trim()} onClick={() => onEdit({ machine: m, op: 'renameState', path: subject, name: renameTo.trim() })}>
          Rename state
        </button>
        <button type="button" disabled={disabled} onClick={() => onEdit({ machine: m, op: 'removeState', path: subject })}>
          Remove state
        </button>
      </div>
      <div className="wf-edit-row">
        <Select aria-label="Transition from" value={from} onChange={(e) => setFrom(e.target.value)} disabled={disabled}>{options}</Select>
        <Input aria-label="Event for new transitions" placeholder="EVENT_NAME" value={eventName} onChange={(e) => onEventNameChange(e.target.value)} disabled={disabled} />
        <Select aria-label="Transition to" value={to} onChange={(e) => setTo(e.target.value)} disabled={disabled}>{options}</Select>
        <button type="button" disabled={disabled || !eventName.trim()} onClick={() => onEdit({ machine: m, op: 'addTransition', from, event: eventName.trim(), target: to })}>
          Add transition
        </button>
      </div>
      <div className="wf-edit-row">
        <span className="hint">
          {selectedTransition ? `Selected: ${selectedTransition.label}` : 'Click a plain transition arrow to select it; drag its arrowhead to another state to retarget it.'}
        </span>
        <button
          type="button"
          disabled={disabled || !selectedTransition}
          onClick={() => selectedTransition && onEdit({ machine: m, op: 'removeTransition', from: selectedTransition.from, event: selectedTransition.event })}
        >
          Remove selected transition
        </button>
      </div>
      <p className="hint">
        Guarded, multi-branch, always/after/invoke transitions and state ids/types are not editable here — edit the source.
        You can also drag from a state&apos;s right-hand handle onto another state to add a transition.
      </p>
    </div>
  );
}
