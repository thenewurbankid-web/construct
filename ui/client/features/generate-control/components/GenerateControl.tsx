import { generateViewState } from '../domain/GenerateState.ts';
import type { GenerateControlProps } from '../types.ts';
import './generate-control.css';

function formatWillSend(w: NonNullable<GenerateControlProps['willSend']>): string {
  const kb = Math.max(1, Math.round(w.bytes / 1024));
  const files = `${w.files} file${w.files === 1 ? '' : 's'}`;
  const calls = `${w.calls} model call${w.calls === 1 ? '' : 's'}`;
  return `${files}, ~${kb} KB, ${calls}`;
}

/** The inline Generate control (docs/design/ia-five-screens.md section 8.6, issue #382): a
 * split `[Mechanical | AI][Generate]` slot component. Presentational only, and it never
 * calls a write API itself — `mode` is a controlled prop (the caller owns the remembered
 * per-action-kind choice, see `useGenerateMode`), `onRun` hands control back to the caller,
 * whose result lands as a diff in Approvals. */
export function GenerateControl(props: GenerateControlProps) {
  const { actionId, label, mechanical, ai, willSend, target, mode, running, result, onRun, onCancel, onChooseMode } = props;
  const view = generateViewState(props);

  return (
    <div className="gc-control" data-testid="generate-control" data-action-id={actionId} data-view-state={view}>
      <div className="gc-head">
        <span className="gc-label">{label}</span>
        {target && <span className="gc-target" data-testid="generate-target">{target}</span>}
      </div>

      {view !== 'ai-only' && (
        <div className="gc-tags" role="group" aria-label={`Run ${label} as`}>
          <button
            type="button"
            aria-pressed={mode === 'mechanical'}
            disabled={running}
            onClick={() => onChooseMode('mechanical')}
            data-testid="generate-mode-mechanical"
          >
            Mechanical
          </button>
          <button
            type="button"
            aria-pressed={mode === 'ai'}
            disabled={running || !ai?.allowed}
            onClick={() => onChooseMode('ai')}
            data-testid="generate-mode-ai"
            title={ai?.allowed ? undefined : 'AI is not enabled for this action'}
          >
            AI
          </button>
        </div>
      )}

      {view === 'ai-only' && (
        <p className="gc-hint" data-testid="generate-ai-only">AI only &mdash; no block yet. This use is logged as a request for a mechanical block.</p>
      )}

      {view === 'disabled' && (
        <p className="gc-hint" data-testid="generate-disabled-reason">{props.disabledReason}</p>
      )}

      {view === 'refused-offline' && (
        <div className="gc-refused" data-testid="generate-refused-offline">
          <p className="gc-hint">The local model is offline. Nothing was sent.</p>
          <div className="gc-refused-actions">
            <button type="button" onClick={() => onChooseMode('mechanical')} data-testid="generate-use-mechanical">Use Mechanical instead</button>
            <a href="/ollama" data-testid="generate-open-local-model">Open Local model</a>
          </div>
        </div>
      )}

      {view === 'ai-disclosure' && willSend && (
        <p className="gc-hint gc-disclosure" data-testid="generate-will-send">Will send: {formatWillSend(willSend)}</p>
      )}

      {view === 'running' && (
        <div className="gc-running" data-testid="generate-running">
          <span className="gc-hint">Running&hellip;</span>
          <button type="button" onClick={onCancel} data-testid="generate-cancel">Cancel</button>
        </div>
      )}

      {view === 'result' && result && (
        <p className={`gc-result${result.ok ? '' : ' gc-result--fail'}`} data-testid="generate-result">{result.summary}</p>
      )}

      {(view === 'idle' || view === 'ai-disclosure' || view === 'ai-only') && (
        <button type="button" className="gc-run" onClick={() => onRun(mode)} data-testid="generate-run">
          Generate
        </button>
      )}
    </div>
  );
}
