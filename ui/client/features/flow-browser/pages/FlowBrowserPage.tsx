import type { ReactNode } from 'react';
import { FlowNotes } from '../components/FlowNotes';
import { FlowTree } from '../components/FlowTree';
import type { FlowBrowserView } from '../types';

type FlowBrowserPageProps = FlowBrowserView & { feature: string; onOpen: (file: string) => void };

// The Flow view of the Browser pane: what a person sees under the Files | Flow switch. Every state
// (no feature, loading, error, no routes, the tree) is drawn here; the graph work is elsewhere.
export function FlowBrowserPage(props: FlowBrowserPageProps): ReactNode {
  const { feature, load, data, shown, selectedId, collapsed, relations, hover, select, toggle, showHint, hideHint, onOpen } = props;
  return (
    <div className="flow-view" data-testid="flow-view">
      <div className="flow-prov">
        <span className="flow-det">Deterministic</span>
        <span>Computed from imports. Nothing is moved.</span>
      </div>
      {!feature && <p className="hint">Pick a feature above to see how a route reaches it.</p>}
      {feature && load.status === 'loading' && <p className="hint" role="status">Reading the flow of {feature}...</p>}
      {feature && load.status === 'error' && (
        <p className="status-error" role="alert" data-testid="flow-error">
          {load.message} The Files view still works.
        </p>
      )}
      {feature && data && data.routes.length > 0 && (
        <>
          <p className="hint flow-hint">Click a row to see what it uses. Ctrl+click opens the file.</p>
          <FlowTree rows={shown} selectedId={selectedId} collapsed={collapsed} relations={relations} hover={hover} onSelect={select} onToggle={toggle} onOpen={onOpen} onHover={showHint} onLeave={hideHint} />
          <FlowNotes notes={data.notes} />
        </>
      )}
      {feature && data && data.routes.length === 0 && (
        <div data-testid="flow-no-routes">
          <div className="flow-sect">{data.routeAdapter ? 'Not entered from any route' : 'No routes shown'}</div>
          <div className="flow-row flow-lone"><span className="flow-name">{feature}</span></div>
          <FlowNotes notes={data.notes} />
        </div>
      )}
    </div>
  );
}
