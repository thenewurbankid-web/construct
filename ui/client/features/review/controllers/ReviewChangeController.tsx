'use client';

import { useMemo } from 'react';
import { useRegisterShellTab } from '@/features/shell';
import { buildBlastView } from '../domain/BlastView';
import { describeFailure } from '../domain/FailureView';
import { groupByFeature } from '../domain/FeatureGrouping';
import { buildFindingDetail, buildFindingsView } from '../domain/FindingsView';
import { groupByLayer } from '../domain/LayerGrouping';
import { flatFiles } from '../domain/TreeFiles';
import { degradedNotice } from '../domain/DegradedNotice';
import { buildIndicatorCards, changeHeadline } from '../domain/IndicatorView';
import { buildUnitsView } from '../domain/UnitRows';
import { useFailureActions } from '../hooks/useFailureActions';
import { useReviewChange } from '../hooks/useReviewChange';
import { useReviewPlans } from '../hooks/useReviewPlans';
import { useReviewRoute } from '../hooks/useReviewRoute';
import { ReviewChangePage } from '../pages/ReviewChangePage';
import { changeShellTabs } from '../pages/ReviewShellTabs';

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

/** Review mode, one change: changed units, what each now does, the indicators, the findings and the scope. */
export function ReviewChangeController({ base, head }: { base: string; head: string }) {
  const route = useReviewRoute();
  const plans = useReviewPlans();
  const { state, select, selectFinding, setGrouping, reload } = useReviewChange(base, head, route.plan);
  const report = state.status === 'ready' ? (state.data?.report ?? null) : null;

  const files = report?.change.files ?? [];
  const byFeature = useMemo(() => groupByFeature(files), [files]);
  const byLayer = useMemo(() => groupByLayer(files), [files]);
  const layerCount = new Set(files.map((f) => f.layer ?? 'unclassified')).size;
  const blast = report ? buildBlastView(report) : null;
  const unmeasured = blast ? !blast.measured : false;
  const units = report ? buildUnitsView(files, state.data?.units ?? [], state.data?.unitsOmitted ?? 0) : null;
  const cards = report ? buildIndicatorCards(report.indicators) : null;
  const findings = report ? buildFindingsView(report.findings, report.indicators, state.selectedFindingId) : null;
  const detail = report ? buildFindingDetail(report.findings, state.selectedFindingId) : null;
  const degraded = degradedNotice(report?.degraded ?? null);

  const tabs = changeShellTabs({
    tree: report
      ? {
          grouping: state.grouping,
          onGrouping: setGrouping,
          totals: `${plural(files.length, 'file')} · ${plural(byFeature.filter((f) => !f.outside).length, 'feature')} · ${plural(layerCount, 'layer')}`,
          byFeature,
          byLayer,
          flat: flatFiles(files),
          selectedPath: state.selectedPath,
          onSelect: select,
        }
      : null,
    cards,
    findings: findings ? { view: findings, onSelect: selectFinding } : null,
    summary: findings ? { summary: findings.summary, mechanical: findings.mechanical.length, conversation: findings.conversation.length, degraded } : null,
  });
  useRegisterShellTab('browser', tabs.browser);
  useRegisterShellTab('tools', tabs.tools);
  useRegisterShellTab('tools', tabs.findings);
  useRegisterShellTab('drawer', tabs.drawer);

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
      scope={blast ? { view: blast, picker: { plans, selected: route.plan, selectedTitle: state.data?.plan?.title ?? null, onPick: (id) => route.setPlan(base, head, id) } } : null}
      finding={detail}
      units={units ? { rows: units.rows, more: units.more, selectedPath: state.selectedPath, onSelect: select } : null}
      onBack={() => route.openList(base)}
      onFailureAction={onFailureAction}
      onCloseFinding={() => selectFinding(null)}
    />
  );
}
