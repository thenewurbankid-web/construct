'use client';

import { ProjectGateController } from '@/features/project-gate';
import { useRegisterShellTab } from '@/features/shell';
import '../components/tests.css';
import { useStepEditor } from '../hooks/useStepEditor';
import { useTestRuns } from '../hooks/useTestRuns';
import { useTests } from '../hooks/useTests';
import { outcomeFor } from '../domain/Runs';
import { TestsPage } from '../pages/TestsPage';
import { testsShellTabs } from '../pages/TestsShellTabs';

/** The Tests screen: the coverage table is the stage; the Tests tree (Browser) and the selected Test (Tools) are
 * registered into the shell's slot registry while it is mounted. A generated test is locked: every way of changing
 * it opens the clone dialog. */
export function TestsController() {
  const t = useTests();
  const { state } = t;
  const ed = useStepEditor(state.feature);
  const runs = useTestRuns(state.feature);
  const oneRun = { outcome: t.test ? outcomeFor(runs.snap, t.test.area, t.test.name) : null, busy: !!runs.live, copied: runs.copied, onRun: () => { if (t.test) void runs.start({ name: t.test.name, area: t.test.area }); }, onCopy: runs.copy };
  const tabs = testsShellTabs({ ...t, feature: state.feature, selected: state.selected, code: state.code, comparison: t.comparison, run: oneRun, cloneTag: t.cloneTag, onFeature: t.pickFeature, onSelect: t.select, onClone: t.openClone, onEditStep: t.editStep, onShowCode: () => t.showCode(), onHideCode: t.hideCode, onEditSteps: ed.open });
  useRegisterShellTab('browser', tabs.browser);
  useRegisterShellTab('tools', tabs.tools);

  return (
    <ProjectGateController>
      <TestsPage
        feature={state.feature}
        load={state.load}
        summary={t.summary}
        selected={state.selected}
        dialog={t.dialogView}
        generate={state.generate}
        notice={state.notice}
        stale={t.stale}
        failureKinds={t.failureKinds}
        onOpen={(file) => t.select({ area: 'generated', name: file })}
        onOpenClone={(name) => t.select({ area: 'yours', name })}
        onGenerate={t.generate}
        onDialogName={t.editName}
        onDialogCreate={t.submitClone}
        onDialogCancel={t.closeDialog}
        onDialogShowCode={t.showCodeFromDialog}
        onDismissNotice={t.dismissNotice}
        run={{
          feature: state.feature, snap: runs.snap, live: runs.live, address: runs.address, refused: runs.refused, copied: runs.copied,
          canRun: !!state.feature && state.load.status === 'ready',
          onAddress: runs.setAddress, onRunAll: () => void runs.start(null), onCancel: () => void runs.cancel(), onCopy: runs.copy,
          onOpenTest: (area, file) => t.select({ area, name: file }),
        }}
        editor={{ state: ed.state, view: ed.view, onClose: ed.close, onSelect: ed.select, onPatch: ed.patch, onAdd: ed.add, onRemove: ed.remove, onRestore: ed.restore, onMove: ed.move, onDiscard: ed.discard, onReview: ed.review, onBack: ed.back, onConfirm: ed.confirm, onReload: ed.reopen }}
      />
    </ProjectGateController>
  );
}
