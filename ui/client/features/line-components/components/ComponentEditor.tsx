import { EDITOR_TABS, headline } from '../domain/ComponentView';
import type { ComponentEditorView } from '../hooks/useComponentEditor';
import type { EditorNotice } from '../types';
import { BehaviourTab, EventsTab, StatesTab } from './EditorTabs';

/** The last step's answer: "Waiting for your approval: ...", or the refusal in one sentence with its code under Details
 * and each typed fix as a button that adds that fix as a plan step. */
function Notice({ notice, view }: { notice: EditorNotice; view: ComponentEditorView }) {
  if (!notice) return null;
  if (notice.ok) {
    return (
      <p className="lc-notice" role="status" data-testid="lc-notice">
        {notice.sentence} Approve it in the Plan panel.
      </p>
    );
  }
  const r = notice.refusal;
  return (
    <div className="lc-notice lc-notice--refused" role="alert" data-testid="lc-refusal">
      <p>{r.sentence}</p>
      {r.fixes.map((f) => (
        <button key={f.id} type="button" className="lc-btn" disabled={view.busy} data-testid="lc-refusal-fix" onClick={() => view.applyFix(f.step)}>
          {f.label}
        </button>
      ))}
      {r.code ? (
        <details className="lc-details">
          <summary>Details</summary>
          <code>{r.code}</code>
        </details>
      ) : null}
    </div>
  );
}

/** The editor for the component picked in the library or a feature: its tabs (Behaviour, Events, States), each change
 * a plan step. A library component opens read-only with the sentence that says how to change it. */
export function ComponentEditor({ view }: { view: ComponentEditorView }) {
  const s = view.state;
  if (s.phase === 'none') {
    return (
      <section className="lc-editor" aria-labelledby="lc-editor-head" data-testid="lc-editor">
        <h2 id="lc-editor-head" className="lc-head">
          Editor
        </h2>
        <p className="lc-muted">Open a component from the library or a feature to see its behaviour, events and states.</p>
        <Notice notice={view.notice} view={view} />
      </section>
    );
  }
  if (s.phase !== 'ready') {
    return (
      <section className="lc-editor" aria-labelledby="lc-editor-head" data-testid="lc-editor">
        <h2 id="lc-editor-head" className="lc-head">
          Editor
        </h2>
        <p className="lc-muted" role={s.phase === 'error' ? 'alert' : 'status'}>
          {s.phase === 'error' ? s.sentence : 'Reading the component.'}
        </p>
        <Notice notice={view.notice} view={view} />
      </section>
    );
  }
  const c = s.component;
  return (
    <section className="lc-editor" aria-labelledby="lc-editor-head" data-testid="lc-editor" data-component={c.name}>
      <h2 id="lc-editor-head" className="lc-head">
        Editor: {c.name}
      </h2>
      <p className="lc-muted" data-testid="lc-headline">
        {headline(c)}
      </p>
      {c.readOnlySentence ? (
        <p className="lc-readonly" data-testid="lc-readonly">
          {c.readOnlySentence}
        </p>
      ) : null}
      <div className="lc-tabs" role="tablist" aria-label={`Editor tabs for ${c.name}`}>
        {EDITOR_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`lc-tab-${t.id}`}
            aria-selected={view.tab === t.id}
            aria-controls="lc-tabpanel"
            className="lc-tab-btn"
            data-line-control="components.tab"
            data-line-target={t.id}
            onClick={() => view.setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div id="lc-tabpanel" role="tabpanel" aria-labelledby={`lc-tab-${view.tab}`}>
        {view.tab === 'behaviour' ? <BehaviourTab c={c} view={view} /> : null}
        {view.tab === 'events' ? <EventsTab key={c.file} c={c} view={view} /> : null}
        {view.tab === 'states' ? <StatesTab c={c} view={view} /> : null}
      </div>
      <Notice notice={view.notice} view={view} />
      <details className="lc-details">
        <summary>Details</summary>
        <code>{c.file}</code> <span className="lc-muted">{c.viaSentence}</span>
      </details>
    </section>
  );
}
