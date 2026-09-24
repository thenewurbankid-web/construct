import type { ReactNode } from 'react';
import { EmptyState } from '@/features/states';

type Props = {
  /** What the stage shows: null = nothing selected. */
  hasSelection: boolean;
  /** The selection named in the URL that is not a component of this project (a stale or hand-edited link). */
  staleName: string | null;
  onClearStale: () => void;
  /** Where the project has no components at all. */
  listReady: boolean;
  doc: ReactNode;
  source: ReactNode;
};

/** The stage of the Components screen: documentation for the chosen component, then its file as plain text. The list
 * is in the Browser pane (registered by the controller). */
export function ComponentsPage({ hasSelection, staleName, onClearStale, listReady, doc, source }: Props) {
  return (
    <div className="cd-stage" data-testid="components-stage">
      <h1 className="cd-h1">Components</h1>
      {hasSelection ? (
        <>
          {doc}
          {source}
        </>
      ) : staleName ? (
        <EmptyState
          size="inline"
          title={`“${staleName}” is not a component of this project`}
          actions={[{ label: 'Choose another in the Browser', onClick: onClearStale, primary: true }]}
        />
      ) : (
        listReady && <p className="cd-hint" data-testid="components-pick">Pick a component in the Browser to read what it takes and to edit its file.</p>
      )}
    </div>
  );
}
