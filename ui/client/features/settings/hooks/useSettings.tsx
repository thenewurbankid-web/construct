'use client';

import { useCallback, useEffect, useReducer } from 'react';
import { fetchSettings, saveSettings } from '../services/Settings';
import { initialSettingsState, settingsReducer } from '../workflows/Settings';

export function useSettings() {
  const [state, dispatch] = useReducer(settingsReducer, initialSettingsState);

  useEffect(() => {
    fetchSettings().then((settings) => dispatch({ type: 'LOADED', settings }));
  }, []);

  const setProjectDirInput = useCallback((value: string) => dispatch({ type: 'SET_PROJECT_DIR', value }), []);
  const setLlmProvider = useCallback((value: string) => dispatch({ type: 'SET_LLM_PROVIDER', value }), []);

  const save = useCallback(async () => {
    const result = await saveSettings({ projectDir: state.projectDirInput, llmProvider: state.llmProvider });
    if (result.error) {
      dispatch({ type: 'SAVE_ERROR', message: result.error });
    } else {
      dispatch({ type: 'SAVE_OK', settings: result });
    }
  }, [state.projectDirInput, state.llmProvider]);

  return {
    settings: state.settings,
    projectDirInput: state.projectDirInput,
    setProjectDirInput,
    llmProvider: state.llmProvider,
    setLlmProvider,
    status: state.status,
    save,
  };
}
