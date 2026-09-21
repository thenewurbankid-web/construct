'use client';

import { useMemo } from 'react';
import { useRegisterShellTab, type ShellTab } from '@/features/shell';
import { DiffTab } from '../components/DiffTab';
import { InspectorPanel } from '../components/InspectorPanel';
import { PagesBrowserController } from '../controllers/PagesBrowserController';
import { ScopeTab } from '../components/ScopeTab';
import { SourcePanel } from '../components/SourcePanel';
import type { usePagesEditor } from './usePagesEditor';

type Editor = ReturnType<typeof usePagesEditor>;

/** Puts the Pages Editor's panels into the shell (slot registry): the page/feature
 * tree in the Browser pane and Inspector / Scope / Source / Diff as Tools tabs.
 * Each tab is memoised on the data it shows so the registry only updates when that changes. */
export function usePagesEditorTabs(e: Editor): void {
  const { features, feature, files, filesLoading, file, tree, selectedNodeId, selectedNode, externalChange } = e;
  const { setFeature, openFile, selectNode, onTreeSaved, reloadFromDisk, dismissExternalChange, allPages, openPageOf, showAllPages } = e;
  const roots = tree?.roots ?? null;
  const hash = tree?.contentHash ?? '';

  const browserTab = useMemo<ShellTab>(
    () => ({
      id: 'pages',
      title: 'Pages',
      render: () => (
        <PagesBrowserController
          feature={feature}
          onFeatureChange={setFeature}
          features={features}
          file={file}
          onOpen={openFile}
          files={files}
          loading={filesLoading}
          roots={roots}
          selectedId={selectedNodeId}
          onSelect={selectNode}
          allPages={allPages}
          onOpenPage={openPageOf}
          onShowAllPages={showAllPages}
        />
      ),
    }),
    [feature, setFeature, features, file, openFile, files, filesLoading, roots, selectedNodeId, selectNode, allPages, openPageOf, showAllPages],
  );

  const inspectorTab = useMemo<ShellTab>(
    () => ({
      id: 'inspector',
      title: 'Inspector',
      render: () =>
        tree ? (
          <InspectorPanel feature={feature} file={file} node={selectedNode} contentHash={hash} onSaved={onTreeSaved} withScope={false} />
        ) : (
          <p className="hint">Open a page in the Browser to inspect its elements.</p>
        ),
    }),
    [tree, feature, file, selectedNode, hash, onTreeSaved],
  );

  const scopeTab = useMemo<ShellTab>(
    () => ({
      id: 'scope',
      title: 'Scope',
      disabled: !tree,
      render: () => <ScopeTab feature={feature} file={file} node={selectedNode} contentHash={hash} />,
    }),
    [tree, feature, file, selectedNode, hash],
  );

  const sourceTab = useMemo<ShellTab>(
    () => ({
      id: 'source',
      title: 'Source',
      disabled: !tree,
      render: () => <SourcePanel feature={feature} file={file} contentHash={hash} />,
    }),
    [tree, feature, file, hash],
  );

  const diffTab = useMemo<ShellTab>(
    () => ({
      id: 'diff',
      title: 'Diff',
      // Declared always, valued only when a change lands: an external edit showing
      // up must not widen this tab and shove the tablist around (#252).
      badge: externalChange ? 1 : null,
      disabled: !tree,
      render: () => <DiffTab file={file} change={externalChange} onReload={reloadFromDisk} onDismiss={dismissExternalChange} />,
    }),
    [tree, file, externalChange, reloadFromDisk, dismissExternalChange],
  );

  useRegisterShellTab('browser', browserTab);
  useRegisterShellTab('tools', inspectorTab);
  useRegisterShellTab('tools', scopeTab);
  useRegisterShellTab('tools', sourceTab);
  useRegisterShellTab('tools', diffTab);
}
