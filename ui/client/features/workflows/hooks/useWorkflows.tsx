'use client';

import { useEffect, useReducer } from 'react';
import { useCanvasSelection } from './useCanvasSelection';
import { useWorkflowEditor } from './useWorkflowEditor';
import { useWorkflowNarrative } from './useWorkflowNarrative';
import { getWorkflowFeatures, getWorkflowFiles, getWorkflowMachines } from '../services/WorkflowsApi';
import { initialWorkflowsState, workflowsReducer, type WorkflowsAction } from '../workflows/Workflows';

/** Reads one workflow file's machines into the screen's state (or its error). */
function loadMachines(dispatch: (e: WorkflowsAction) => void, feature: string, file: string) {
  getWorkflowMachines(feature, file).then((r) => {
    if (r.ok === false || (r.error && !r.machines)) dispatch({ type: 'FILE_ERROR', error: r.error || 'Failed to read this workflow file.' });
    else dispatch({ type: 'FILE_LOADED', loaded: r });
  });
}

/** Two modes: open a feature and (optionally) one of its files in one go (a chat pick or a breadcrumb crumb). */
async function openPlace(state: { feature: string; file: string }, setFeature: (f: string) => Promise<void>, dispatch: (e: WorkflowsAction) => void, feature: string, file: string) {
  if (feature === state.feature && file === state.file) return;
  if (feature !== state.feature) await setFeature(feature);
  if (!feature || !file) return;
  dispatch({ type: 'OPEN_FILE', file });
  loadMachines(dispatch, feature, file);
}

/** Top-level browsing state for the Workflows screen — one feature -> one
 * workflows/ file -> that file's machines, re-extracted from the real
 * source each time a file is opened (and again via `reload`). */
export function useWorkflows() {
  const [state, dispatch] = useReducer(workflowsReducer, initialWorkflowsState);

  useEffect(() => {
    getWorkflowFeatures().then((r) => dispatch({ type: 'FEATURES_LOADED', features: r.features || [] }));
  }, []);

  // Choosing a feature also lists its workflows/ files (same handler, so
  // there is no separate effect to keep in sync with the selection).
  async function setFeature(feature: string) {
    dispatch({ type: 'SET_FEATURE', feature });
    if (!feature) return;
    const listing = await getWorkflowFiles(feature);
    dispatch({ type: 'FILES_LOADED', files: listing.files ?? [] });
  }

  const loadFile = (feature: string, file: string) => loadMachines(dispatch, feature, file);

  function openFile(file: string) {
    dispatch({ type: 'OPEN_FILE', file });
    loadFile(state.feature, file);
  }

  const goTo = (feature: string, file: string) => openPlace(state, setFeature, dispatch, feature, file);

  function reload() {
    if (state.feature && state.file) loadFile(state.feature, state.file);
  }

  const editor = useWorkflowEditor(state, dispatch);

  const narrative = useWorkflowNarrative(state.feature, state.file, state.loaded);

  const selection = useCanvasSelection(state.file);

  return { ...state, narrative, setFeature, openFile, goTo, reload, ...editor, ...selection };
}
