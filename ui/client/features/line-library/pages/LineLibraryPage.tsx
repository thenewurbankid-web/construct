import { FeatureComponents } from '../components/FeatureComponents';
import { LibraryCards } from '../components/LibraryCards';
import type { LibraryView } from '../types';

/** The Components screen of a Line project: the library as cards by level, then each feature's own components
 * with their base links (mock: docs/design components-library, Library tab). */
export function LineLibraryPage({ view }: { view: LibraryView }) {
  return (
    <div className="ll-stage" data-testid="line-library">
      <header className="ll-head">
        <p className="ll-eyebrow">Components</p>
        <h1 className="ll-h1">Your component library</h1>
        <p className="ll-hint">
          Every library component, sorted by how it is built. <span data-testid="ll-total">{view.total}</span> in the library.
        </p>
      </header>
      {view.groups.length ? (
        <LibraryCards groups={view.groups} />
      ) : (
        <p className="ll-hint">The library has no components yet.</p>
      )}
      <section className="ll-group" aria-labelledby="ll-features-head">
        <h2 id="ll-features-head" className="ll-level-head">
          Feature components <small>Each one is based on one library component.</small>
        </h2>
        <FeatureComponents features={view.features} />
      </section>
    </div>
  );
}
