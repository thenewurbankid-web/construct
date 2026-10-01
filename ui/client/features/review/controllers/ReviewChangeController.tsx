'use client';

import { useCallback, useMemo, useState } from 'react';
import { useRegisterShellTab } from '@/features/shell';
import { usePreview } from '@/features/live-preview';
import { buildBlastView } from '../domain/BlastView';
import { describeFailure } from '../domain/FailureView';
import { groupByFeature } from '../domain/FeatureGrouping';
import { buildFindingDetail, buildFindingsView } from '../domain/FindingsView';
import { groupByLayer } from '../domain/LayerGrouping';
import { flatFiles } from '../domain/TreeFiles';
import { buildTreeNodes } from '../domain/TreeNodes';
import { degradedNotice } from '../domain/DegradedNotice';
import { buildIndicatorCards, changeHeadline } from '../domain/IndicatorView';
import { buildUnitsView } from '../domain/UnitRows';
import { useFailureActions } from '../hooks/useFailureActions';
import { useReviewChange } from '../hooks/useReviewChange';
import { useReviewPlans } from '../hooks/useReviewPlans';
import { useReviewRoute } from '../hooks/useReviewRoute';
import { useTreeNavigation } from '../hooks/useTreeNavigation';
import { ReviewChangePage } from '../pages/ReviewChangePage';
import { changeBrowserTabs, changeDrawerTabs, changeToolsTabs } from '../pages/ReviewShellTabs';

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

/** Review mode, one change: changed units, what each now does, the indicators, the findings and the scope. */
export function ReviewChangeController({ base, head }: { base: string; head: string }) {
  const route = useReviewRoute();
  const plans = useReviewPlans();
  // #838 -- "Preview beside": off by default, no selection-sharing on the Git screen (unlike Tests, #839).
  const [previewOn, setPreviewOn] = useState(false);
  const togglePreview = useCallback(() => setPreviewOn((v) => !v), []);
  const preview = usePreview();
  const { state, select, selectFinding, setGrouping, reload, cancel } = useReviewChange(base, head, route.plan);
  const report = state.status === 'ready' ? (state.data?.report ?? null) : null;

  const files = report?.change.files ?? [];
  const byFeature = useMemo(() => groupByFeature(files), [files]);
  const byLayer = useMemo(() => groupByLayer(files), [files]);
  const layerCount = new Set(files.map((f) => f.layer ?? 'unclassified')).size;
  const flat = useMemo(() => flatFiles(files), [files]);
  const nodes = useMemo(() => buildTreeNodes(state.grouping, byFeature, byLayer, flat), [state.grouping, byFeature, byLayer, flat]);
  const nav = useTreeNavigation(nodes, state.selectedPath, select);
  const blast = report ? buildBlastView(report) : null;
  const unmeasured = blast ? !blast.measured : false;
  const units = report ? buildUnitsView(files, state.data?.units ?? [], state.data?.unitsOmitted ?? 0) : null;
  const cards = report ? buildIndicatorCards(report.indicators) : null;
  const findings = report ? buildFindingsView(report.findings, report.indicators, state.selectedFindingId) : null;
  const detail = report ? buildFindingDetail(report.findings, state.selectedFindingId) : null;
  const degraded = degradedNotice(report?.degraded ?? null);
  const scope = blast ? { view: blast, picker: { plans, selected: route.plan, selectedTitle: state.data?.plan?.title ?? null, onPick: (id: string | null) => route.setPlan(base, head, id) } } : null;
  const onCloseFinding = () => selectFinding(null);

  const browserTabs = changeBrowserTabs({
    tree: report
      ? {
          grouping: state.grouping,
          onGrouping: setGrouping,
          totals: `${plural(files.length, 'file')} · ${plural(byFeature.filter((f) => !f.outside).length, 'feature')} · ${plural(layerCount, 'layer')}`,
          ariaLabel: { feature: 'Changed units by feature', layer: 'Changed units by layer', files: 'Changed files' }[state.grouping],
          nodes,
          selectedPath: state.selectedPath,
          onSelect: select,
          nav,
        }
      : null,
    onBack: () => route.openList(base),
  });
  const toolsTabs = changeToolsTabs({
    cards,
    findings: findings ? { view: findings, onSelect: selectFinding } : null,
    detail,
    onCloseFinding,
    scope,
  });
  const drawerTabs = changeDrawerTabs({
    summary: findings ? { summary: findings.summary, mechanical: findings.mechanical.length, conversation: findings.conversation.length, degraded } : null,
    count: findings ? findings.total : null,
  });
  useRegisterShellTab('browser', browserTabs.changes);
  useRegisterShellTab('browser', browserTabs.branches);
  useRegisterShellTab('browser', browserTabs.prs);
  useRegisterShellTab('browser', browserTabs.commits);
  useRegisterShellTab('tools', toolsTabs.health);
  useRegisterShellTab('tools', toolsTabs.findings);
  useRegisterShellTab('tools', toolsTabs.detail);
  useRegisterShellTab('tools', toolsTabs.planMatch);
  useRegisterShellTab('tools', toolsTabs.commit);
  useRegisterShellTab('drawer', drawerTabs.drawer);

  const onFailureAction = useFailureActions({ retry: reload, list: () => route.openList(base), noPlan: () => route.setPlan(base, head, null) });

  return (
    <ReviewChangePage
      status={state.status}
      head={head}
      base={base}
      subject={state.data?.head.subject ?? null}
      headline={report ? changeHeadline(report.summary, unmeasured) : null}
      failure={state.status === 'failed' ? describeFailure(state.errorCode, state.error) : null}
      degraded={degraded}
      scope={scope}
      finding={detail}
      units={units ? { rows: units.rows, more: units.more, selectedPath: state.selectedPath, onSelect: select } : null}
      onBack={() => route.openList(base)}
      onCancel={cancel}
      onFailureAction={onFailureAction}
      onCloseFinding={onCloseFinding}
      previewOn={previewOn}
      onTogglePreview={togglePreview}
      previewView={preview.view}
    />
  );
}
