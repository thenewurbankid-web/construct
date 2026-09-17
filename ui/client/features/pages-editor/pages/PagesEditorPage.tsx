import type { ReactNode } from 'react';
import { InspectorPanel } from '../components/InspectorPanel';
import { PagesBrowser } from '../components/PagesBrowser';
import { PreviewPanel } from '../components/PreviewPanel';
import { PropFlowDiagram } from '../components/PropFlowDiagram';
import { TreePanel } from '../components/TreePanel';
import type { usePagesEditor } from '../hooks/usePagesEditor';

type PagesEditorPageProps = ReturnType<typeof usePagesEditor>;

export function PagesEditorPage(props: PagesEditorPageProps): ReactNode {
  const {
    features, feature, setFeature, files, filesLoading, file, openFile, tree, error,
    selectedNodeId, selectNode, selectedNode, onTreeSaved, previewTitle,
  } = props;

  return (
    <div className="page pages-editor-page">
      <h1>Pages Editor</h1>
      <p className="hint">
        Browse a feature&apos;s pages/ layer (#49), view a page&apos;s JSX as a tree (#50), select a node from
        either the tree or the structural preview (#51), edit its isolated snippet or props and save
        straight back into the source file (#52/#53), auto-map unwired props (#54), and see the
        whole tree&apos;s prop flow as a colored diagram (#55). Every save is scoped to pages/ and
        checked against the existing PAGE-*/COMPONENT-* architecture rules before it lands (#56).
      </p>

      <PagesBrowser
        feature={feature}
        onFeatureChange={setFeature}
        features={features}
        file={file}
        onOpen={openFile}
        files={files}
        loading={filesLoading}
      />

      {error && <p className="status-error">{error}</p>}

      {tree && (
        <>
          <div className="pages-editor-grid">
            <TreePanel roots={tree.roots} selectedId={selectedNodeId} onSelect={selectNode} />
            <PreviewPanel roots={tree.roots} selectedId={selectedNodeId} onSelect={selectNode} titleFor={previewTitle} />
            <InspectorPanel feature={feature} file={file} node={selectedNode} contentHash={tree.contentHash} onSaved={onTreeSaved} />
          </div>
          <PropFlowDiagram roots={tree.roots} />
        </>
      )}
    </div>
  );
}
