// Pure (DOMAIN-001): one process in display form. Components render these rows as they are.
import type { ArtifactRow, DetailView, ProcessArtifact, ProcessDetail, ProcessStep, ProcessSummary } from '../types.ts';
import { controlButtons } from './ControlButtons.ts';
import { progressPercent, progressText } from './ProcessCounts.ts';
import { clock } from './ProcessClock.ts';
import { pendingNote } from './ListRows.ts';
import { PROVENANCE_MEANING } from './ProvenanceLabels.ts';
import { STATE_LABEL } from './StateLabels.ts';
import { executorLabel, STEP_STATUS_LABEL } from './StepLabels.ts';

function errorText(error: ProcessSummary['error']): string | null {
  if (!error) return null;
  return typeof error === 'string' ? error : (error.message ?? 'The process failed.');
}

function stepNote(step: ProcessStep): string | null {
  if (step.error) return step.error;
  if (step.llm) return `Model: ${step.llm.provider ?? 'unknown'}, ${step.llm.calls ?? 0} call(s)`;
  return null;
}

export function artifactRow(a: ProcessArtifact): ArtifactRow {
  const hash = a.after?.sha256 ?? a.before?.sha256 ?? null;
  return {
    path: a.path,
    change: a.change,
    hash: hash ? hash.slice(0, 10) : 'no hash',
    // Read-only: approving is a later, separate gate. This never offers to apply.
    approval: a.approved === null ? 'Awaiting approval' : a.approved ? 'Approved' : 'Rejected',
  };
}

export function buildDetailView(detail: ProcessDetail): DetailView {
  const s = detail.summary;
  return {
    id: s.id,
    title: s.title,
    state: s.state,
    stateLabel: pendingNote(s) ?? STATE_LABEL[s.state],
    progress: progressText(s.progress),
    percent: progressPercent(s.progress),
    buttons: controlButtons(s.controls),
    steps: detail.steps.map((st) => ({
      id: st.id,
      title: st.title,
      executor: st.executor,
      kind: executorLabel(st.executor),
      status: st.status,
      statusLabel: STEP_STATUS_LABEL[st.status],
      note: stepNote(st),
    })),
    log: detail.log.map((e) => ({ key: e.seq, time: clock(e.at), provenance: e.provenance, meaning: PROVENANCE_MEANING[e.provenance], text: e.message })),
    logHidden: detail.logHidden,
    artifacts: detail.artifacts.map(artifactRow),
    error: errorText(s.error),
  };
}
