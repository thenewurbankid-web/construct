import type { ReactNode } from 'react';
import { ListBrowser } from '@/features/list-browser';
import type { PagesEditorNode } from '../types';
import { allPageItems, pageOfItem } from '../domain/AllPages';
import { PagesBrowser } from './PagesBrowser';
import { TreePanel } from './TreePanel';

type PagesBrowserTabProps = {
  feature: string;
  onFeatureChange: (feature: string) => void;
  features: string[];
  file: string;
  onOpen: (file: string) => void;
  files: string[];
  loading: boolean;
  roots: PagesEditorNode[] | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** 'files' (the default, unchanged) or 'flow' (#328). */
  view: 'files' | 'flow';
  /** The Files | Flow switch, supplied by the controller. */
  switcher: ReactNode;
  /** The Flow view (and a file opened from it), supplied by the controller. */
  flow: ReactNode;
  /** Every page of the project (Pages screen, #431): the list shown while no feature is chosen. */
  allPages: { status: 'loading' | 'error' | 'ready'; pages: { feature: string; file: string }[]; error: string; reload: () => void };
  onOpenPage: (feature: string, file: string) => void;
  /** Back from a feature's view to the list of all pages. */
  onShowAllPages: () => void;
};

// Browser-pane content of the Pages Editor: a Files | Flow switch, then either the feature/page picker with
// the open page's JSX tree beneath it (Files) or the feature's flow (Flow, #328). Presentation-only.
export function PagesBrowserTab({ roots, selectedId, onSelect, view, switcher, flow, allPages, onOpenPage, onShowAllPages, ...browser }: PagesBrowserTabProps) {
  return (
    <div className="pe-browser">
      {switcher}
      {view === 'files' ? (
        <>
          <PagesBrowser {...browser} />
          {browser.feature ? (
            <button type="button" className="pe-all-pages" data-testid="pages-all" onClick={onShowAllPages}>All pages</button>
          ) : (
            <ListBrowser
              label="Pages"
              filterLabel="Filter pages"
              testId="pages-list"
              items={allPageItems(allPages.pages)}
              selectedId={null}
              onSelect={(id) => {
                const page = pageOfItem(allPages.pages, id);
                if (page) onOpenPage(page.feature, page.file);
              }}
              status={allPages.status}
              error={allPages.error}
              onRetry={allPages.reload}
              emptyTitle="This project has no pages yet"
              emptyHint="A page is a file in a feature's pages/ layer."
              emptyAction={{ label: 'Create a page', href: '/' }}
            />
          )}
          {roots && <TreePanel roots={roots} selectedId={selectedId} onSelect={onSelect} />}
        </>
      ) : (
        <>
          <PagesBrowser {...browser} showPages={false} />
          {flow}
        </>
      )}
    </div>
  );
}
