'use client';

import { useId, useState } from 'react';
import { LoadingState } from '@/features/states';
import { bindingRows, coverageSentence } from '../domain/PageBinding';
import type { BindingRow } from '../domain/PageBinding';
import type { BindingFinding, BindingFix, BindingState, SaveOutcome } from '../types';

type BindingPanelProps = {
  pageName: string;
  state: BindingState;
  busy: boolean;
  outcome: SaveOutcome | null;
  onBindPart: (partId: string, libraryId: string) => void;
  onBindAction: (fix: BindingFix) => void;
};

/** cu5: the chosen page's two bindings side by side, one row per part: its library component (Morpheus) and the data,
 * states and actions it is bound to (Trace). Actions with no home are listed below with their typed fixes; every bind
 * is a plan step a person approves in the Plan panel. */
export function BindingPanel({ pageName, state, busy, outcome, onBindPart, onBindAction }: BindingPanelProps) {
  return (
    <section className="lp-binding" aria-labelledby="lp-binding-title" data-testid="lp-binding">
      <h2 id="lp-binding-title">How {pageName} is bound</h2>
      <p className="hint">Each part is a component from your library (Morpheus) and shows data from your API (Trace).</p>
      {outcome && (
        <div className={outcome.ok ? 'lp-outcome lp-outcome--ok' : 'lp-outcome lp-outcome--refused'} role="status" data-testid="lp-bind-outcome">
          <p>{outcome.sentence}</p>
          {outcome.detail && (
            <details className="lp-details">
              <summary>Details</summary>
              <p className="lp-fragment-detail">{outcome.detail}</p>
            </details>
          )}
        </div>
      )}
      {state.phase === 'loading' && <LoadingState size="inline" label="Reading the bindings of this page" />}
      {state.phase === 'error' && <p className="hint">{state.sentence}</p>}
      {state.phase === 'ready' && (
        <>
          <ul className="lp-binding-facts" aria-label="Binding summary">
            <li data-testid="lp-contract">{state.binding.contract.sentence}</li>
            <li data-testid="lp-coverage">{coverageSentence(state.binding)}</li>
            {state.binding.note && <li data-testid="lp-binding-note">{state.binding.note}</li>}
          </ul>
          <div className="lp-binding-scroll">
            <table className="lp-binding-table" data-testid="lp-binding-table">
              <thead>
                <tr>
                  <th scope="col">Part</th>
                  <th scope="col">Library component (Morpheus)</th>
                  <th scope="col">Data and actions (Trace)</th>
                </tr>
              </thead>
              <tbody>
                {bindingRows(state.binding).map((row) => (
                  <BindingRowView key={row.partId} row={row} busy={busy} onBindPart={onBindPart} />
                ))}
              </tbody>
            </table>
          </div>
          {state.binding.findings.length > 0 && (
            <section aria-labelledby="lp-homeless-title" className="lp-homeless">
              <h3 id="lp-homeless-title">Actions with no home yet</h3>
              <ul className="lp-findings">
                {state.binding.findings.map((f) => (
                  <BindingFindingItem key={f.key} finding={f} busy={busy} onFix={onBindAction} />
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </section>
  );
}

function BindingRowView({ row, busy, onBindPart }: { row: BindingRow; busy: boolean; onBindPart: (partId: string, libraryId: string) => void }) {
  const id = useId();
  const [target, setTarget] = useState(row.targets[0]?.id ?? '');
  return (
    <tr data-testid="lp-binding-row" data-part={row.tag} data-part-id={row.partId}>
      <th scope="row">
        <span className="lp-part-name" style={{ paddingLeft: `calc(${row.depth} * var(--sp-2))` }}>
          {row.tag}
        </span>
      </th>
      <td>
        <p className={row.library.bound ? 'lp-base' : 'lp-base lp-base--problem'} data-testid="lp-binding-library">
          {row.library.sentence}
        </p>
        {row.targets.length > 0 && (
          <form
            className="lp-bind-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (target) onBindPart(row.partId, target);
            }}
          >
            <label htmlFor={id} className="lp-now">
              Library component
            </label>
            <select id={id} value={target} onChange={(e) => setTarget(e.target.value)} data-testid="lp-bind-target">
              {row.targets.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            <button type="submit" className="ui-button" disabled={busy || !target} data-line-control="pages.bindPart" data-line-target={row.tag}>
              Bind to library
            </button>
          </form>
        )}
      </td>
      <td>
        <p className="lp-base" data-testid="lp-binding-data">
          {row.data.sentence}
        </p>
        {row.data.states.length > 0 && (
          <ul className="lp-binding-list" aria-label={`States of ${row.tag}`}>
            {row.data.states.map((s) => (
              <li key={s} data-testid="lp-binding-state">
                {s}
              </li>
            ))}
          </ul>
        )}
        {row.data.actions.length > 0 && (
          <ul className="lp-binding-list" aria-label={`Actions of ${row.tag}`}>
            {row.data.actions.map((a) => (
              <li key={a.id} data-testid="lp-binding-action" data-resolution={a.resolution}>
                <span className={a.resolution === 'unresolved' ? 'lp-chip lp-chip--problem' : 'lp-chip lp-chip--ok'}>{a.pill}</span> {a.sentence}
              </li>
            ))}
          </ul>
        )}
      </td>
    </tr>
  );
}

function BindingFindingItem({ finding, busy, onFix }: { finding: BindingFinding; busy: boolean; onFix: (fix: BindingFix) => void }) {
  const [first, ...rest] = finding.fixes;
  return (
    <li className="lp-finding lp-finding--warning" data-testid="lp-binding-finding">
      <span className="lp-finding-sentence">{finding.sentence}</span>
      {first && (
        <div className="lp-fragment-actions">
          <button type="button" className="ui-button ui-button--primary" disabled={busy} onClick={() => onFix(first)} data-line-control="pages.bindInteraction" data-line-target={finding.interactionId} data-testid="lp-bind-fix">
            {first.sentence}
          </button>
        </div>
      )}
      {rest.length > 0 && (
        <details className="lp-details">
          <summary>Other ways to bind it</summary>
          <ul className="lp-binding-list">
            {rest.map((fix) => (
              <li key={fix.id}>
                <button type="button" className="ui-button" disabled={busy} onClick={() => onFix(fix)} data-testid="lp-bind-other">
                  {fix.sentence}
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
      <details className="lp-details">
        <summary>Details</summary>
        <dl>
          <dt>Action</dt>
          <dd>{finding.interactionId}</dd>
          <dt>Tool</dt>
          <dd>{first?.step.tool ?? 'none'}</dd>
        </dl>
      </details>
    </li>
  );
}
