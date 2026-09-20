import { CloneDialog } from '../components/CloneDialog';
import { CoverageTable } from '../components/CoverageTable';
import { TestsBanners } from '../components/TestsBanners';
import { StepEditorPage, type StepEditorPageProps } from './StepEditorPage';
import type { CloneDialogView, GenerateState, TestsLoad, TestSelection } from '../types';

export type TestsPageProps = {
  feature: string;
  load: TestsLoad;
  summary: string;
  selected: TestSelection | null;
  dialog: CloneDialogView | null;
  generate: GenerateState;
  notice: string | null;
  onOpen: (file: string) => void;
  onGenerate: () => void;
  onDialogName: (name: string) => void;
  onDialogCreate: () => void;
  onDialogCancel: () => void;
  onDialogShowCode: () => void;
  onDismissNotice: () => void;
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
      <TestsBanners data={data} generate={p.generate} notice={p.notice} onDismissNotice={p.onDismissNotice} />
      {data && data.coverage.length === 0 && !data.coverageError && <p className="hint" data-testid="no-scenarios">This feature has no workflow scenarios to test.</p>}
      {data && data.coverage.length > 0 && (
        <>
          <p className="ts-lede">Every way this flow can run, worked out from the flow itself. No one wrote these by hand. Each can become a test.</p>
          <CoverageTable rows={data.coverage} selectedFile={p.selected?.area === 'generated' ? p.selected.name : null} generating={p.generate.status === 'running'} onOpen={p.onOpen} onGenerate={p.onGenerate} />
          <p className="ts-foot" data-testid="coverage-summary">{p.summary}. Your own tests sit beside these and are never overwritten.</p>
        </>
      )}
      {p.dialog && <CloneDialog dialog={p.dialog} onName={p.onDialogName} onCreate={p.onDialogCreate} onCancel={p.onDialogCancel} onShowCode={p.onDialogShowCode} />}
    </div>
  );
}
