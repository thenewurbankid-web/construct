'use client';

import { useEffect, useReducer, useRef, useState, type Dispatch, type FormEvent } from 'react';
import { breadcrumbs, canChoose, chooseHint } from '../domain/ProjectPaths';
import { useProjectTree } from './useProjectTree';
import { connectWizardSocket, sendAnswer, sendCancel, sendReview, sendStart } from '../services/Wizard';
import { initialWizardState, wizardReducer, type WizardAction } from '../workflows/Wizard';

/** Opens the socket on mount and tears it down on unmount — the socket's
 * real open/close/error/message wiring lives in the service layer; this
 * just owns the React lifecycle and hands the ref back. */
function useWizardSocket(dispatch: Dispatch<WizardAction>) {
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    const ws = connectWizardSocket({
      onOpen: () => dispatch({ type: 'CONNECTED' }),
      // A socket that has already been replaced (React StrictMode mounts, unmounts and remounts in
      // development) reports its close late; that stale close must not overwrite the live socket's
      // open, or a healthy session shows as "Disconnected".
      onClose: () => {
        if (wsRef.current === ws) dispatch({ type: 'DISCONNECTED' });
      },
      onError: () => dispatch({ type: 'SOCKET_ERROR' }),
      onMessage: (event) => dispatch({ type: 'SERVER_EVENT', event }),
    });
    wsRef.current = ws;
    return () => ws.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return wsRef;
}

/** Connects to ui/server's /ws/wizard endpoint and drives the whole chat/
 * connection flow through the pure wizardReducer. */
export function useWizard() {
  const [state, dispatch] = useReducer(wizardReducer, initialWizardState);
  const [input, setInput] = useState('');
  const [seedRoute, setSeedRoute] = useState('');
  const [planner, setPlanner] = useState<'ai' | 'mechanical'>('ai');
  const wsRef = useWizardSocket(dispatch);
  const projectTree = useProjectTree();
  const expects = state.expects;

  function start() {
    dispatch({ type: 'START' });
    if (wsRef.current) sendStart(wsRef.current, seedRoute, planner);
  }

  function cancel() {
    if (state.status !== 'running' || state.cancelling) return;
    dispatch({ type: 'CANCEL_SENT' });
    if (wsRef.current) sendCancel(wsRef.current);
  }

  function review() {
    if (!state.reviewable || state.reviewing) return;
    dispatch({ type: 'REVIEW_SENT' });
    if (wsRef.current) sendReview(wsRef.current);
  }

  function chooseFromPicker(path: string) {
    setInput(path);
    projectTree.closePicker();
  }

  function submitAnswer(e: FormEvent) {
    e.preventDefault();
    if (!state.awaitingAnswer) return;
    projectTree.closePicker();
    dispatch({ type: 'ANSWER_SENT', text: input });
    if (wsRef.current) sendAnswer(wsRef.current, input);
    setInput('');
  }

  return {
    messages: state.messages,
    status: state.status,
    awaitingAnswer: state.awaitingAnswer,
    steps: state.steps,
    cancelling: state.cancelling,
    reviewable: state.reviewable,
    reviewing: state.reviewing,
    review,
    cancel,
    input,
    setInput,
    seedRoute,
    planner,
    setPlanner,
    setSeedRoute,
    start,
    submitAnswer,
    /** The project picker for a question that wants a path (#600); `undefined` for every other question. */
    picker: expects
      ? {
          expects,
          open: projectTree.open,
          tree: projectTree.tree,
          crumbs: breadcrumbs(projectTree.tree?.path ?? ''),
          loading: projectTree.loading,
          error: projectTree.error,
          canChooseEntry: (entry: Parameters<typeof canChoose>[1]) => canChoose(expects, entry),
          hintFor: (entry: Parameters<typeof chooseHint>[1]) => chooseHint(expects, entry),
          openPicker: projectTree.openPicker,
          load: projectTree.load,
          choose: chooseFromPicker,
          close: projectTree.closePicker,
        }
      : undefined,
  };
}
