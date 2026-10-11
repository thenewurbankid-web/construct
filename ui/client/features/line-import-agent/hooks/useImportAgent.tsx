'use client';

import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import { useLoadedApi } from '@/lib/useLoadedApi';
import { editArgs } from '../domain/AgentEdit';
import { agentScreen, isRefusal } from '../domain/AgentScreen';
import { loadImportAgentApi } from '../services/ImportAgentApi';
import { agentReducer, initialAgent } from '../workflows/AgentFlow';
import type { AgentActions, AgentControls, ImportAgentApi, ImportAgentView, LineRefusal } from '../types';

const NO_ANSWER = 'The Cockpit server did not answer; nothing was changed.';
type Send = (a: ImportAgentApi, folder: string) => Promise<ImportAgentView | LineRefusal>;

/** The folder named in the page's address (`?folder=`), so a reload or a shared link opens the same import. */
function folderFromUrl(): string {
  return typeof window === 'undefined' ? '' : new URLSearchParams(window.location.search).get('folder') ?? '';
}
function keepFolderInUrl(folder: string) {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  url.searchParams.set('folder', folder);
  window.history.replaceState(null, '', url.toString());
}

/** One click: approve the plan step the agent waits on (as the person), then let the agent carry on. */
function approveAndRun(planStepId: string | undefined): Send {
  return async (a, folder) => {
    if (!planStepId) return a.resumeImportAgent(folder);
    const approved = await a.approvePlanStep(planStepId);
    return isRefusal(approved) ? approved : a.resumeImportAgent(folder);
  };
}

/** The Import agent screen against the server (or the mock in Line mock mode). Every write happens on the server: the agent
 * adds plan steps, and the person's clicks here approve them. One call at a time. */
export function useImportAgent(given?: ImportAgentApi): AgentControls {
  const [state, dispatch] = useReducer(agentReducer, initialAgent);
  const api = useLoadedApi(loadImportAgentApi, given);
  const current = useRef(state);
  current.current = state;

  const call = useCallback((send: Send, folderNow?: string) => {
    const folder = (folderNow ?? current.current.folder).trim();
    if (!api || !folder || current.current.busy) return;
    dispatch({ type: 'CALL' });
    send(api, folder).then(
      (body) => {
        if (isRefusal(body)) return dispatch({ type: 'REFUSED', sentence: body.sentence });
        keepFolderInUrl(folder);
        return dispatch({ type: 'VIEW', view: body });
      },
      () => dispatch({ type: 'REFUSED', sentence: NO_ANSWER }),
    );
  }, [api]);

  useEffect(() => {
    if (!api) return;
    api.importFolders().then((body) => { if (!isRefusal(body)) dispatch({ type: 'FOLDERS', folders: body }); }, () => {});
    const folder = folderFromUrl();
    if (!folder) return;
    dispatch({ type: 'SET_FOLDER', folder });
    call((a, f) => a.getImportAgent(f), folder);
  }, [api, call]);

  const actions: AgentActions = useMemo(() => ({
    setFolder: (folder) => dispatch({ type: 'SET_FOLDER', folder }),
    start: () => call((a, f) => a.startImportAgent(f)),
    runMain: () => {
      const view = current.current.view;
      const main = agentScreen(view, null).main;
      if (main?.id === 'approve-all') return call((a, folder) => a.editImportStep({ folder, action: 'approve-all' }));
      if (main?.id === 'approve-run') return call(approveAndRun(view?.waiting?.planStepId));
      if (main?.id === 'resume') return call((a, f) => a.resumeImportAgent(f));
      return call((a, f) => a.startImportAgent(f));
    },
    pause: () => call((a, f) => a.pauseImportAgent(f)),
    answer: (questionId, optionId) => call((a, folder) => a.answerImportAgent({ folder, questionId, optionId })),
    approveStep: (stepId) => call((a, folder) => a.editImportStep({ folder, action: 'approve', stepId })),
    skip: (stepId) => {
      const step = current.current.view?.steps.find((s) => s.id === stepId);
      call((a, folder) => a.editImportStep({ folder, action: step?.review === 'skipped' ? 'unskip' : 'skip', stepId }));
    },
    move: (stepId, to) => call((a, folder) => a.editImportStep({ folder, action: 'move', stepId, to })),
    openEdit: (stepId) => dispatch({ type: 'EDIT', stepId }),
    saveEdit: (stepId, values) => {
      const step = current.current.view?.steps.find((s) => s.id === stepId);
      call((a, folder) => a.editImportStep({ folder, action: 'edit', stepId, args: editArgs(step?.tool ?? '', values) }));
    },
  }), [call]);

  const screen = useMemo(() => agentScreen(state.view, state.editing), [state.view, state.editing]);
  return useMemo(() => ({ state, screen, actions }), [state, screen, actions]);
}
