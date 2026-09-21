'use client';

import { useCallback, useMemo, useState } from 'react';
import { ListBrowser, useUrlSelection } from '@/features/list-browser';
import { ProjectGateController } from '@/features/project-gate';
import { CommitIndicatorController } from '@/features/git-session';
import { useRegisterShellTab, useShellStage, type ShellTab } from '@/features/shell';
import '../components/component-docs.css';
import { ComponentDocPanel } from '../components/ComponentDocPanel';
import { ComponentSourcePanel } from '../components/ComponentSourcePanel';
import { docReason, docView, findComponent, toListItems } from '../domain/ComponentList';
import { useComponentDoc } from '../hooks/useComponentDoc';
import { useComponentEditor } from '../hooks/useComponentEditor';
import { useComponentList } from '../hooks/useComponentList';
import { ComponentsPage } from '../pages/ComponentsPage';

function ComponentsScreen() {
  const list = useComponentList();
  const selection = useUrlSelection('component');
  const { showStage } = useShellStage();
  const [revision, setRevision] = useState(0);
  const entry = list.status === 'ready' ? findComponent(list.components, selection.value) : null;
  const path = entry?.path ?? null;
  const doc = useComponentDoc(path, revision);
  const editor = useComponentEditor(path, useCallback(() => setRevision((r) => r + 1), []));
  const items = useMemo(() => toListItems(list.components), [list.components]);

  const { select } = selection;
  const { dirty } = editor;
  const onSelect = useCallback(
    (id: string) => {
      if (id !== path && dirty && !window.confirm('You have unsaved changes to this file. Discard them and open another component?')) return;
      select(id);
      showStage();
    },
    [path, dirty, select, showStage],
  );

  const browser = useMemo<ShellTab>(
    () => ({
      id: 'components',
      title: 'Components',
      preferred: true,
      render: () => (
        <ListBrowser
          label="Components"
          filterLabel="Filter components"
          testId="components-list"
          items={items}
          selectedId={path}
          onSelect={onSelect}
          status={selection.ready ? list.status : 'loading'}
          error={list.error}
          onRetry={list.reload}
          emptyTitle="This project has no components yet"
          emptyHint="A component is a file in a feature's components/ layer."
          emptyAction={{ label: 'Create one', href: '/' }}
        />
      ),
    }),
    [items, path, onSelect, selection.ready, list.status, list.error, list.reload],
  );
  useRegisterShellTab('browser', browser);

  return (
    <ComponentsPage
      hasSelection={entry !== null}
      staleName={list.status === 'ready' && selection.value !== null && entry === null ? selection.value : null}
      onClearStale={() => selection.select(null)}
      listReady={list.status === 'ready' && selection.ready}
      doc={entry && <ComponentDocPanel entry={entry} view={docView(doc.description)} reason={docReason(doc.description)} />}
      source={
        entry && (
          <>
            <CommitIndicatorController />
            <ComponentSourcePanel
              path={entry.path}
              state={editor.state}
              diagnostics={editor.diagnostics}
              loading={editor.loading}
              loadError={editor.loadError}
              onEdit={editor.edit}
              onReview={editor.review}
              onCancelReview={editor.cancelReview}
              onConfirm={editor.confirm}
              onDiscard={editor.discard}
              onReload={editor.reload}
            />
          </>
        )
      }
    />
  );
}

/** The Components screen (`/components`): every component of the project in the Browser, and the chosen one in the
 * stage as documentation (name, feature, path, props) with its file editable as plain text. */
export function ComponentsController() {
  return (
    <ProjectGateController>
      <ComponentsScreen />
    </ProjectGateController>
  );
}
