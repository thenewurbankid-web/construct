'use client';

import { GenerateControl, useGenerateMode } from '@/features/generate-control';
import { useSuggestedNextSteps } from '../hooks/useSuggestedNextSteps';
import type { PageTree } from '../types';

type SuggestedNextStepsProps = {
  feature: string;
  file: string;
  nodeId: string;
  contentHash: string;
  onSaved: (tree: PageTree) => void;
};

/** The inspector's "Suggested next steps" list on a newly created page (mock `ia-pages-next`,
 * issue #382): the inline Generate control, wired to the three actions named in the issue.
 * Shown only via the caller's own "looks freshly created" check (InspectorPanel: no props
 * wired yet) — quiet by default, per the slot contract's "only on the selected item". */
export function SuggestedNextSteps({ feature, file, nodeId, contentHash, onSaved }: SuggestedNextStepsProps) {
  const layers = useGenerateMode('add-missing-layers');
  const automap = useGenerateMode('automap-props');
  const tests = useGenerateMode('generate-tests');
  const { runs, runAutoMap, runGenerateTests, cancel } = useSuggestedNextSteps(feature, file, nodeId, contentHash, onSaved);

  return (
    <div className="suggested-next-steps" data-testid="suggested-next-steps">
      <h4>Suggested next steps</h4>
      <GenerateControl
        actionId="add-missing-layers"
        actionKind="add-missing-layers"
        label="Add missing layer files"
        mechanical={null}
        ai={null}
        willSend={null}
        target={feature}
        disabledReason="Not wired yet: needs a server endpoint over `construct create layer --layers`."
        modelOffline={layers.modelOffline}
        mode={layers.mode}
        running={false}
        result={null}
        onRun={() => {}}
        onCancel={() => {}}
        onChooseMode={layers.chooseMode}
      />
      <GenerateControl
        actionId="automap-props"
        actionKind="automap-props"
        label="Auto-map props"
        mechanical={{ block: 'pages/automap', command: 'POST /api/pages/automap' }}
        ai={null}
        willSend={null}
        target={file}
        modelOffline={automap.modelOffline}
        mode={automap.mode}
        running={runs['automap-props'].running}
        result={runs['automap-props'].result}
        onRun={runAutoMap}
        onCancel={() => cancel('automap-props')}
        onChooseMode={automap.chooseMode}
      />
      <GenerateControl
        actionId="generate-tests"
        actionKind="generate-tests"
        label="Generate tests for this route"
        mechanical={{ block: 'testGenerator', command: 'construct generate tests' }}
        ai={null}
        willSend={null}
        target={feature}
        modelOffline={tests.modelOffline}
        mode={tests.mode}
        running={runs['generate-tests'].running}
        result={runs['generate-tests'].result}
        onRun={runGenerateTests}
        onCancel={() => cancel('generate-tests')}
        onChooseMode={tests.chooseMode}
      />
    </div>
  );
}
