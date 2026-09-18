'use client';

import { useCallback, useEffect, useMemo, useReducer, type Dispatch } from 'react';
import { fetchOllamaStatus, fetchOllamaModels } from '../services/Ollama';
import { pullOllamaModel, removeOllamaModel } from '../services/OllamaModelOps';
import { loadSelectedModel, saveSelectedModel } from '../services/OllamaModelSelection';
import { initialOllamaState, ollamaReducer, type OllamaAction, type OllamaState } from '../workflows/Ollama';
import { formatBytes, pullPercent } from '../domain/Ollama';
import { detectPlatform, installCommandFor } from '../domain/OllamaPlatform';
import { QWEN_CODER_TAGS, recommendedQwenTag } from '../domain/QwenModels';

// Extracted top-level (not a nested closure) so useOllama's own body stays
// short (READ-002) — loads status, then models if the daemon is running.
async function loadOllama(dispatch: Dispatch<OllamaAction>) {
  const status = await fetchOllamaStatus();
  dispatch({ type: 'STATUS_LOADED', status });
  if (!status.running) return;
  const result = await fetchOllamaModels();
  if ('models' in result) dispatch({ type: 'MODELS_LOADED', models: result.models });
  else dispatch({ type: 'LOAD_ERROR', message: result.error });
}

async function pullFlow(name: string, dispatch: Dispatch<OllamaAction>, refresh: () => Promise<void>) {
  if (!name.trim()) return;
  dispatch({ type: 'PULL_STARTED' });
  try {
    await pullOllamaModel(name.trim(), (progress) => dispatch({ type: 'PULL_PROGRESS', progress }));
    dispatch({ type: 'PULL_DONE' });
    await refresh();
  } catch (e) {
    dispatch({ type: 'PULL_ERROR', message: e instanceof Error ? e.message : String(e) });
  }
}

async function removeFlow(name: string, dispatch: Dispatch<OllamaAction>) {
  const result = await removeOllamaModel(name);
  if (result && result.ok === false) dispatch({ type: 'LOAD_ERROR', message: result.error });
  else dispatch({ type: 'MODEL_REMOVED', name });
}

function selectFlow(tag: string, dispatch: Dispatch<OllamaAction>) {
  saveSelectedModel(tag);
  dispatch({ type: 'SELECT_MODEL', tag });
}

// Derived, already-formatted view data — computed here (the hook), not in
// a component, since components may not import domain/services/workflows
// themselves (the component-to-app-logic rule).
function deriveView(state: OllamaState) {
  const platform = detectPlatform(typeof navigator === 'undefined' ? '' : navigator.userAgent);
  const installedNames = new Set(state.models.map((m) => m.name));
  return {
    platform,
    installCommand: installCommandFor(platform),
    models: state.models.map((m) => ({ ...m, sizeLabel: formatBytes(m.size) })),
    pullPercent: pullPercent(state.pullProgress),
    qwenTags: QWEN_CODER_TAGS.map((t) => ({ ...t, installed: installedNames.has(t.tag) })),
  };
}

export function useOllama() {
  const [state, dispatch] = useReducer(ollamaReducer, initialOllamaState);

  const refresh = useCallback(() => loadOllama(dispatch), []);
  useEffect(() => {
    refresh();
  }, [refresh]);
  // Loaded once on mount — a previously-saved selection wins, otherwise the
  // vetted smallest/fastest Qwen tag is the default (#99's "clear low-
  // resource-friendly default" requirement).
  useEffect(() => {
    dispatch({ type: 'SELECT_MODEL', tag: loadSelectedModel() ?? recommendedQwenTag() });
  }, []);

  const setPullName = useCallback((value: string) => dispatch({ type: 'SET_PULL_NAME', value }), []);
  const pull = useCallback(() => pullFlow(state.pullName, dispatch, refresh), [state.pullName, refresh]);
  const remove = useCallback((name: string) => removeFlow(name, dispatch), []);
  const selectModel = useCallback((tag: string) => selectFlow(tag, dispatch), []);
  const view = useMemo(() => deriveView(state), [state]);

  return {
    status: state.status,
    loadError: state.loadError,
    pullName: state.pullName,
    setPullName,
    pulling: state.pulling,
    pullProgress: state.pullProgress,
    pullError: state.pullError,
    pull,
    remove,
    refresh,
    selectedModel: state.selectedModel,
    selectModel,
    ...view,
  };
}
