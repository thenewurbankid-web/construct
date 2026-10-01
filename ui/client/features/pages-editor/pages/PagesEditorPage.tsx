import { useEffect, useState, type ReactNode } from 'react';
import { LivePreviewPanel, type LivePreviewPin } from '@/features/live-preview';
import { EditorBreadcrumb } from '../components/EditorBreadcrumb';
import { EditorTabStrip, type EditorTab } from '../components/EditorTabStrip';
import { NavigatorPanel } from '../components/NavigatorPanel';
import { OverlaysMenu } from '../components/OverlaysMenu';
import { PreviewPanel } from '../components/PreviewPanel';
import { PropFlowDiagram } from '../components/PropFlowDiagram';
import { StageSourceView } from '../components/StageSourceView';
import { usePropFlow } from '../hooks/usePropFlow';
import type { ChangeImpactPreview } from '../domain/ChangeImpact';
import type { usePagesEditor } from '../hooks/usePagesEditor';

type PagesEditorPageProps = ReturnType<typeof usePagesEditor> & {
  /** Commit-on-save indicator + dirty-tree prompt, supplied by the controller (another feature). */
  gitSession?: ReactNode;
  /** The target app's dev server card and branch indicator (#378), supplied by the controller (another feature). */
  devServer?: ReactNode;
  /** #381 — the Inspector Change tab's pending refactor, drawn as a dashed-box preview over the live app. */
  changeImpact?: ChangeImpactPreview | null;
  /** #835 — numbered Findings pins over the live preview, from usePagesEditorTabs. */
  pins?: LivePreviewPin[];
  onPinClick?: (id: string) => void;
};

// The stage (middle pane) of the Pages Editor. The page/feature tree lives in
// the shell's Browser pane and Inspector / Scope / Source / Palette / Diff in
// its Tools tabs (see usePagesEditorTabs); this renders what you look at: the
// live app preview, the structural mirror and the prop-flow diagram.
export function PagesEditorPage(props: PagesEditorPageProps): ReactNode {
  const { tree, error, selectedNodeId, selectedNode, selectNode, previewTitle, externalChange, livePreview, gitSession, devServer, feature, file, changeImpact, pins, onPinClick } = props;
  // #456: full screen is the app and nothing else. Everything but the preview is
  // hidden rather than unmounted, so the tree, the diagram and the selection are
  // exactly as they were on the way back out.
  const full = livePreview.fullScreen;

  // The stage's own tab strip (#375): Preview is pinned; opening a file's source adds a
  // second tab. Local to this component -- a different file opening resets it to Preview
  // so a closed Source tab from the previous page never lingers.
  const [stageTab, setStageTab] = useState<'preview' | 'source'>('preview');
  useEffect(() => setStageTab('preview'), [file]);
  // #375 — Overlays > Flow: lifted here (not inside PropFlowDiagram) so the menu in the
  // tab-strip row and the diagram below the preview share the one piece of state.
  const flow = usePropFlow(tree?.roots ?? []);

  const stageTabs: EditorTab[] = tree
    ? [
        { id: 'preview', title: 'Preview', pinned: true },
        ...(stageTab === 'source' ? [{ id: 'source', title: file, onClose: () => setStageTab('preview') }] : []),
      ]
    : [];

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
        <div hidden={full}>
          <EditorBreadcrumb feature={feature} file={file} nodeLabel={selectedNode?.tag} />
          <div className="pe-tabstrip-row">
            <EditorTabStrip tabs={stageTabs} activeId={stageTab} onSelect={(id) => setStageTab(id as 'preview' | 'source')} />
            {stageTab === 'preview' && (
              <>
                <OverlaysMenu flow={flow} />
                <button type="button" className="pe-view-source" onClick={() => setStageTab('source')}>
                  Open source
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {tree && (
        <>
          <div hidden={stageTab !== 'preview'}>
            <LivePreviewPanel {...livePreview.view} impactPreview={changeImpact} pins={pins} onPinClick={onPinClick} />
          </div>
          <div hidden={full}>
            {stageTab === 'source' ? (
              <StageSourceView feature={feature} file={file} contentHash={tree.contentHash} />
            ) : (
              <>
                <PreviewPanel roots={tree.roots} selectedId={selectedNodeId} onSelect={selectNode} titleFor={previewTitle} />
                <NavigatorPanel feature={feature} file={file} contentHash={tree.contentHash} />
                <PropFlowDiagram flow={flow} />
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
