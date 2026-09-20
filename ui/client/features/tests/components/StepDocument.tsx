import type { StepRowView } from '../types';

type StepDocumentProps = {
  rows: StepRowView[];
  selected: number | null;
  onSelect: (key: number) => void;
  onRestore: (key: number) => void;
  onAdd: (kind: 'event' | 'state' | 'check-text') => void;
  canAddEvent: boolean;
  canAddState: boolean;
};

/** The test as a document: one row per step, in order. A row is a real button (Enter / Space selects it, Tab reaches
 * it); the selected row is marked with a border, an "Editing" word and aria-current, never colour alone. A removed row
 * stays visible, struck through AND labelled, until the change is saved. */
export function StepDocument({ rows, selected, onSelect, onRestore, onAdd, canAddEvent, canAddState }: StepDocumentProps) {
  return (
    <div className="ts-doc" data-testid="step-document">
      <ol className="ts-rows" aria-label="Steps of this test">
        {rows.map((r) => (
          <li key={r.key} className={`ts-srow${r.removed ? ' ts-srow--removed' : ''}${r.change ? ` ts-srow--${r.change}` : ''}`} data-testid="step-row" data-keyword={r.keyword} data-change={r.change ?? undefined}>
            <button
              type="button"
              className="ts-srow-btn"
              aria-current={selected === r.key ? 'true' : undefined}
              aria-label={`${r.n === null ? 'Removed step' : `Step ${r.n}`}: ${r.keyword} ${r.sentence}${r.change ? `. ${r.changeLabel}` : ''}`}
              disabled={!r.canEdit && !r.removed}
              onClick={() => (r.removed ? onRestore(r.key) : onSelect(r.key))}
            >
              <span className={`ts-kw ts-kw--${r.keyword.toLowerCase()}`} data-testid="step-keyword">{r.keyword}</span>
              <span className="ts-srow-main">
                <span className="ts-srow-text" data-testid="step-text">{r.sentence}</span>
                {r.note && <span className="ts-srow-note">{r.note}</span>}
                {r.change && <span className="ts-srow-change" data-testid="step-change">{r.changeLabel}</span>}
                {selected === r.key && !r.removed && <span className="ts-srow-change">Editing this step on the right</span>}
              </span>
              <code className="ts-srow-binding" data-testid="step-binding">{r.binding}</code>
            </button>
            {r.removed && (
              <button type="button" className="ts-btn ts-btn--link" onClick={() => onRestore(r.key)}>Put back</button>
            )}
          </li>
        ))}
      </ol>
      <div className="ts-doc-foot">
        <button type="button" className="ts-btn" data-testid="add-event" disabled={!canAddEvent} onClick={() => onAdd('event')}>+ Add flow event</button>
        <button type="button" className="ts-btn" data-testid="add-state" disabled={!canAddState} onClick={() => onAdd('state')}>+ Add flow state</button>
        <button type="button" className="ts-btn" data-testid="add-check" onClick={() => onAdd('check-text')}>+ Add check</button>
        <span className="ts-doc-hint">Nothing is written until you review the changes.</span>
      </div>
    </div>
  );
}
