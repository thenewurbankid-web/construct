import { CloneDialog } from '../components/CloneDialog';
import { CoverageTable } from '../components/CoverageTable';
import { FailureKinds } from '../components/FailureKinds';
import { TestsBanners } from '../components/TestsBanners';
import { EmptyTests } from '../components/EmptyTests';
import { NoFlow } from '../components/NoFlow';
import { RunPanel } from '../components/RunPanel';
import { StepEditorPage, type StepEditorPageProps } from './StepEditorPage';
import type { CloneDialogView, FailureKind, GenerateState, ResultMark, RunPanelProps, StaleOverview, TestsLoad, TestSelection } from '../types';

export type TestsPageProps = {
  feature: string;
  load: TestsLoad;
  summary: string;
  selected: TestSelection | null;
  dialog: CloneDialogView | null;
  generate: GenerateState;
  notice: string | null;
  stale: StaleOverview | null;
  failureKinds: FailureKind[];
  onOpen: (file: string) => void;
  onOpenClone: (name: string) => void;
  onGenerate: () => void;
  onDialogName: (name: string) => void;
  onDialogCreate: () => void;
  onDialogCancel: () => void;
  onDialogShowCode: () => void;
  onDismissNotice: () => void;
  run: RunPanelProps;
  resultOf: (file: string) => ResultMark;
  editor: StepEditorPageProps;
};

// Presentation-only: the stage of the Tests screen. Every state (no feature, loading, error, lock not declared,
// no scenarios, the coverage table, a generate refusal) is drawn here; the work is in the hook.
export function TestsPage(p: TestsPageProps) {
  const data = p.load.status === 'ready' ? p.load.data : null;
  if (p.editor.state.status !== 'idle') return <div className="ts-stage" data-testid="tests-stage"><StepEditorPage {...p.editor} /></div>;
  return (
    <div className="ts-stage" data-testid="tests-stage">
      <div className="ts-toolbar">
        <h1 className="ts-h1">{p.feature ? <><span className="ts-crumb">{p.feature} › tests ›</span> scenarios</> : 'Tests'}</h1>
        <span className="ts-det">DETERMINISTIC</span>
      </div>
      {!p.feature && <p className="hint">Pick a feature in the Browser to see how each way its flow can run is covered by a test.</p>}
      {p.feature && p.load.status === 'loading' && <p className="hint" role="status">Reading the tests of {p.feature}...</p>}
      {p.load.status === 'error' && (
        <div className="ts-banner ts-banner--error" role="alert" data-testid="tests-error">
          <h3>The tests could not be read</h3>
          <p>{p.load.message}</p>
        </div>
      )}
      <TestsBanners data={data} stale={p.stale} generate={p.generate} notice={p.notice} onDismissNotice={p.onDismissNotice} onOpenClone={p.onOpenClone} />
      {data && data.coverage.length === 0 && !data.coverageError && <NoFlow feature={data.feature} skipped={data.skipped} />}
      {data && data.coverage.length > 0 && data.generated.length === 0 && data.yours.length === 0 && <EmptyTests count={data.coverage.length} generating={p.generate.status === 'running'} onGenerate={p.onGenerate} />}
      {data && data.coverage.length > 0 && (
        <>
          <p className="ts-lede">Every way this flow can run, worked out from the flow itself. No one wrote these by hand. Each can become a test.</p>
          {data.generated.length + data.yours.length > 0 && <RunPanel {...p.run} />}
          <CoverageTable rows={data.coverage} selectedFile={p.selected?.area === 'generated' ? p.selected.name : null} generating={p.generate.status === 'running'} resultOf={p.resultOf} onOpen={p.onOpen} onGenerate={p.onGenerate} />
          <p className="ts-foot" data-testid="coverage-summary">{p.summary}. Your own tests sit beside these and are never overwritten.</p>
          <FailureKinds kinds={p.failureKinds} />
        </>
      )}
      {p.dialog && <CloneDialog dialog={p.dialog} onName={p.onDialogName} onCreate={p.onDialogCreate} onCancel={p.onDialogCancel} onShowCode={p.onDialogShowCode} />}
    </div>
  );
}
