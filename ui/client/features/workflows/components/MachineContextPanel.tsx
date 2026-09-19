'use client';

import { useState } from 'react';
import { Input, Select } from '@/components/ui';
import { useMachineBehavior, type NamedUsage } from '../hooks/useMachineBehavior';
import type { WorkflowEditRequest, WorkflowMachine } from '../types';

type Props = {
  machine: WorkflowMachine;
  machineIndex: number;
  disabled: boolean;
  onEdit: (req: WorkflowEditRequest) => void;
};

function NamedList({ items, kind, disabled, onRemove }: { items: NamedUsage[]; kind: 'action' | 'guard'; disabled: boolean; onRemove: (name: string) => void }) {
  if (items.length === 0) return <p className="hint">No {kind}s yet.</p>;
  return (
    <ul className="wf-named-list">
      {items.map((it) => (
        <li key={it.name} data-testid={`wf-${kind}-${it.name}`}>
          <code>{it.name}</code>
          <span className="hint">
            {it.usedBy.length ? ` used by ${it.usedBy.join(', ')}` : ' not used yet'}
            {it.declared ? '' : ' (not declared in setup)'}
          </span>
          <button type="button" aria-label={`Remove ${kind} ${it.name}`} disabled={disabled || !it.declared || it.usedBy.length > 0} onClick={() => onRemove(it.name)}>
            Remove
          </button>
        </li>
      ))}
    </ul>
  );
}

