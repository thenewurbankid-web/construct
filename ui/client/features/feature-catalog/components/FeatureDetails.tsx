import Link from 'next/link';
import { ErrorState, LoadingState } from '@/features/states';
import type { FeatureFile, FeatureView } from '../types';
import { MissingLayers } from './MissingLayers';
import './feature-catalog.css';

type Props = { name: string; view: FeatureView | null; loading: boolean; error: string | null; onRetry: () => void; onSelectViolations?: (layer: string) => void; onSelectApi?: (viewModelFile: FeatureFile) => void };

// The stage's Import/Create actions live in the dashboard feature's stage actions, composed into the same stage by
// the route (see FeaturesScreenController's openCreate): the two only meet on the page, so opening one from here is
// a DOM click rather than a prop, same as the empty feature list's "Create a feature" action.
function openImport() {
  document.querySelector<HTMLButtonElement>('[data-testid="stage-action-import"]')?.click();
}
function openCreate() {
  document.querySelector<HTMLButtonElement>('[data-testid="stage-action-create"]')?.click();
}

/** The details of one feature in the stage: what it is, the routes under it, its layers and files, its workflows and its tests. */
export function FeatureDetails({ name, view, loading, error, onRetry, onSelectViolations, onSelectApi }: Props) {
  if (error) return <section className="fc-details" data-testid="fc-details"><ErrorState size="inline" title={`Could not read “${name}”`} hint={error} onRetry={onRetry} /></section>;
  if (loading || !view) return <section className="fc-details" data-testid="fc-details"><LoadingState size="inline" label={`Reading ${name}`} /></section>;
  return (
    <section className="fc-details" data-testid="fc-details" aria-labelledby="fc-title">
      {view.root !== 'features' && (
        <p className="fc-hint" data-testid="fc-root">Tree root: <span className="fc-mono">{view.root}/</span></p>
      )}
      <h2 className="fc-h2" id="fc-title" data-testid="fc-name">{view.name}</h2>
      <p className="fc-summary" data-testid="fc-summary">{view.summary}</p>
      {view.findings.length > 0 && (
        <ul className="fc-findings" aria-label="Things to look at">
          {view.findings.map((f) => <li key={f}>{f}</li>)}
        </ul>
      )}

      <h3 className="fc-h3">Routes{view.routes.length > 0 ? ` (${view.routes.length})` : ''}</h3>
      {view.routes.length === 0 ? (
        <div className="fc-callout fc-callout-info" data-testid="fc-no-routes">
          <p><strong>Not mapped to a route yet.</strong></p>
          <p className="fc-hint">
            That is fine for a shared kit, or a feature you imported first.{' '}
            <button type="button" className="fc-link fc-link-btn" data-testid="fc-map-route" onClick={openImport}>Map to a route</button>
          </p>
        </div>
      ) : (
        <ul className="fc-list" data-testid="fc-routes">
          {view.routes.map((r) => (
            <li key={`${r.route}${r.file}`}><span className="fc-mono">{r.route}</span> <span className="fc-hint">from <span className="fc-mono">{r.file}</span></span></li>
          ))}
        </ul>
      )}

      <h3 className="fc-h3">Layers ({view.layers.length} of {view.layers.length + view.missingLayers.length})</h3>
      <div data-testid="fc-layers">
        {/* LIN-150: the adapter layer -- the one that touches the real API -- no longer gets its own card here.
            Its file is reached from the matching view model's "API" action, in the detail-card slot instead. */}
        {view.layers.filter((l) => l.layer !== 'adapter').map((l) => (
          <div key={l.layer} className="fc-layer" data-testid="fc-layer" data-layer={l.layer}>
            <h4 className="fc-h4">
              {l.layer} <span className="fc-hint">{l.files.length} file{l.files.length === 1 ? '' : 's'}</span>
              {l.violations.length > 0 && (
                <button
                  type="button"
                  className="fc-violation-dot"
                  data-testid="fc-violation-dot"
                  aria-label={`${l.violations.length} rule violation${l.violations.length === 1 ? '' : 's'} in ${l.layer}`}
                  onClick={() => onSelectViolations?.(l.layer)}
                />
              )}
            </h4>
            <ul className="fc-list">
              {l.files.map((f) => (
                <li key={f.path} data-testid="fc-file">
                  {f.href ? <Link href={f.href} className="fc-mono fc-file-link">{f.path}</Link> : <span className="fc-mono">{f.path}</span>}
                  {f.frozen && <span className="fc-hint" data-testid="fc-frozen"> 🔒 frozen</span>}
                  <span className="fc-hint"> {f.purpose}</span>
                  {l.layer === 'viewmodel' && (
                    <button type="button" className="fc-link-btn" data-testid="fc-viewmodel-api" onClick={() => onSelectApi?.(f)}>
                      {' '}API
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
        <MissingLayers layers={view.missingLayers} onAdd={openCreate} />
      </div>

      <h3 className="fc-h3">Workflows</h3>
      {view.workflows.length === 0 ? (
        <p className="fc-hint" data-testid="fc-no-workflows">No workflow machines in this feature.</p>
      ) : (
        <ul className="fc-list" data-testid="fc-workflows">
          {view.workflows.map((w) => (
            <li key={`${w.file}${w.machine}`}>
              <strong>{w.machine}</strong> <span className="fc-hint">{w.states} states.</span> {w.summary}
            </li>
          ))}
        </ul>
      )}
      {view.workflows.length > 0 && <p><Link href="/workflows" className="fc-link" data-testid="fc-open-workflows">Open the workflow viewer</Link></p>}

      <h3 className="fc-h3">Tests</h3>
      <p data-testid="fc-tests">
        {view.tests.count === 0 ? 'No tests yet for this feature.' : `${view.tests.count} test file${view.tests.count === 1 ? '' : 's'}.`}{' '}
        <Link href="/tests" className="fc-link" data-testid="fc-open-tests">Open Tests</Link>
      </p>
      {view.tests.files.length > 0 && <ul className="fc-list">{view.tests.files.map((t) => <li key={t} className="fc-mono">{t}</li>)}</ul>}

      <h3 className="fc-h3">Rules</h3>
      <p data-testid="fc-rules">{view.rules.error} error{view.rules.error === 1 ? '' : 's'}, {view.rules.warning} warning{view.rules.warning === 1 ? '' : 's'} under the architecture rules.</p>
      {(view.usedBy.length > 0 || view.usesFeatures.length > 0) && (
        <p className="fc-hint" data-testid="fc-deps">
          {view.usesFeatures.length > 0 && <>Uses: {view.usesFeatures.join(', ')}. </>}
          {view.usedBy.length > 0 && <>Used by: {view.usedBy.join(', ')}.</>}
        </p>
      )}
    </section>
  );
}
