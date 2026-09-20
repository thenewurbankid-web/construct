'use client';

import { useMemo } from 'react';
import { useRegisterShellTab } from '@/features/shell';
import { groupByFeature } from '../domain/FeatureGrouping';
import { groupByLayer } from '../domain/LayerGrouping';
import { flatFiles } from '../domain/TreeFiles';
import { buildIndicatorCards, changeHeadline } from '../domain/IndicatorView';
import { buildUnitsView } from '../domain/UnitRows';
import { useReviewChange } from '../hooks/useReviewChange';
import { useReviewRoute } from '../hooks/useReviewRoute';
import { ReviewChangePage } from '../pages/ReviewChangePage';
import { changeShellTabs } from '../pages/ReviewShellTabs';

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

/** Review mode, one change: changed units grouped by feature then layer, what each now does, the indicators. */
export function ReviewChangeController({ base, head }: { base: string; head: string }) {
  const route = useReviewRoute();
  const { state, select, setGrouping } = useReviewChange(base, head);
  const report = state.status === 'ready' ? (state.data?.report ?? null) : null;

  const files = report?.change.files ?? [];
  const byFeature = useMemo(() => groupByFeature(files), [files]);
  const byLayer = useMemo(() => groupByLayer(files), [files]);
  const layerCount = new Set(files.map((f) => f.layer ?? 'unclassified')).size;
  const unmeasured = !!report?.indicators.find((i) => i.id === 'blast-radius' && !i.measured);
  const units = report ? buildUnitsView(files, state.data?.units ?? [], state.data?.unitsOmitted ?? 0) : null;
  const cards = report ? buildIndicatorCards(report.indicators) : null;

  const tabs = changeShellTabs(
    report
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
    report ? report.findings.length : null,
  );
  useRegisterShellTab('browser', tabs.browser);
  useRegisterShellTab('tools', tabs.tools);

  return (
    <ReviewChangePage
      status={state.status}
      head={head}
      base={base}
      subject={state.data?.head.subject ?? null}
      headline={report ? changeHeadline(report.summary, unmeasured) : null}
      error={state.error}
      degraded={report?.degraded?.message ?? null}
      units={units ? { rows: units.rows, more: units.more, selectedPath: state.selectedPath, onSelect: select } : null}
      onBack={() => route.openList(base)}
      onRetry={() => route.openChange(base, head)}
    />
  );
}
