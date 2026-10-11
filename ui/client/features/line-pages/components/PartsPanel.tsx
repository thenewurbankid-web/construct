import { LoadingState } from '@/features/states';
import type { CodeFragment, FragmentOutcome, PagePart, PartProp, PartsState, SaveOutcome } from '../types';
import { FindingItem } from './FindingItem';
import { FragmentEditor, FragmentForm, refusalFor } from './FragmentEditor';
import { LinePropRow } from './LinePropRow';

type PartsPanelProps = {
  pageName: string;
  parts: PartsState;
  saving: boolean;
  revision: number;
  outcome: SaveOutcome | null;
  onSave: (part: PagePart, prop: PartProp, raw: string | boolean) => void;
  fragmentOutcome: FragmentOutcome | null;
  onSaveFragment: (fragment: CodeFragment, code: string) => void;
};

/** The chosen page's parts and their props, one Save per prop, and what the last Save did. */
export function PartsPanel({ pageName, parts, saving, revision, outcome, onSave, fragmentOutcome, onSaveFragment }: PartsPanelProps) {
  return (
    <section className="lp-parts" aria-labelledby="lp-parts-title" data-testid="lp-parts">
      <h2 id="lp-parts-title">Parts of {pageName}</h2>
      {outcome && (
        <div className={outcome.ok ? 'lp-outcome lp-outcome--ok' : 'lp-outcome lp-outcome--refused'} role="status" data-testid="lp-outcome">
          <p>{outcome.sentence}</p>
          {outcome.findings.length > 0 && (
            <ul className="lp-findings" aria-label="Why it was not saved">
              {outcome.findings.map((f, i) => (
                <FindingItem key={`${f.rule}-${i}`} finding={f} />
              ))}
            </ul>
          )}
        </div>
      )}
      {parts.phase === 'loading' && <LoadingState size="inline" label="Reading the parts of this page" />}
      {parts.phase === 'error' && <p className="hint">{parts.sentence}</p>}
      {parts.phase === 'ready' && parts.parts.length === 0 && <p className="hint">This page has no parts yet.</p>}
      {parts.phase === 'ready' && parts.parts.length > 0 && (
        <ul className="lp-part-list" aria-label="Parts">
          {parts.parts.map((part) => (
            <li key={part.nodeId} className="lp-part" style={{ marginLeft: `calc(${part.depth} * var(--sp-3))` }} data-testid="lp-part" data-part={part.tag}>
              <span className="lp-part-name">{part.tag}</span>
              {part.props.length === 0 ? (
                !part.fragments && <p className="hint">Nothing to change here without code.</p>
              ) : (
                part.props.map((prop) => (
                  <LinePropRow key={`${part.nodeId}-${prop.name}-${revision}`} prop={prop} busy={saving} onSave={(raw) => onSave(part, prop, raw)} />
                ))
              )}
              {part.fragments && (
                <FragmentEditor key={`${part.nodeId}-code-${revision}`}>
                  {part.fragments.map((fragment) => (
                    <FragmentForm key={fragment.id} fragment={fragment} busy={saving} refusal={refusalFor(fragmentOutcome, fragment)} onSave={onSaveFragment} />
                  ))}
                </FragmentEditor>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
