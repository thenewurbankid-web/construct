import { useEffect, useRef, type ReactNode } from 'react';
import { GlassPanel } from '@/components/ui';
import { ListBrowser } from '@/features/list-browser';
import type { PagesEditorNode } from '../types';
import { allPageItems, pageOfItem } from '../domain/AllPages';
import { scrollSelectionIntoView } from '@/lib/scrollSelectionIntoView';
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
//
// #536 — the Files view's two sections (Files: feature picker + page list + "All pages"; JSX tree /
// All pages / empty state) share one GlassPanel (`.pe-browser-group`) as two independently
// collapsible native `<details>`/`<summary>` sections, the same idiom PalettePanel.tsx's
// `.pal-group` already ships (docs/design/browser-panel-merge.md). `.pages-browser`/`.tree-panel`
// keep their exact class names/testids (~30 ui/e2e specs locate the two panels by them) — only
// their own chrome moves from two standalone glass cards to two rows in one shared card.
export function PagesBrowserTab({ roots, selectedId, onSelect, view, switcher, flow, allPages, onOpenPage, onShowAllPages, ...browser }: PagesBrowserTabProps) {
  // The `.tree-panel` <details> is the real scroll container (it carries the max-height/overflow
  // CSS) whichever of the three states (§0 of the design doc) it currently renders, so the ref
  // lives here now rather than inside TreePanel.tsx.
  const treeContainerRef = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    scrollSelectionIntoView(treeContainerRef.current, selectedId);
  }, [selectedId]);

  return (
    <div className="pe-browser">
      {switcher}
      {view === 'files' ? (
        <GlassPanel className="pe-browser-group">
          <details className="pages-browser" open>
            <summary>
              Files <span className="pe-count">{browser.files.length}</span>
            </summary>
            <PagesBrowser {...browser} panel={false} />
            {browser.feature && (
              <button type="button" className="pe-all-pages" data-testid="pages-all" onClick={onShowAllPages}>All pages</button>
            )}
          </details>
          <details className="tree-panel" open ref={treeContainerRef}>
            {roots ? (
              <>
                <summary>JSX tree</summary>
                <TreePanel roots={roots} selectedId={selectedId} onSelect={onSelect} />
              </>
            ) : browser.feature ? (
              <>
                <summary>JSX tree</summary>
                <p className="hint">Open a page above to see its structure.</p>
              </>
            ) : (
              <>
                <summary>
                  All pages {allPages.status === 'ready' && <span className="pe-count">{allPages.pages.length}</span>}
                </summary>
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
              </>
            )}
          </details>
        </GlassPanel>
      ) : (
        <>
          <PagesBrowser {...browser} showPages={false} />
          {flow}
        </>
      )}
    </div>
  );
}
