import type { OllamaStatus, OllamaModel, PullProgress } from '../types';

// Pure (WORKFLOW-001: no react import) — the Ollama screen's own flow
// state: daemon status, installed models, and the one in-flight pull's
// progress (Ollama's local API only supports one pull at a time anyway).
export type OllamaState = {
  status: OllamaStatus | null;
  models: OllamaModel[];
  loadError: string | null;
  // The status request itself failed (backend unreachable), distinct from
  // 'Ollama not running', which is a successful answer.
  statusError: string | null;
  pullName: string;
  pulling: boolean;
  pullProgress: PullProgress | null;
  pullError: string | null;
  // Epic 6.3/#99 — the user's chosen "active" local model (persisted via
  // services/OllamaModelSelection.tsx). Independent of `models`/pulling:
  // a model can be selected before it's even installed.
  selectedModel: string | null;
};

export type OllamaAction =
  | { type: 'STATUS_LOADED'; status: OllamaStatus }
  | { type: 'STATUS_FAILED'; message: string }
  | { type: 'STATUS_RETRY' }
  | { type: 'MODELS_LOADED'; models: OllamaModel[] }
  | { type: 'LOAD_ERROR'; message: string }
  | { type: 'SET_PULL_NAME'; value: string }
  | { type: 'PULL_STARTED' }
  | { type: 'PULL_PROGRESS'; progress: PullProgress }
  | { type: 'PULL_DONE' }
  | { type: 'PULL_ERROR'; message: string }
  | { type: 'MODEL_REMOVED'; name: string }
  | { type: 'SELECT_MODEL'; tag: string };

export const initialOllamaState: OllamaState = {
  status: null,
  models: [],
  loadError: null,
  statusError: null,
  pullName: '',
  pulling: false,
  pullProgress: null,
  pullError: null,
  selectedModel: null,
};

export function ollamaReducer(state: OllamaState, action: OllamaAction): OllamaState {
  switch (action.type) {
    case 'STATUS_LOADED':
      return { ...state, status: action.status, loadError: null, statusError: null };
    case 'STATUS_FAILED':
      return { ...state, statusError: action.message };
    case 'STATUS_RETRY':
      return { ...state, statusError: null };
    case 'MODELS_LOADED':
      return { ...state, models: action.models, loadError: null };
    case 'LOAD_ERROR':
      return { ...state, loadError: action.message };
    case 'SET_PULL_NAME':
      return { ...state, pullName: action.value };
    case 'PULL_STARTED':
      return { ...state, pulling: true, pullProgress: null, pullError: null };
    case 'PULL_PROGRESS':
      return { ...state, pullProgress: action.progress };
    case 'PULL_DONE':
      return { ...state, pulling: false };
    case 'PULL_ERROR':
      return { ...state, pulling: false, pullError: action.message };
    case 'MODEL_REMOVED':
      return { ...state, models: state.models.filter((m) => m.name !== action.name) };
    case 'SELECT_MODEL':
      return { ...state, selectedModel: action.tag };
    default:
      return state;
  }
}
