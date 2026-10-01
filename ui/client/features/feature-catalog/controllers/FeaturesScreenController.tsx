'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { EmptyState } from '@/features/states';
import { ListBrowser, useUrlSelection } from '@/features/list-browser';
import { usePreview } from '@/features/live-preview';
import { useRegisterShellTab, useShellStage, type ShellTab } from '@/features/shell';
import { StoryIndicator, buildStoryIndicatorView, useFeatureStoryIndicators } from '@/features/story';
import { FeatureDetails } from '../components/FeatureDetails';
import { FeatureFlowView } from '../components/FeatureFlowView';
import { FeatureStructure } from '../components/FeatureStructure';
import { LayerViolationsPanel } from '../components/LayerViolationsPanel';
import type { StructureView } from '../components/StructureViewSwitch';
import { findFeature, legacyNote, toListItems } from '../domain/FeatureView';
import { useFeatureList } from '../hooks/useFeatureList';
import { useFeatureSummary } from '../hooks/useFeatureSummary';
import '../components/feature-catalog.css';

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
  const [view, setView] = useState<StructureView>('tree');
  // #840 -- "Preview beside": off by default, no selection-sharing on the Features screen.
  const [previewOn, setPreviewOn] = useState(false);
  const togglePreview = useCallback(() => setPreviewOn((v) => !v), []);
  const preview = usePreview();
  const [violationsLayer, setViolationsLayer] = useState<string | null>(null);
  useEffect(() => setViolationsLayer(null), [name]);
  const baseItems = useMemo(() => toListItems(list.features), [list.features]);
  const storyIndicators = useFeatureStoryIndicators(useMemo(() => baseItems.map((i) => i.id), [baseItems]));
  // #385: a quiet dot+text on the row for any feature with a story.md; a feature with none shows nothing
  // (its state is `null`, filtered out by `useFeatureStoryIndicators`) per the "no story-dependent UI" rule.
  const items = useMemo(
    () => baseItems.map((item) => {
      const state = storyIndicators[item.id];
      return state ? { ...item, badge: <StoryIndicator view={buildStoryIndicatorView(state)} compact /> } : item;
    }),
    [baseItems, storyIndicators],
  );
  const note = list.status === 'ready' ? legacyNote(list.featuresRoot, list.legacy) : null;
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
          header={note ? <p className="fc-hint" data-testid="fc-legacy-note">{note}</p> : undefined}
        />
      ),
    }),
    [items, name, onSelect, selection.ready, list.status, list.error, list.reload, note],
  );
  useRegisterShellTab('browser', browser);

  const violations = violationsLayer ? (details.view?.layers.find((l) => l.layer === violationsLayer)?.violations ?? []) : null;
  const violationsTab = useMemo<ShellTab>(
    () => ({
      id: 'feature-violations',
      title: 'Violations',
      badge: violations?.length ?? null,
      render: () => (violationsLayer && violations ? <LayerViolationsPanel layer={violationsLayer} violations={violations} /> : <p className="fc-hint fc-violations-summary">Click a layer&rsquo;s dot to see its rule violations here.</p>),
    }),
    [violationsLayer, violations],
  );
  useRegisterShellTab('tools', violationsTab);

  if (feature) {
    return (
      <FeatureStructure
        view={view}
        onChange={setView}
        tree={<FeatureDetails name={feature.name} view={details.view} loading={details.loading} error={details.error} onRetry={details.reload} onSelectViolations={setViolationsLayer} />}
        flow={<FeatureFlowView name={feature.name} missingLayers={details.view?.missingLayers ?? []} onAddLayer={openCreate} />}
        previewOn={previewOn}
        onTogglePreview={togglePreview}
        previewView={preview.view}
      />
    );
  }
  if (list.status === 'ready' && selection.value !== null) {
    return (
      <EmptyState
        size="inline"
        title={`“${selection.value}” is not a feature of this project`}
        actions={[{ label: 'Choose another in the Browser', onClick: () => select(null), primary: true }]}
      />
    );
  }
  return null;
}
