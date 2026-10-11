import { FolderPicker } from '../components/FolderPicker';
import { ImportNotice } from '../components/ImportNotice';
import { PlanSection } from '../components/PlanSection';
import { QuestionList } from '../components/QuestionList';
import { ScanSection } from '../components/ScanSection';
import type { ImportControls } from '../types';

/** /import: bring one folder of an existing app into Line (partial migration). Pick the folder, read what Line proposes,
 * answer only what it cannot decide, see the plan's steps, Apply. */
export function LineImportPage({ controls }: { controls: ImportControls }) {
  const { state, view, setFolder, scan, answer, plan, apply, undo, leave } = controls;
  return (
    <div className="li-stage" data-testid="line-import">
      <header className="li-head">
        <p className="li-eyebrow">Line</p>
        <h1 className="li-h1">Import an app</h1>
        <p className="li-hint">Bring one folder of an app that was not built with Line into Line, step by step.</p>
        <a className="li-hint" href="/import/agent" data-testid="li-agent-link">Or let the Import agent plan it for you to review and approve, step by step.</a>
      </header>
      <FolderPicker folders={state.folders} folder={state.folder} busy={view.busy} onFolder={setFolder} onScan={scan} />
      <ImportNotice result={state.result} error={state.error} />
      <ScanSection view={view} />
      <QuestionList questions={view.questions} busy={view.busy} onAnswer={answer} />
      <PlanSection view={view} plan={state.plan} result={state.result} onPlan={plan} onApply={apply} onUndo={undo} onLeave={leave} />
    </div>
  );
}
