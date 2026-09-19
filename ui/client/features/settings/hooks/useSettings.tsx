'use client';

import { useCallback, useEffect, useReducer, type Dispatch } from 'react';
import type { LlmCapability } from '../types';
import { describeError } from '@/features/states';
import { fetchSettings, saveSettings } from '../services/Settings';
import { initialSettingsState, settingsReducer, type SettingsAction } from '../workflows/Settings';

// Top-level (not a closure) so useSettings stays short; failure becomes state
// (plain-language message + retry) instead of an endless "Loading…".
function loadSettings(dispatch: Dispatch<SettingsAction>) {
  dispatch({ type: 'LOAD_RETRY' });
  return fetchSettings()
    .then((settings) => dispatch({ type: 'LOADED', settings }))
    .catch((e) => dispatch({ type: 'LOAD_FAILED', message: describeError(e, 'settings').hint }));
}

export function useSettings() {
  const [state, dispatch] = useReducer(settingsReducer, initialSettingsState);

  const load = useCallback(() => loadSettings(dispatch), []);
  useEffect(() => {
    load();
  }, [load]);

  const setProjectDirInput = useCallback((value: string) => dispatch({ type: 'SET_PROJECT_DIR', value }), []);
  const togglePicker = useCallback(() => dispatch({ type: 'TOGGLE_PICKER' }), []);
  const chooseDirectory = useCallback((value: string) => dispatch({ type: 'CHOOSE_DIR', value }), []);
  const setLlmProvider = useCallback((capability: LlmCapability, value: string) => dispatch({ type: 'SET_LLM_PROVIDER', capability, value }), []);

  const save = useCallback(async () => {
    const result = await saveSettings({ projectDir: state.projectDirInput, llmProviders: state.llmProviders });
    if (result.error) {
      dispatch({ type: 'SAVE_ERROR', message: result.error });
    } else {
      dispatch({ type: 'SAVE_OK', settings: result });
    }
  }, [state.projectDirInput, state.llmProviders]);

  return {
    settings: state.settings,
    loadError: state.loadError,
    reload: load,
    projectDirInput: state.projectDirInput,
    setProjectDirInput,
    llmProviders: state.llmProviders,
    setLlmProvider,
    status: state.status,
    pickerOpen: state.pickerOpen,
    togglePicker,
    chooseDirectory,
    save,
  };
}
