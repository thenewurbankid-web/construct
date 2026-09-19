'use client';

import { useCallback, useEffect, useReducer } from 'react';
import type { LlmCapability } from '../types';
import { fetchSettings, saveSettings } from '../services/Settings';
import { initialSettingsState, settingsReducer } from '../workflows/Settings';

export function useSettings() {
  const [state, dispatch] = useReducer(settingsReducer, initialSettingsState);

  useEffect(() => {
    fetchSettings().then((settings) => dispatch({ type: 'LOADED', settings }));
  }, []);

  const setProjectDirInput = useCallback((value: string) => dispatch({ type: 'SET_PROJECT_DIR', value }), []);
  const togglePicker = useCallback(() => dispatch({ type: 'TOGGLE_PICKER' }), []);
  const chooseDirectory = useCallback((value: string) => dispatch({ type: 'CHOOSE_DIR', value }), []);
  const setLlmProvider = useCallback(
    (capability: LlmCapability, value: string) => dispatch({ type: 'SET_LLM_PROVIDER', capability, value }),
    [],
  );

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
