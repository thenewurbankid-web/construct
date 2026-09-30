'use client';

import { useState } from 'react';
import type { ComposeApi, EnvelopePreview, FlowCatalogueEntry, RunApi, SaveApi } from '../types';

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
      <select data-testid="compose-picker-select" aria-label="Flow to add" value={selected} onChange={(e) => setSelected(e.target.value)}>
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

/** #395/#772's right panel: the envelope the selected step would receive, in schemas/envelope.v1.json's input
 * shape -- computed deterministically server-side (no generator runs). */
function PreviewPanel({ preview, error }: { preview: EnvelopePreview | null; error: string | null }) {
  if (error) {
    return (
      <p className="ev-row-error" role="alert" data-testid="compose-preview-error">
        {error}
      </p>
    );
  }
  if (!preview) return null;
  return (
    <div className="ev-preview" data-testid="compose-preview">
      <p className="ev-preview-title">Envelope this step would receive</p>
      <pre className="ev-diff" data-testid="compose-preview-json">{JSON.stringify(preview, null, 2)}</pre>
    </div>
  );
}

/** #395/#772's "Save this flow": name the draft, preview it, Save to commit through #759's saveFlow. */
function SavePanel({ save, disabled }: { save: SaveApi; disabled: boolean }) {
  const { state } = save;
  return (
    <div className="ev-save" data-testid="compose-save">
      <form
        className="ev-picker"
        onSubmit={(e) => {
          e.preventDefault();
          save.preview();
        }}
      >
        <input
          type="text"
          placeholder="Flow name, e.g. scaffold-checkout"
          aria-label="Flow name"
          value={state.name}
          onChange={(e) => save.setName(e.target.value)}
          data-testid="compose-save-name"
          disabled={disabled || state.status === 'previewing' || state.status === 'saving'}
          required
        />
        <button type="submit" className="dg-btn" data-testid="compose-save-preview" disabled={disabled || !state.name.trim() || state.status === 'previewing' || state.status === 'saving'}>
          {state.status === 'previewing' ? 'Checking...' : 'Save this flow'}
        </button>
      </form>
      {state.status === 'ready' && (
        <div className="ev-edit-actions">
          <button type="button" className="dg-btn dg-btn--primary" data-testid="compose-save-confirm" onClick={save.confirm}>
            Confirm save
          </button>
          <button type="button" className="dg-btn" data-testid="compose-save-cancel" onClick={save.cancel}>
            Cancel
          </button>
        </div>
      )}
      {state.status === 'saving' && <p className="hint">Saving...</p>}
      {state.status === 'saved' && (
        <p className="hint" data-testid="compose-save-done">
          Saved.
        </p>
      )}
      {state.status === 'error' && (
        <p className="ev-row-error" role="alert" data-testid="compose-save-error">
          {state.error}
        </p>
      )}
    </div>
  );
}

/** #395/#772's "Run this flow": the same Process/Approvals path Plan mode's "Run plan" uses -- once started,
 * points at the Processes drawer, where the work is watched and approved. */
function RunBar({ run, disabled, onOpenProcesses }: { run: RunApi; disabled: boolean; onOpenProcesses: () => void }) {
  const { state } = run;
  return (
    <div className="ev-run" data-testid="compose-run">
      {state.status === 'started' && (
        <p className="ev-run-ok" role="status" data-testid="compose-run-started">
          Started. Watch it and approve its changes in the Processes drawer.{' '}
          <button type="button" className="dg-btn" onClick={onOpenProcesses} data-testid="compose-open-processes">
            Open Processes
          </button>
        </p>
      )}
      {state.status === 'error' && (
        <p className="ev-row-error" role="alert" data-testid="compose-run-error">
          {state.error}
        </p>
      )}
      <button type="button" className="dg-btn dg-btn--primary" data-testid="compose-run-button" onClick={run.run} disabled={disabled || state.status === 'loading'}>
        {state.status === 'loading' ? 'Starting...' : 'Run this flow'}
      </button>
      <p className="hint">One bot at a time, in its own branch. Nothing reaches your project until you approve it.</p>
    </div>
  );
}

/** #395/#771/#772's center stage: the compose draft's step list (add/reorder/remove), each step's
 * Mechanical/AI provenance shown as a chip, a per-step envelope preview, "Save this flow", and "Run this
 * flow" through the existing Process/Approvals path. */
export function ComposeStage({
  compose,
  catalogue,
  save,
  run,
  onOpenProcesses,
  previews,
  previewError,
  selected,
  onSelect,
}: {
  compose: ComposeApi;
  catalogue: FlowCatalogueEntry[];
  save: SaveApi;
  run: RunApi;
  onOpenProcesses: () => void;
  previews: EnvelopePreview[];
  previewError: string | null;
  selected: number | null;
  onSelect: (index: number | null) => void;
}) {
  const { steps, loadedFrom } = compose.state;
  return (
    <div className="ev-stage" data-testid="compose-stage">
      <div className="ev-stage-bar">
        <span className="ev-summary" data-testid="compose-loaded-from">
          {loadedFrom ? `Loaded from "${loadedFrom}"` : 'New flow'}
        </span>
        <button
          type="button"
          className="dg-btn"
          data-testid="compose-new"
          onClick={() => {
            compose.newFlow();
            onSelect(null);
          }}
          disabled={steps.length === 0 && !loadedFrom}
        >
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
                <button type="button" className="dg-btn" data-testid="compose-step-preview" onClick={() => onSelect(selected === index ? null : index)} aria-pressed={selected === index}>
                  {selected === index ? 'Hide preview' : 'Preview'}
                </button>
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
      {selected !== null && <PreviewPanel preview={previews[selected] ?? null} error={previewError} />}
      <StepPicker catalogue={catalogue} onAdd={compose.addStep} />
      <SavePanel save={save} disabled={steps.length === 0} />
      <RunBar run={run} disabled={steps.length === 0} onOpenProcesses={onOpenProcesses} />
    </div>
  );
}
