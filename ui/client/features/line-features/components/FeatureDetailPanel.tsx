import type { ReactNode } from 'react';
import { LoadingState } from '@/features/states';
import type { DetailState, FeatureTab, LineFeatureDetail, ItemGroup, SpecView } from '../types';
import { AutoSummary } from './AutoSummary';
import { FeatureTabs } from './FeatureTabs';
import { ItemGroupList } from './ItemGroupList';
import { SpecStories } from './SpecStories';

type FeatureDetailPanelProps = { feature: string | null; detail: DetailState; tab: FeatureTab; onTab: (tab: FeatureTab) => void; workflows: ReactNode; item?: string | null; part?: string | null };
type Ready = { detail: LineFeatureDetail; groups: ItemGroup[]; spec: SpecView | null };

/** The open tab's content: the feature's workflows, or the Overview (what it owns, the Auto summary and its spec). */
function TabBody({ tab, ready, workflows, item, part }: { tab: FeatureTab; ready: Ready; workflows: ReactNode; item: string | null; part: string | null }) {
  if (tab === 'workflows') return <>{workflows}</>;
  return (
    <div className="lf-layout">
      <ItemGroupList groups={ready.groups} open={item} part={part} />
      <div className="lf-side">
        <AutoSummary sentences={ready.detail.summary.sentences} />
        <SpecStories spec={ready.spec} />
      </div>
    </div>
  );
}

/** The chosen feature: the Overview tab (what it owns, the Auto summary and its spec) or its Workflows tab; a hint
 * before one is chosen. */
export function FeatureDetailPanel({ feature, detail, tab, onTab, workflows, item = null, part = null }: FeatureDetailPanelProps) {
  if (!feature) return <p className="hint">Pick a feature to see everything it owns, what it is built on and how much of its spec is covered.</p>;
  if (detail.phase === 'error') return <p className="lf-error" role="alert">{detail.sentence}</p>;
  if (detail.phase !== 'ready') return <LoadingState size="inline" label={`Reading ${feature}`} />;
  return (
    <div className="lf-detail" data-testid="lf-detail">
      <p className="lf-eyebrow">Feature: {feature}</p>
      <FeatureTabs feature={feature} tab={tab} onTab={onTab} />
      <div role="tabpanel" id={`lf-panel-${tab}`} aria-labelledby={`lf-tab-${tab}`}>
        <TabBody tab={tab} ready={detail} workflows={workflows} item={item} part={part} />
      </div>
    </div>
  );
}
