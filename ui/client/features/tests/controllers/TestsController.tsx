'use client';

import { ProjectGateController } from '@/features/project-gate';
import { useRegisterShellTab } from '@/features/shell';
import '../components/tests.css';
import { useTests } from '../hooks/useTests';
import { TestsPage } from '../pages/TestsPage';
import { testsShellTabs } from '../pages/TestsShellTabs';

/** The Tests screen: the coverage table is the stage; the Tests tree (Browser) and the selected Test (Tools) are
 * registered into the shell's slot registry while it is mounted. A generated test is locked: every way of changing
 * it opens the clone dialog. */
export function TestsController() {
  const t = useTests();
  const { state } = t;
  const tabs = testsShellTabs({ ...t, feature: state.feature, selected: state.selected, code: state.code, onFeature: t.pickFeature, onSelect: t.select, onClone: t.openClone, onEditStep: t.editStep, onShowCode: () => t.showCode(), onHideCode: t.hideCode });
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
      />
    </ProjectGateController>
  );
}
