'use client';

import { ProjectGateController } from '@/features/project-gate';
import { useRegisterShellTab } from '@/features/shell';
import '../components/tests.css';
import { useStepEditor } from '../hooks/useStepEditor';
import { useTests } from '../hooks/useTests';
import { TestsPage } from '../pages/TestsPage';
import { testsShellTabs } from '../pages/TestsShellTabs';

/** The Tests screen: the coverage table is the stage; the Tests tree (Browser) and the selected Test (Tools) are
 * registered into the shell's slot registry while it is mounted. A generated test is locked: every way of changing
 * it opens the clone dialog. */
export function TestsController() {
  const t = useTests();
  const { state } = t;
  const ed = useStepEditor(state.feature);
  const tabs = testsShellTabs({ ...t, feature: state.feature, selected: state.selected, code: state.code, onFeature: t.pickFeature, onSelect: t.select, onClone: t.openClone, onEditStep: t.editStep, onShowCode: () => t.showCode(), onHideCode: t.hideCode, onEditSteps: ed.open });
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
        onOpen={(file) => t.select({ area: 'generated', name: file })}
        onGenerate={t.generate}
        onDialogName={t.editName}
        onDialogCreate={t.submitClone}
        onDialogCancel={t.closeDialog}
        onDialogShowCode={t.showCodeFromDialog}
        onDismissNotice={t.dismissNotice}
        editor={{ state: ed.state, view: ed.view, onClose: ed.close, onSelect: ed.select, onPatch: ed.patch, onAdd: ed.add, onRemove: ed.remove, onRestore: ed.restore, onMove: ed.move, onDiscard: ed.discard, onReview: ed.review, onBack: ed.back, onConfirm: ed.confirm, onReload: ed.reopen }}
      />
    </ProjectGateController>
  );
}
