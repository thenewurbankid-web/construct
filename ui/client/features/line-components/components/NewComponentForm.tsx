import { useState } from 'react';
import { canCreate, suggestName } from '../domain/ComponentView';
import type { ComponentEditorView } from '../hooks/useComponentEditor';

type Props = { view: ComponentEditorView; library: { id: string; name: string }[]; features: string[] };

/** New component: a feature component based on one library component (a plan step; it lands on Approve). */
export function NewComponentForm({ view, library, features }: Props) {
  const [libraryId, setLibraryId] = useState(library[0]?.id ?? '');
  const [feature, setFeature] = useState(features[0] ?? '');
  const libName = library.find((l) => l.id === libraryId)?.name ?? '';
  const [name, setName] = useState(suggestName(features[0] ?? '', library[0]?.name ?? ''));
  const pick = (nextLib: string, nextFeature: string) => setName(suggestName(nextFeature, library.find((l) => l.id === nextLib)?.name ?? ''));
  return (
    <section className="lc-new" aria-labelledby="lc-new-head" data-testid="lc-new">
      <h2 id="lc-new-head" className="lc-head">
        New component
      </h2>
      <p className="lc-muted">Every feature component is based on one library component, which stays as it is.</p>
      <form
        className="lc-form"
        aria-label="New component"
        onSubmit={(e) => {
          e.preventDefault();
          view.newComponent(libraryId, feature, name);
        }}
      >
        <label className="lc-field">
          <span>Based on</span>
          <select value={libraryId} data-line-control="components.newBase" onChange={(e) => (setLibraryId(e.target.value), pick(e.target.value, feature))}>
            {library.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
        <label className="lc-field">
          <span>Feature</span>
          <select value={feature} data-line-control="components.newFeature" onChange={(e) => (setFeature(e.target.value), pick(libraryId, e.target.value))}>
            {features.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </label>
        <label className="lc-field">
          <span>Name</span>
          <input value={name} data-line-control="components.newName" onChange={(e) => setName(e.target.value)} />
        </label>
        <button type="submit" className="lc-btn lc-btn--primary" data-line-control="components.newCreate" disabled={view.busy || !canCreate(libraryId, feature, name)} aria-label={`Create component based on ${libName}`}>
          Create component
        </button>
      </form>
    </section>
  );
}
