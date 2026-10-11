import { LoadingState } from '@/features/states';
import type { DetailState } from '../types';
import { AutoSummary } from './AutoSummary';
import { ItemGroupList } from './ItemGroupList';
import { SpecStories } from './SpecStories';

type FeatureDetailPanelProps = { feature: string | null; detail: DetailState };

/** The chosen feature: what it owns, the Auto summary and its spec; a hint before one is chosen. */
export function FeatureDetailPanel({ feature, detail }: FeatureDetailPanelProps) {
  if (!feature) return <p className="hint">Pick a feature to see everything it owns, what it is built on and how much of its spec is covered.</p>;
  if (detail.phase === 'error') return <p className="lf-error" role="alert">{detail.sentence}</p>;
  if (detail.phase !== 'ready') return <LoadingState size="inline" label={`Reading ${feature}`} />;
  return (
    <div className="lf-detail" data-testid="lf-detail">
      <p className="lf-eyebrow">Feature: {feature}</p>
      <div className="lf-layout">
        <ItemGroupList groups={detail.groups} />
        <div className="lf-side">
          <AutoSummary sentences={detail.detail.summary.sentences} />
          <SpecStories spec={detail.spec} />
        </div>
      </div>
    </div>
  );
}
