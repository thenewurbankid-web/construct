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
  loadError: string | null;
  pickerOpen: boolean;
};

export type SettingsAction =
  | { type: 'TOGGLE_PICKER' }
  | { type: 'CHOOSE_DIR'; value: string }
  | { type: 'LOADED'; settings: Settings }
  | { type: 'LOAD_FAILED'; message: string }
  | { type: 'LOAD_RETRY' }
  | { type: 'SET_PROJECT_DIR'; value: string }
  | { type: 'SET_LLM_PROVIDER'; capability: LlmCapability; value: string }
  | { type: 'SAVE_OK'; settings: Settings }
  | { type: 'SAVE_ERROR'; message: string };

export const initialSettingsState: SettingsState = {
  settings: null,
  projectDirInput: '',
  llmProviders: { importFill: '', createFill: '', planAnalysis: '' },
  status: null,
  loadError: null,
  pickerOpen: false,
};

export function settingsReducer(state: SettingsState, action: SettingsAction): SettingsState {
  switch (action.type) {
    case 'TOGGLE_PICKER':
      return { ...state, pickerOpen: !state.pickerOpen };
    case 'CHOOSE_DIR':
      // Picking a folder only fills the input; nothing changes server-side until Save.
      return { ...state, projectDirInput: action.value, pickerOpen: false };
    case 'LOAD_FAILED':
      return { ...state, loadError: action.message };
    case 'LOAD_RETRY':
      return { ...state, loadError: null };
    case 'LOADED':
      return {
        ...state,
        settings: action.settings,
        loadError: null,
        projectDirInput: action.settings.projectDir ?? "",
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
