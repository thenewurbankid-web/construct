'use client';

import { useMemo } from 'react';
import { useRegisterShellTab, type ShellTab } from '@/features/shell';
import { ChangeTab } from '../components/ChangeTab';
import { DiffTab } from '../components/DiffTab';
import { InspectorPanel } from '../components/InspectorPanel';
import { PagesBrowserController } from '../controllers/PagesBrowserController';
import { PalettePanel } from '../components/PalettePanel';
import { ScopeTab } from '../components/ScopeTab';
import { SourcePanel } from '../components/SourcePanel';
import type { ChangeImpactPreview } from '../domain/ChangeImpact';
import { useImpact } from './useImpact';
import { useTestsCoverage } from './useTestsCoverage';
import { useFileFindings } from './useFileFindings';
import { usePageDiagnostics } from './usePageDiagnostics';
import { useGitStatus } from './useGitStatus';
import type { usePagesEditor } from './usePagesEditor';

type Editor = ReturnType<typeof usePagesEditor>;

/** Puts the Pages Editor's panels into the shell (slot registry): the page/feature
 * tree in the Browser pane and Inspector / Scope / Source / Change / Palette / Diff as Tools tabs.
 * Each tab is memoised on the data it shows so the registry only updates when that changes.
 * `onImpactPreview` (#381) lets the Change tab draw its dashed-box preview on the live app;
 * it lives one level up (PagesEditorController) since the preview and the Change tab are siblings. */
export function usePagesEditorTabs(e: Editor, onImpactPreview: (v: ChangeImpactPreview | null) => void): void {
  const { features, feature, files, filesLoading, file, tree, selectedNodeId, selectedNode, externalChange } = e;
  const { setFeature, openFile, selectNode, onTreeSaved, reloadFromDisk, dismissExternalChange, allPages, openPageOf, showAllPages } = e;
  const roots = tree?.roots ?? null;
  const hash = tree?.contentHash ?? '';
  // #829 -- fetched once here (not inside InspectorPanel/TreePanel) so the Inspector's "Impact"
  // section and the tree's own chip/dot share the one request each, instead of two.
  const impact = useImpact(feature, file, hash);
  // #830 -- fetched once here (not inside InspectorPanel), per feature: scenario coverage is a
  // property of the feature's workflow, not of which page file within it is open.
  const testsCoverage = useTestsCoverage(feature);
  // #831 -- keyed by the file's resolved project-relative path (from useImpact's /api/pages/impact), the same
  // path Review findings are recorded against; null while Impact hasn't resolved it yet.
  const findings = useFileFindings(impact?.ok ? impact.path : null);
  // #833 -- the whole file's diagnostics, fetched once per save; NodeDiagnosticsPanel scopes them to whichever
  // node is selected.
  const diagnostics = usePageDiagnostics(feature, file, hash);
  const gitStatus = useGitStatus(feature, file, hash);

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
          impact={impact}
          gitStatus={gitStatus}
          allPages={allPages}
          onOpenPage={openPageOf}
          onShowAllPages={showAllPages}
        />
      ),
    }),
    [feature, setFeature, features, file, openFile, files, filesLoading, roots, selectedNodeId, selectNode, impact, gitStatus, allPages, openPageOf, showAllPages],
  );

  const inspectorTab = useMemo<ShellTab>(
    () => ({
      id: 'inspector',
      title: 'Inspector',
      render: () =>
        tree ? (
          <InspectorPanel feature={feature} file={file} node={selectedNode} contentHash={hash} onSaved={onTreeSaved} withScope={false} impact={impact} testsCoverage={testsCoverage} findings={findings} diagnostics={diagnostics} />
        ) : (
          <p className="hint">Open a page in the Browser to inspect its elements.</p>
        ),
    }),
    [tree, feature, file, selectedNode, hash, onTreeSaved, impact, testsCoverage, findings, diagnostics],
  );

  const scopeTab = useMemo<ShellTab>(
    () => ({
      id: 'scope',
      title: 'Scope',
      disabled: !tree,
      render: () => <ScopeTab feature={feature} file={file} node={selectedNode} contentHash={hash} onSaved={onTreeSaved} />,
    }),
    [tree, feature, file, selectedNode, hash, onTreeSaved],
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

  const changeTab = useMemo<ShellTab>(
    () => ({
      id: 'change',
      title: 'Change',
      disabled: !tree,
      render: () => <ChangeTab feature={feature} file={file} onImpactPreview={onImpactPreview} />,
    }),
    [tree, feature, file, onImpactPreview],
  );

  const paletteTab = useMemo<ShellTab>(
    () => ({
      id: 'palette',
      title: 'Palette',
      disabled: !tree,
      render: () => <PalettePanel feature={feature} file={file} contentHash={hash} selectedNodeId={selectedNodeId} onInserted={onTreeSaved} />,
    }),
    [tree, feature, file, hash, selectedNodeId, onTreeSaved],
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
  useRegisterShellTab('tools', changeTab);
  useRegisterShellTab('tools', paletteTab);
  useRegisterShellTab('tools', diffTab);
}
