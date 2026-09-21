'use client';

import { useCallback, useMemo } from 'react';
import { EmptyState } from '@/features/states';
import { ListBrowser, useUrlSelection } from '@/features/list-browser';
import { useRegisterShellTab, useShellStage, type ShellTab } from '@/features/shell';
import { FeatureDetails } from '../components/FeatureDetails';
import { findFeature, toListItems } from '../domain/FeatureView';
import { useFeatureList } from '../hooks/useFeatureList';
import { useFeatureSummary } from '../hooks/useFeatureSummary';

// The stage's "Create" action lives in the dashboard feature's stage actions, composed into the same stage by the route;
// the empty list's one next action opens it (no import of that feature: the two only meet on the page).
function openCreate() {
  document.querySelector<HTMLButtonElement>('[data-testid="stage-action-create"]')?.click();
}

/** The Features screen's part of the Browser and the stage (#431): every feature of the project in the Browser
 * pane, the chosen one's details in the stage (composed into the Plan screen's stage as a slot). The selection is
 * `?feature=<name>` in the URL; a name that is not in the list selects nothing. Mounted only with a project open. */
export function FeaturesScreenController() {
  const list = useFeatureList();
  const selection = useUrlSelection('feature');
  const { showStage } = useShellStage();
  const feature = list.status === 'ready' ? findFeature(list.features, selection.value) : null;
  const name = feature?.name ?? null;
  const details = useFeatureSummary(name);
  const items = useMemo(() => toListItems(list.features), [list.features]);
  const { select } = selection;
  const onSelect = useCallback(
    (id: string) => {
      select(id);
      showStage();
    },
    [select, showStage],
  );

  const browser = useMemo<ShellTab>(
    () => ({
      id: 'features',
      title: 'Features',
      preferred: true,
      render: () => (
        <ListBrowser
          label="Features"
          filterLabel="Filter features"
          testId="features-list"
          items={items}
          selectedId={name}
          onSelect={onSelect}
          status={selection.ready ? list.status : 'loading'}
          error={list.error}
          onRetry={list.reload}
          emptyTitle="This project has no features yet"
          emptyHint="Create the first one with Create above; it appears here."
          emptyAction={{ label: 'Create a feature', onClick: openCreate }}
        />
      ),
    }),
    [items, name, onSelect, selection.ready, list.status, list.error, list.reload],
  );
  useRegisterShellTab('browser', browser);

  if (feature) return <FeatureDetails name={feature.name} view={details.view} loading={details.loading} error={details.error} onRetry={details.reload} />;
  if (list.status === 'ready' && selection.value !== null) {
    return (
      <EmptyState
        size="inline"
        title={`“${selection.value}” is not a feature of this project`}
        hint="The link may be old, or the feature was renamed or removed."
        actions={[{ label: 'Choose another in the Browser', onClick: () => select(null), primary: true }]}
      />
    );
  }
  return null;
}
