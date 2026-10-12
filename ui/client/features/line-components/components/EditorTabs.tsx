import { useState } from 'react';
import { workflowDiagram } from '@/features/line-workflows';
import { stateGraph } from '../domain/ComponentView';
import type { ComponentEditorView } from '../hooks/useComponentEditor';
import type { DiagramLayout, LineComponentEditor } from '../types';
import { StateGraphView } from './StateGraphView';

type TabProps = { c: LineComponentEditor; view: ComponentEditorView };
const layout = workflowDiagram as unknown as DiagramLayout;

/** Behaviour: each behaviour on the component (Studio's primitive card: its roles as chips with a sentence each, and
 * its state diagram), then the behaviours that fit it with "Add this behaviour". */
export function BehaviourTab({ c, view }: TabProps) {
  return (
    <div className="lc-tab" data-testid="lc-behaviour">
      {c.behaviour.primitives.length ? (
        <ul className="lc-list" aria-label={`Behaviours of ${c.name}`}>
          {c.behaviour.primitives.map((p) => (
            <li key={p.ref} className="lc-card" data-testid="lc-primitive" data-primitive={p.primitive}>
              <p className="lc-card-title">{p.primitive}</p>
              <ul className="lc-chips" aria-label={`Roles of ${p.primitive}`}>
                {p.roles.map((r) => (
                  <li key={r.role} className="lc-chip" title={r.sentence}>
                    {r.label}
                  </li>
                ))}
              </ul>
              {p.roles.map((r) => (
                <p key={r.role} className="lc-muted">
                  {r.sentence}
                </p>
              ))}
              {p.diagram ? <StateGraphView name={p.primitive} graph={stateGraph(p.diagram, layout)} editable={false} busy={view.busy} onPick={() => undefined} /> : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="lc-muted">{c.name} has no behaviour yet.</p>
      )}
      {!c.readOnly && c.behaviour.fits.length ? (
        <>
          <h4>Behaviours that fit {c.name}</h4>
          <ul className="lc-list">
            {c.behaviour.fits.map((f) => (
              <li key={f.primitive} className="lc-card">
                <p className="lc-card-title">{f.primitive}</p>
                <p className="lc-muted">{f.reason}</p>
                <button type="button" className="lc-btn" disabled={view.busy} data-line-control="components.attachBehaviour" data-line-target={f.primitive} onClick={() => view.attach(f.primitive)}>
                  Add this behaviour
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}

/** One When -> Do card's "Change what it does". */
function ChangeAction({ c, view, wire, label }: TabProps & { wire: string; label: string }) {
  const [actionId, setActionId] = useState(c.events.actions[0]?.id ?? '');
  return (
    <span className="lc-row">
      <label className="lc-field">
        <span>New action for: {label}</span>
        <select value={actionId} onChange={(e) => setActionId(e.target.value)}>
          {c.events.actions.map((a) => (
            <option key={a.id} value={a.id}>
              {a.label}
            </option>
          ))}
        </select>
      </label>
      <button type="button" className="lc-btn" disabled={view.busy || !actionId} data-line-control="components.changeWhenDo" data-line-target={wire} onClick={() => view.change(wire, actionId)}>
        Change what it does
      </button>
    </span>
  );
}

/** Events: Studio's When -> Do cards (what starts it, what it does), each with its conflict warning and the fix Studio
 * offers, then the form that adds one. */
export function EventsTab({ c, view }: TabProps) {
  const [sourceId, setSourceId] = useState(c.events.sources[0]?.id ?? '');
  const [actionId, setActionId] = useState(c.events.actions[0]?.id ?? '');
  return (
    <div className="lc-tab" data-testid="lc-events">
      {c.events.groups.length ? (
        <ul className="lc-list" aria-label={`What ${c.name} does`}>
          {c.events.groups.map((g) => (
            <li key={g.key} className={g.conflicts.length ? 'lc-card lc-card--warn' : 'lc-card'} data-testid="lc-whendo">
              <p>
                <span className="lc-kw">When</span> {g.label}
              </p>
              {g.actions.map((a) => (
                <div key={a.wire} className="lc-action">
                  <p>
                    <span className="lc-kw">Do</span> <span data-testid="lc-do">{a.label}</span>
                  </p>
                  {!c.readOnly ? <ChangeAction c={c} view={view} wire={a.wire} label={a.label} /> : null}
                </div>
              ))}
              {g.conflicts.map((w) => (
                <p key={w} className="lc-warn" data-testid="lc-conflict" role="note">
                  {w}
                </p>
              ))}
              {g.fix && !c.readOnly ? (
                <button type="button" className="lc-btn" disabled={view.busy} data-line-control="components.fixWhenDo" onClick={() => view.fix(g)} title={g.fix.sentence}>
                  {g.fix.label}
                </button>
              ) : null}
              <details className="lc-details">
                <summary>Details</summary>
                <code>{g.actions.map((a) => a.wire).join(', ')}</code>
              </details>
            </li>
          ))}
        </ul>
      ) : (
        <p className="lc-muted">No When -&gt; Do yet.</p>
      )}
      <form
        className="lc-form"
        aria-label="Add a When -> Do"
        onSubmit={(e) => {
          e.preventDefault();
          view.addWhenDo(sourceId, actionId);
        }}
      >
        <label className="lc-field">
          <span>When</span>
          <select value={sourceId} onChange={(e) => setSourceId(e.target.value)} data-line-control="components.whenSource">
            {c.events.sources.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <label className="lc-field">
          <span>Do</span>
          <select value={actionId} onChange={(e) => setActionId(e.target.value)} data-line-control="components.whenAction">
            {c.events.actions.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="lc-btn lc-btn--primary" disabled={view.busy || !sourceId || !actionId} data-line-control="components.addWhenDo">
          Add When -&gt; Do
        </button>
      </form>
    </div>
  );
}

/** States: the state each behaviour is in now (live current state), changed by clicking another state on its graph,
 * and the component's states with what turns each on. */
export function StatesTab({ c, view }: TabProps) {
  return (
    <div className="lc-tab" data-testid="lc-states">
      {c.states.current.length ? (
        <ul className="lc-list" aria-label={`Current state of ${c.name}`}>
          {c.states.current.map((cur) => {
            const p = c.behaviour.primitives.find((x) => x.ref === cur.ref);
            return (
              <li key={cur.ref} className="lc-card" data-testid="lc-current">
                <p>
                  <span className="lc-kw">Now</span> The {cur.primitive} is <strong data-testid="lc-current-state">{cur.label}</strong>. {cur.sentence}
                </p>
                {cur.shows ? <p className="lc-muted">Shown with {cur.shows}.</p> : null}
                {p?.diagram ? <StateGraphView name={cur.primitive} graph={stateGraph(p.diagram, layout)} editable={!c.readOnly} busy={view.busy} onPick={(st) => view.setCurrent(cur.ref, st)} /> : null}
                {!c.readOnly ? <p className="lc-muted">Click another state on the graph to put it there.</p> : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="lc-muted">{c.name} has no behaviour, so it has no live state yet; add one on the Behaviour tab.</p>
      )}
      <h4>States of {c.name}</h4>
      <ul className="lc-list">
        {c.states.rows.map((r) => (
          <li key={r.id} className="lc-row">
            <span className="lc-chip">{r.name}</span> <span className="lc-muted">{r.sentence}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