// Epic #223 -- the Context / Actions side panel of the Workflows view: what
// the machine remembers (context fields with types and initial values) and
// its named actions/guards, with the controls to declare them and attach
// them to entry / exit / a transition. Presentation + local form state only;
// every request goes up via onEdit and is previewed as a diff first.
export function MachineContextPanel({ machine, machineIndex, disabled, onEdit }: Props) {
  const behavior = useMachineBehavior(machine);
  const m = machineIndex;
  const [field, setField] = useState({ name: '', type: '', initial: '' });
  const [newAction, setNewAction] = useState('');
  const [newGuard, setNewGuard] = useState('');
  const [action, setAction] = useState('');
  const [where, setWhere] = useState<'entry' | 'exit' | 'transition'>('entry');
  const [state, setState] = useState(machine.states[0]?.path ?? '');
  const [transition, setTransition] = useState(behavior.transitions[0]?.key ?? '');
  const [guard, setGuard] = useState('');
  const chosenAction = action || behavior.actions[0]?.name || '';
  const chosenTransition = behavior.transitions.find((t) => t.key === transition) ?? behavior.transitions[0];
  const typed = machine.context.some((f) => f.type !== undefined) || machine.context.length === 0;
  const noSetup = !machine.hasSetup;

  function slot(): Pick<WorkflowEditRequest, 'where' | 'path' | 'from' | 'event' | 'kind'> | null {
    if (where === 'transition') return chosenTransition ? { where, from: chosenTransition.from, event: chosenTransition.event, kind: chosenTransition.kind } : null;
    return { where, path: state };
  }
  const assign = (op: 'assignAction' | 'unassignAction') => {
    const s = slot();
    if (s && chosenAction) onEdit({ machine: m, op, name: chosenAction, ...s });
  };

  return (
    <aside className="wf-edit-panel wf-context-panel" data-testid="wf-context-panel" aria-label="Context and actions">
      <h4>Context</h4>
      {machine.contextEditable ? (
        <>
          {machine.context.length === 0 ? (
            <p className="hint">This machine remembers nothing yet.</p>
          ) : (
            <table className="wf-context-table" data-testid="wf-context-table">
              <thead>
                <tr><th>Field</th><th>Type</th><th>Starts as</th><th /></tr>
              </thead>
              <tbody>
                {machine.context.map((f) => (
                  <tr key={f.name} data-testid={`wf-context-${f.name}`}>
                    <td><code>{f.name}</code></td>
                    <td>{f.type ? <code>{f.type}</code> : <span className="hint">—</span>}</td>
                    <td><code>{f.initial}</code></td>
                    <td>
                      <button type="button" aria-label={`Remove context field ${f.name}`} disabled={disabled} onClick={() => onEdit({ machine: m, op: 'removeContextField', name: f.name })}>
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="wf-edit-row">
            <Input aria-label="New context field name" placeholder="field name" value={field.name} onChange={(e) => setField({ ...field, name: e.target.value })} disabled={disabled} />
            {typed && <Input aria-label="Context field type" placeholder="type, e.g. number" value={field.type} onChange={(e) => setField({ ...field, type: e.target.value })} disabled={disabled} />}
            <Input aria-label="Context field initial value" placeholder="starts as, e.g. 0" value={field.initial} onChange={(e) => setField({ ...field, initial: e.target.value })} disabled={disabled} />
            <button
              type="button"
              disabled={disabled || !field.name.trim() || !field.initial.trim()}
              onClick={() => onEdit({ machine: m, op: 'addContextField', name: field.name.trim(), initial: field.initial.trim(), ...(field.type.trim() ? { type: field.type.trim() } : {}) })}
            >
              Add context field
            </button>
          </div>
        </>
      ) : (
        <p className="hint">The context is not a plain object literal, so it can only be edited in the source.</p>
      )}

      <h4>Actions and guards</h4>
      {noSetup && <p className="hint">This machine is not created with <code>setup(...)</code>, so named actions and guards cannot be declared here; you can still attach action names.</p>}
      <NamedList items={behavior.actions} kind="action" disabled={disabled} onRemove={(name) => onEdit({ machine: m, op: 'removeAction', name })} />
      <div className="wf-edit-row">
        <Input aria-label="New action name" placeholder="action name" value={newAction} onChange={(e) => setNewAction(e.target.value)} disabled={disabled || noSetup} />
        <button type="button" disabled={disabled || noSetup || !newAction.trim()} onClick={() => onEdit({ machine: m, op: 'declareAction', name: newAction.trim() })}>
          Declare action
        </button>
      </div>
      <div className="wf-edit-row">
        <Select aria-label="Action to attach" value={chosenAction} onChange={(e) => setAction(e.target.value)} disabled={disabled || behavior.actions.length === 0}>
          {behavior.actions.map((a) => <option key={a.name} value={a.name}>{a.name}</option>)}
        </Select>
        <Select aria-label="Where the action runs" value={where} onChange={(e) => setWhere(e.target.value as typeof where)} disabled={disabled}>
          <option value="entry">on entering a state</option>
          <option value="exit">on leaving a state</option>
          <option value="transition">during a transition</option>
        </Select>
        {where === 'transition' ? (
          <Select aria-label="Transition for the action" value={chosenTransition?.key ?? ''} onChange={(e) => setTransition(e.target.value)} disabled={disabled}>
            {behavior.transitions.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
          </Select>
        ) : (
          <Select aria-label="State for the action" value={state} onChange={(e) => setState(e.target.value)} disabled={disabled}>
            {machine.states.map((s) => <option key={s.path} value={s.path}>{s.path}</option>)}
          </Select>
        )}
        <button type="button" disabled={disabled || !chosenAction} onClick={() => assign('assignAction')}>Attach action</button>
        <button type="button" disabled={disabled || !chosenAction} onClick={() => assign('unassignAction')}>Detach action</button>
      </div>

      <NamedList items={behavior.guards} kind="guard" disabled={disabled} onRemove={(name) => onEdit({ machine: m, op: 'removeGuard', name })} />
      <div className="wf-edit-row">
        <Input aria-label="New guard name" placeholder="guard name" value={newGuard} onChange={(e) => setNewGuard(e.target.value)} disabled={disabled || noSetup} />
        <button type="button" disabled={disabled || noSetup || !newGuard.trim()} onClick={() => onEdit({ machine: m, op: 'declareGuard', name: newGuard.trim() })}>
          Declare guard
        </button>
      </div>
      <div className="wf-edit-row">
        <Select aria-label="Transition to guard" value={chosenTransition?.key ?? ''} onChange={(e) => setTransition(e.target.value)} disabled={disabled}>
          {behavior.transitions.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
        </Select>
        <Select aria-label="Guard condition" value={guard} onChange={(e) => setGuard(e.target.value)} disabled={disabled}>
          <option value="">(no guard)</option>
          {machine.declared.guards.map((g) => <option key={g} value={g}>{g}</option>)}
        </Select>
        <button
          type="button"
          disabled={disabled || !chosenTransition}
          onClick={() => chosenTransition && onEdit({ machine: m, op: 'setGuard', name: guard, from: chosenTransition.from, event: chosenTransition.event, kind: chosenTransition.kind })}
        >
          Set guard
        </button>
      </div>
      <p className="hint">Declared actions and guards start as empty stubs (<code>() =&gt; {'{}'}</code> / <code>() =&gt; true</code>); fill in the behaviour in the source.</p>
    </aside>
  );
}
