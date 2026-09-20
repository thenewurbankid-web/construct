import type { ReactNode } from 'react';
import { LivePreviewPanel } from '../components/LivePreviewPanel';
import { PreviewPanel } from '../components/PreviewPanel';
import { PropFlowDiagram } from '../components/PropFlowDiagram';
import type { usePagesEditor } from '../hooks/usePagesEditor';

type PagesEditorPageProps = ReturnType<typeof usePagesEditor> & {
  /** Commit-on-save indicator + dirty-tree prompt, supplied by the controller (another feature). */
  gitSession?: ReactNode;
};

// The stage (middle pane) of the Pages Editor. The page/feature tree lives in
// the shell's Browser pane and Inspector / Scope / Source / Diff in its Tools
// tabs (see usePagesEditorTabs); this renders what you look at: the live app
// preview, the structural mirror and the prop-flow diagram.
export function PagesEditorPage(props: PagesEditorPageProps): ReactNode {
  const { tree, error, selectedNodeId, selectNode, previewTitle, externalChange, livePreview, gitSession } = props;

  return (
    <div className="page pages-editor-page pe-stage">
      <h1>Pages Editor</h1>
      <p className="hint">
        Pick a page in the Browser, then click an element in a preview (or a node in the tree) to select it.
        Edit it in the Tools panel; every save is checked against the architecture rules.
      </p>

      {gitSession}

      {error && <p className="status-error">{error}</p>}

      {tree && externalChange && (
        <p className="pe-changed" role="status">
          Changed on disk outside the editor. Review it in the Diff tab.
        </p>
      )}

      {!tree && !error && <p className="hint pe-empty">Nothing open yet. Choose a feature and a page in the Browser to start.</p>}

      {tree && (
        <>
          <LivePreviewPanel
            draft={livePreview.draft}
            onDraftChange={livePreview.setDraft}
            url={livePreview.url}
            message={livePreview.message}
            frameRef={livePreview.frameRef}
            onConnect={livePreview.connect}
            onDisconnect={livePreview.disconnect}
          />
          <PreviewPanel roots={tree.roots} selectedId={selectedNodeId} onSelect={selectNode} titleFor={previewTitle} />
          <PropFlowDiagram roots={tree.roots} />
        </>
      )}
    </div>
  );
}
