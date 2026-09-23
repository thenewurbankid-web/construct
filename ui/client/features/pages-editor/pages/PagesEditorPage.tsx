import type { ReactNode } from 'react';
import { LivePreviewPanel } from '../components/LivePreviewPanel';
import { NavigatorPanel } from '../components/NavigatorPanel';
import { PreviewPanel } from '../components/PreviewPanel';
import { PropFlowDiagram } from '../components/PropFlowDiagram';
import type { usePagesEditor } from '../hooks/usePagesEditor';

type PagesEditorPageProps = ReturnType<typeof usePagesEditor> & {
  /** Commit-on-save indicator + dirty-tree prompt, supplied by the controller (another feature). */
  gitSession?: ReactNode;
  /** The target app's dev server card and branch indicator (#378), supplied by the controller (another feature). */
  devServer?: ReactNode;
};

// The stage (middle pane) of the Pages Editor. The page/feature tree lives in
// the shell's Browser pane and Inspector / Scope / Source / Palette / Diff in
// its Tools tabs (see usePagesEditorTabs); this renders what you look at: the
// live app preview, the structural mirror and the prop-flow diagram.
export function PagesEditorPage(props: PagesEditorPageProps): ReactNode {
  const { tree, error, selectedNodeId, selectNode, previewTitle, externalChange, livePreview, gitSession, devServer } = props;
  // #456: full screen is the app and nothing else. Everything but the preview is
  // hidden rather than unmounted, so the tree, the diagram and the selection are
  // exactly as they were on the way back out.
  const full = livePreview.fullScreen;

  return (
    <div className={full ? 'page pages-editor-page pe-stage pe-stage--full' : 'page pages-editor-page pe-stage'}>
      <div hidden={full}>
        <h1>Pages Editor</h1>
        <p className="hint">
          Pick a page in the Browser, then click an element in a preview (or a node in the tree) to select it.
          Edit it in the Tools panel; every save is checked against the architecture rules.
        </p>

        {gitSession}

        {devServer}

        {error && <p className="status-error">{error}</p>}

        {tree && externalChange && (
          <p className="pe-changed" role="status">
            Changed on disk outside the editor. Review it in the Diff tab.
          </p>
        )}

        {!tree && !error && <p className="hint pe-empty">Nothing open yet. Choose a feature and a page in the Browser to start.</p>}
      </div>

      {tree && (
        <>
          <LivePreviewPanel {...livePreview.view} />
          <div hidden={full}>
            <PreviewPanel roots={tree.roots} selectedId={selectedNodeId} onSelect={selectNode} titleFor={previewTitle} />
            <NavigatorPanel feature={props.feature} file={props.file} contentHash={tree.contentHash} />
            <PropFlowDiagram roots={tree.roots} />
          </div>
        </>
      )}
    </div>
  );
}
