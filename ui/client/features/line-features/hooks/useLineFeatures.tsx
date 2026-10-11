'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useUrlSelection } from '@/features/list-browser';
import { featureCards } from '../domain/FeatureCards';
import { loadLineFeaturesApi } from '../services/LineFeaturesApi';
import { loadFeature } from '../workflows/LoadFeature';
import type { DetailState, FeatureTab, LineFeaturesApi, LineFeaturesView, LineProject } from '../types';

type ProjectState = { phase: 'loading' } | { phase: 'not-line' } | { phase: 'line'; project: LineProject; api: LineFeaturesApi };

/** Reads the open project's Line view once. A project that is not a Line project, or a server with no /api/line
 * routes, is "not-line": the caller keeps today's Features screen. */
function useLineFeaturesProject(revision: number): ProjectState {
  const [state, setState] = useState<ProjectState>({ phase: 'loading' });
  useEffect(() => {
    let live = true;
    const settle = (next: ProjectState) => {
      if (live) setState(next);
    };
    loadLineFeaturesApi()
      .then(async (api) => {
        const project = await api.getProject();
        const isLine = project && 'isLine' in project && project.isLine === true && Array.isArray(project.features);
        settle(isLine ? { phase: 'line', project, api } : { phase: 'not-line' });
      })
      .catch(() => settle({ phase: 'not-line' }));
    return () => {
      live = false;
    };
  }, [revision]);
  return state;
}

/** The Features screen of a Line project: which screen to show ("loading", "line" or "not-line") and, for a Line
 * project, the feature list and the chosen feature's detail (kept in the URL as ?feature=, the same parameter the
 * Pages screen reads, so a link carries the choice between screens). */
export function useLineFeatures(): { phase: 'loading' | 'line' | 'not-line'; view: LineFeaturesView } {
  const [revision, setRevision] = useState(0);
  const reload = useCallback(() => setRevision((n) => n + 1), []);
  const state = useLineFeaturesProject(revision);
  const selection = useUrlSelection('feature');
  const project = state.phase === 'line' ? state.project : null;
  const api = state.phase === 'line' ? state.api : null;
  const features = useMemo(() => (project ? featureCards(project) : []), [project]);
  const feature = selection.value && features.some((f) => f.name === selection.value) ? selection.value : null;
  const [detail, setDetail] = useState<DetailState>({ phase: 'idle' });
  const tabSelection = useUrlSelection('view');
  const tab: FeatureTab = tabSelection.value === 'workflows' ? 'workflows' : 'overview';
  const selectTab = tabSelection.select;
  const chooseTab = useCallback((next: FeatureTab) => selectTab(next === 'workflows' ? 'workflows' : null), [selectTab]);

  useEffect(() => {
    if (!api || !feature) {
      setDetail({ phase: 'idle' });
      return;
    }
    let live = true;
    setDetail({ phase: 'loading' });
    void loadFeature(api, feature).then((next) => {
      if (live) setDetail(next);
    });
    return () => {
      live = false;
    };
  }, [api, feature, revision]);

  const phase = state.phase === 'line' && !selection.ready ? 'loading' : state.phase;
  return { phase, view: { features, feature, choose: selection.select, detail, tab, chooseTab, project, reload } };
}
