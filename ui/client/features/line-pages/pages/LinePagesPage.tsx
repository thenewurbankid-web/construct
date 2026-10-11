import type { ReactNode } from 'react';
import { FeaturePicker } from '../components/FeaturePicker';
import { PageList } from '../components/PageList';
import { PartsPanel } from '../components/PartsPanel';
import '../components/line-pages.css';
import type { LinePagesView } from '../types';

/** The Pages screen of a Line project: pick a feature, see its pages (base, status, findings), pick a page to
 * change one prop of one of its parts, or one piece of code on it ("Edit code"), and Save it through the checked writer. */
export function LinePagesPage({ view, panel }: { view: LinePagesView; panel?: ReactNode }) {
  const { features, feature, chooseFeature, pages, page, choosePage, parts, save, saving, revision, outcome, saveFragment, fragmentOutcome, workspaceFolder } = view;
  return (
    <div className="page page--screen lp" data-testid="line-pages">
      <div>
        <p className="lp-eyebrow">{feature ? `Feature: ${feature}` : 'Line project'}</p>
        <h1>Pages</h1>
        <p className="hint">Every page belongs to one feature and is based on one page from your library.</p>
      </div>
      {panel}
      <section aria-labelledby="lp-feature-q">
        <h2 id="lp-feature-q">Which feature?</h2>
        <FeaturePicker features={features} current={feature} onChoose={chooseFeature} />
      </section>
      {feature && (
        <div className="lp-layout">
          <section aria-labelledby="lp-pages-title">
            <h2 id="lp-pages-title">Pages in {feature}</h2>
            <PageList pages={pages} current={page?.id ?? null} onChoose={choosePage} workspaceFolder={workspaceFolder ?? null} />
          </section>
          {page ? (
            <PartsPanel pageName={page.name} parts={parts} saving={saving} revision={revision} outcome={outcome} onSave={save} fragmentOutcome={fragmentOutcome} onSaveFragment={saveFragment} />
          ) : (
            <p className="hint lp-pick-hint">Pick a page to see its parts and change them.</p>
          )}
        </div>
      )}
    </div>
  );
}
