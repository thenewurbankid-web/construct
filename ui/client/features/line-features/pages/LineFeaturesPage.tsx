import { LoadingState } from '@/features/states';
import { FeatureCardList } from '../components/FeatureCardList';
import { FeatureDetailPanel } from '../components/FeatureDetailPanel';
import '../components/line-features.css';
import type { LineFeaturesView } from '../types';

/** The Features view of a Line project: every feature with "All fine" or "Needs attention"; the chosen one with its
 * items by kind (base, status, findings), the Auto summary and how much of its spec is covered. */
export function LineFeaturesPage({ view, reading }: { view: LineFeaturesView; reading: boolean }) {
  const { features, feature, choose, detail } = view;
  if (reading) return <LoadingState size="inline" label="Reading the features" />;
  return (
    <section className="lf" data-testid="line-features" aria-labelledby="lf-title">
      <div>
        <h2 id="lf-title">Your features</h2>
        <p className="hint">A feature owns its pages, components, workflows and fixtures; each one is based on one item from your library.</p>
      </div>
      <FeatureCardList features={features} current={feature} onChoose={choose} />
      <FeatureDetailPanel feature={feature} detail={detail} />
    </section>
  );
}
