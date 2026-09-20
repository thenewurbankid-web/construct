import { useEffect, useRef, type ReactNode } from 'react';
import { CreateForm } from './CreateForm';
import { ImportForm } from './ImportForm';
import { RefactorForm } from './RefactorForm';
import { ResearchForm } from './ResearchForm';
import type { useDashboard } from '../hooks/useDashboard';
import { STAGE_ACTIONS, type StageActionId } from '../domain/StageActions';

type StageActionsProps = ReturnType<typeof useDashboard> & {
  open: StageActionId | null;
  onToggle: (id: StageActionId) => void;
  /** A banner shown above the actions (the local model is offline). */
  notice?: ReactNode;
};

/**
 * The Features stage's actions (#370): Create, Refactor, Research and Import, the four command forms the
 * retired Dashboard showed all at once. Collapsed by default so the stage stays quiet; choosing one opens its
 * form right here, with the same fields, the same deterministic result and the same attribution as before.
 * Presentation only (COMPONENT-*): the forms' state lives in useDashboard.
 */
export function StageActions({ create, refactor, research, importForm, open, onToggle, notice }: StageActionsProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  // Choosing an action moves focus to its form, so a keyboard user lands where the fields are.
  useEffect(() => {
    if (open) panelRef.current?.focus();
  }, [open]);

  return (
    <section className="sa" aria-label="Stage actions" data-testid="stage-actions">
      <div className="sa-row">
        <span className="sa-label" id="sa-label">Start something</span>
        <div className="sa-buttons" role="group" aria-labelledby="sa-label">
          {STAGE_ACTIONS.map((a) => (
            <button
              key={a.id}
              type="button"
              className="sa-btn"
              aria-expanded={open === a.id}
              aria-controls="sa-panel"
              title={a.hint}
              data-testid={`stage-action-${a.id}`}
              onClick={() => onToggle(a.id)}
            >
              {a.label}
            </button>
          ))}
        </div>
      </div>
      {notice}
      {open && (
        <div id="sa-panel" ref={panelRef} tabIndex={-1} className="sa-panel" role="region" aria-label={STAGE_ACTIONS.find((a) => a.id === open)?.label} data-testid="stage-action-panel">
          {open === 'create' && <CreateForm {...create} />}
          {open === 'refactor' && <RefactorForm {...refactor} />}
          {open === 'research' && <ResearchForm {...research} />}
          {open === 'import' && <ImportForm {...importForm} />}
        </div>
      )}
    </section>
  );
}
