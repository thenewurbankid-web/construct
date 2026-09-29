'use client';

import { useState } from 'react';
import type { ComposeApi, FlowCatalogueEntry } from '../types';

const provenanceLabel = (executor: string): string => (executor === 'deterministic' ? 'Mechanical' : 'AI');

/** A catalogue flow to add, grounded in the real PLAN_FLOWS/block-flows.mjs list (via `/api/plan/context`) --
 * the same picker the Plan screen offers, scoped down to just "pick one, Add". */
function StepPicker({ catalogue, onAdd }: { catalogue: FlowCatalogueEntry[]; onAdd: (flow: FlowCatalogueEntry) => void }) {
  const [selected, setSelected] = useState(catalogue[0]?.id ?? '');
  if (catalogue.length === 0) return null;
  return (
    <form
      className="ev-picker"
      data-testid="compose-picker"
      onSubmit={(e) => {
        e.preventDefault();
        const flow = catalogue.find((f) => f.id === selected);
        if (flow) onAdd(flow);
      }}
    >
      <select data-testid="compose-picker-select" value={selected} onChange={(e) => setSelected(e.target.value)}>
        {catalogue.map((flow) => (
          <option key={flow.id} value={flow.id}>
            {flow.id} -- {flow.summary}
          </option>
        ))}
      </select>
      <button type="submit" className="dg-btn" data-testid="compose-picker-add">
        Add step
      </button>
    </form>
  );
}

/** #395/#771's center stage: the compose draft's step list (add/reorder/remove), each step's Mechanical/AI
 * provenance shown as a chip. No args editing and no save/run yet -- both later slices. */
export function ComposeStage({ compose, catalogue }: { compose: ComposeApi; catalogue: FlowCatalogueEntry[] }) {
  const { steps, loadedFrom } = compose.state;
  return (
    <div className="ev-stage" data-testid="compose-stage">
      <div className="ev-stage-bar">
        <span className="ev-summary" data-testid="compose-loaded-from">
          {loadedFrom ? `Loaded from "${loadedFrom}"` : 'New flow'}
        </span>
        <button type="button" className="dg-btn" data-testid="compose-new" onClick={compose.newFlow} disabled={steps.length === 0 && !loadedFrom}>
          New flow
        </button>
      </div>
      {steps.length === 0 ? (
        <p className="hint" data-testid="compose-empty">
          No steps yet. Pick one below to add it.
        </p>
      ) : (
        <ol className="ev-steps" aria-label="Compose draft steps" data-testid="compose-steps">
          {steps.map((step, index) => (
            <li key={step.id} className="ev-step" data-testid="compose-step" data-step={step.id}>
              <span className="ev-step-title">{step.title}</span>
              <code className="ev-step-flow">{step.flow}</code>
              <span className={`ev-provenance ev-provenance--${step.executor === 'deterministic' ? 'mechanical' : 'ai'}`} data-testid="compose-step-provenance">
                {provenanceLabel(step.executor)}
              </span>
              <div className="ev-step-actions">
                <button type="button" className="dg-btn" data-testid="compose-step-up" onClick={() => compose.moveStep(step.id, -1)} disabled={index === 0}>
                  Up
                </button>
                <button type="button" className="dg-btn" data-testid="compose-step-down" onClick={() => compose.moveStep(step.id, 1)} disabled={index === steps.length - 1}>
                  Down
                </button>
                <button type="button" className="dg-btn" data-testid="compose-step-remove" onClick={() => compose.removeStep(step.id)}>
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ol>
      )}
      <StepPicker catalogue={catalogue} onAdd={compose.addStep} />
    </div>
  );
}
