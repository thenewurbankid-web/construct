'use client';

import { useEffect, useReducer } from 'react';
import { useWorkflowEditor } from './useWorkflowEditor';
import { useWorkflowNarrative } from './useWorkflowNarrative';
import { getWorkflowFeatures, getWorkflowFiles, getWorkflowMachines } from '../services/WorkflowsApi';
import { initialWorkflowsState, workflowsReducer } from '../workflows/Workflows';

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

  function loadFile(feature: string, file: string) {
    getWorkflowMachines(feature, file).then((r) => {
      if (r.ok === false || (r.error && !r.machines)) dispatch({ type: 'FILE_ERROR', error: r.error || 'Failed to read this workflow file.' });
      else dispatch({ type: 'FILE_LOADED', loaded: r });
    });
  }

  function openFile(file: string) {
    dispatch({ type: 'OPEN_FILE', file });
    loadFile(state.feature, file);
  }

  function reload() {
    if (state.feature && state.file) loadFile(state.feature, state.file);
  }

  const editor = useWorkflowEditor(state, dispatch);

  const narrative = useWorkflowNarrative(state.feature, state.file, state.loaded);

  return { ...state, narrative, setFeature, openFile, reload, ...editor };
}
