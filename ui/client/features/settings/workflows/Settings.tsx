import type { LlmCapability, LlmProviders, SaveStatus, Settings } from '../types';

// Pure (WORKFLOW-001: no react import) — the settings screen's own small
// amount of flow state: the loaded settings, the editable form fields
// (project dir + one provider choice per LLM capability), and the save
// outcome.
export type SettingsState = {
  settings: Settings | null;
  projectDirInput: string;
  llmProviders: LlmProviders;
  status: SaveStatus | null;
};

export type SettingsAction =
  | { type: 'LOADED'; settings: Settings }
  | { type: 'SET_PROJECT_DIR'; value: string }
  | { type: 'SET_LLM_PROVIDER'; capability: LlmCapability; value: string }
  | { type: 'SAVE_OK'; settings: Settings }
  | { type: 'SAVE_ERROR'; message: string };

export const initialSettingsState: SettingsState = {
  settings: null,
  projectDirInput: '',
  llmProviders: { importFill: '', createFill: '', planAnalysis: '' },
  status: null,
};

export function settingsReducer(state: SettingsState, action: SettingsAction): SettingsState {
  switch (action.type) {
    case 'LOADED':
      return {
        ...state,
        settings: action.settings,
        projectDirInput: action.settings.projectDir,
        llmProviders: action.settings.llmProviders,
      };
    case 'SET_PROJECT_DIR':
      return { ...state, projectDirInput: action.value };
    case 'SET_LLM_PROVIDER':
      return { ...state, llmProviders: { ...state.llmProviders, [action.capability]: action.value } };
    case 'SAVE_OK':
      return { ...state, settings: action.settings, status: { ok: true, message: 'Settings saved.' } };
    case 'SAVE_ERROR':
      return { ...state, status: { ok: false, message: action.message } };
    default:
      return state;
  }
}
