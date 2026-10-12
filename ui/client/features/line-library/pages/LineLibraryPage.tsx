import type { ReactNode } from 'react';
import { ChangeNotice } from '../components/ChangeNotice';
import { FeatureComponents } from '../components/FeatureComponents';
import { LibraryCards } from '../components/LibraryCards';
import type { ChangeControls, LibraryView } from '../types';

/** The Components screen of a Line project: the library as cards by level, then each feature's own components
 * with their base links (mock: docs/design components-library, Library tab), the Plan panel (each change waits there for
 * approval) and the sentence of the last change that ran. */
export function LineLibraryPage({ view, controls, panel, editor = null }: { view: LibraryView; controls: ChangeControls; panel: ReactNode; editor?: ReactNode }) {
  return (
    <div className="ll-stage" data-testid="line-library">
      <header className="ll-head">
        <p className="ll-eyebrow">Components</p>
        <h1 className="ll-h1">Your component library</h1>
        <p className="ll-hint">
          Every library component, sorted by how it is built. <span data-testid="ll-total">{view.total}</span> in the library.
        </p>
      </header>
      {panel}
      <ChangeNotice notice={controls.notice} />
      <div className={editor ? 'll-areas' : undefined}>
      <div className="ll-library-area">
      {view.groups.length ? (
        <LibraryCards groups={view.groups} controls={controls} />
      ) : (
        <p className="ll-hint">The library has no components yet.</p>
      )}
      <section className="ll-group" aria-labelledby="ll-features-head">
        <h2 id="ll-features-head" className="ll-level-head">
          Feature components <small>Each one is based on one library component.</small>
        </h2>
        <FeatureComponents features={view.features} controls={controls} />
      </section>
      </div>
      {editor ? <div className="ll-editor-area">{editor}</div> : null}
      </div>
    </div>
  );
}
