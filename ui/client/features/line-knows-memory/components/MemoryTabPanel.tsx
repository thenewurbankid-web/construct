import type { MemoryTabView } from '@/lib/lineKnowsContract';
import type { MemoryTabScreen } from '../hooks/useMemoryTab';
import { EmbeddingsSwitch, MemoryFileActions } from './MemoryControls';
import { MemoryRecordItem } from './MemoryRecordItem';
import './line-knows-memory.css';

type Step = MemoryTabView['steps'][number];

/** One AI step: how often you decided the same way, then each decision with Edit and Forget. */
function StepSection({ step, screen }: { step: Step; screen: MemoryTabScreen }) {
  const { view, busy, act } = screen;
  const summaries = view.summaries.filter((s) => s.step === step.step);
  const rows = view.rows.filter((r) => r.step === step.step);
  const headingId = `lkm-step-${step.step.replace(/[^a-z0-9-]/g, '-')}`;
  return (
    <section className="lkm-step" aria-labelledby={headingId} data-testid="memory-step-section" data-step={step.step}>
      <div className="lkm-step-head">
        <h3 id={headingId}>{step.label}</h3>
        <span className="lkm-size">{step.size === 1 ? '1 decision' : `${step.size} decisions`}</span>
        <button type="button" className="lkm-forget" onClick={() => act({ kind: 'forgetStep', step: step.step })} disabled={busy} aria-label={`Forget everything for: ${step.label}`}>
          Forget this step
        </button>
      </div>
      <ul className="lkm-summaries" aria-label={`What Line learned: ${step.label}`}>
        {summaries.map((s) => (
          <li key={s.text} data-testid="memory-summary">
            {s.text}
          </li>
        ))}
      </ul>
      <ul className="lkm-records" aria-label={`Each decision: ${step.label}`}>
        {rows.map((row) => (
          <MemoryRecordItem key={row.id} row={row} busy={busy} act={act} />
        ))}
      </ul>
    </section>
  );
}

/** The log of every change a person made to memory, newest first. */
function MemoryLog({ lines }: { lines: string[] }) {
  if (!lines.length) return null;
  return (
    <section className="lkm-log" aria-labelledby="lkm-log-title">
      <h3 id="lkm-log-title">What you changed</h3>
      <ul data-testid="memory-log">
        {lines.map((l, i) => (
          <li key={`${i}-${l}`}>{l}</li>
        ))}
      </ul>
    </section>
  );
}

/** "What Line knows", Memory tab: what Line remembered per AI step, in plain words, and the person's controls. */
export function MemoryTabPanel({ screen }: { screen: MemoryTabScreen }) {
  const { view, message, busy, act, importFile } = screen;
  return (
    <div className="lkm" data-testid="knows-memory" aria-busy={busy}>
      <p className="lk-lead" data-testid="memory-sentence">
        {view.sentence}
      </p>
      <p className="lkm-message" role="status" data-testid="memory-message">
        {message ?? ''}
      </p>
      <div className="lkm-bar">
        <EmbeddingsSwitch on={view.embeddingsOn} runs={view.embeddingsRuns} busy={busy} act={act} />
        <MemoryFileActions busy={busy} act={act} importFile={importFile} empty={view.rows.length === 0} />
      </div>
      {view.steps.map((s) => (
        <StepSection key={s.step} step={s} screen={screen} />
      ))}
      <MemoryLog lines={view.log} />
    </div>
  );
}
