import { detailLabel, englishHeadline } from '../domain/EnglishView';
import type { EnglishState } from '../types';

/** The fluent English view of a file (t5-3): each top-level function's sentence first, its code beside it as
 * technical detail, collapsed (the `.pal-group` disclosure, docs/design). Read-only; changes stay plan steps. */
export function EnglishPanel({ state }: { state: EnglishState }) {
  if (state.phase === 'none') return null;
  return (
    <section className="le-panel" aria-label="In plain English" data-testid="line-english">
      <h4 className="le-head">In plain English</h4>
      {state.phase === 'loading' && <p className="le-muted">Reading {state.file}...</p>}
      {state.phase === 'error' && (
        <p className="le-error" role="alert" data-testid="line-english-error">
          {state.sentence}
        </p>
      )}
      {state.phase === 'ready' && (
        <>
          <p className="le-muted">{englishHeadline(state.view)}</p>
          <ol className="le-list">
            {state.view.functions.map((fn) => (
              <li key={`${fn.name}:${fn.line}`} className="le-item" data-testid="line-english-fn">
                <p className="le-sentence">{fn.english}</p>
                <details className="pal-group le-detail" data-testid="line-english-detail">
                  <summary>
                    Technical detail <span className="pal-count">{detailLabel(fn)}</span>
                  </summary>
                  <pre className="le-code">
                    <code>{fn.code}</code>
                  </pre>
                </details>
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}
