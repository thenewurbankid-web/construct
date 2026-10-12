import type { ReactNode } from 'react';
import type { LineFeaturesView } from '../types';
import { FeatureCardList } from './FeatureCardList';
import { FeatureDetailPanel } from './FeatureDetailPanel';

/** What Features shows beside (or under) the chat: the open feature's page, or every feature as a card. */
export function FeaturesView({ view, workflows }: { view: LineFeaturesView; workflows: ReactNode }) {
  const { feature, detail, tab, chooseTab, item, part } = view;
  if (!feature) {
    return (
      <>
        <header className="lf-head">
          <h1 className="lf-title">Features</h1>
          <p className="ln-muted">Pick a feature to see everything it owns.</p>
        </header>
        <FeatureCardList features={view.features} current={feature} onChoose={view.choose} />
      </>
    );
  }
  return (
    <>
      <header className="lf-head">
        <h1 className="lf-title">{feature}</h1>
        <p className="ln-muted">A feature owns its pages, components, workflows and fixtures; each one is based on one item from your library.</p>
      </header>
      <FeatureDetailPanel feature={feature} detail={detail} tab={tab} onTab={chooseTab} workflows={workflows} item={item} part={part} />
    </>
  );
}
