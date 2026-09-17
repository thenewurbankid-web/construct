import type { SaveStatus, Settings } from '../types';

// Pure (WORKFLOW-001: no react import) — the settings screen's own small
// amount of flow state: the loaded settings, the two editable form fields,
// and the save outcome.
export type SettingsState = {
  settings: Settings | null;
  projectDirInput: string;
  llmProvider: string;
  status: SaveStatus | null;
};

export type SettingsAction =
  | { type: 'LOADED'; settings: Settings }
  | { type: 'SET_PROJECT_DIR'; value: string }
  | { type: 'SET_LLM_PROVIDER'; value: string }
  | { type: 'SAVE_OK'; settings: Settings }
  | { type: 'SAVE_ERROR'; message: string };

export const initialSettingsState: SettingsState = {
  settings: null,
  projectDirInput: '',
  llmProvider: '',
  status: null,
};

export function settingsReducer(state: SettingsState, action: SettingsAction): SettingsState {
  switch (action.type) {
    case 'LOADED':
      return { ...state, settings: action.settings, projectDirInput: action.settings.projectDir, llmProvider: action.settings.llmProvider };
    case 'SET_PROJECT_DIR':
      return { ...state, projectDirInput: action.value };
    case 'SET_LLM_PROVIDER':
      return { ...state, llmProvider: action.value };
    case 'SAVE_OK':
      return { ...state, settings: action.settings, status: { ok: true, message: 'Settings saved.' } };
    case 'SAVE_ERROR':
      return { ...state, status: { ok: false, message: action.message } };
    default:
      return state;
  }
}
