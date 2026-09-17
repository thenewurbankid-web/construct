'use client';

import { useEffect, useReducer, useRef, useState, type Dispatch, type FormEvent } from 'react';
import { connectWizardSocket, sendAnswer, sendStart } from '../services/Wizard';
import { initialWizardState, wizardReducer, type WizardAction } from '../workflows/Wizard';

/** Opens the socket on mount and tears it down on unmount — the socket's
 * real open/close/error/message wiring lives in the service layer; this
 * just owns the React lifecycle and hands the ref back. */
function useWizardSocket(dispatch: Dispatch<WizardAction>) {
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    const ws = connectWizardSocket({
      onOpen: () => dispatch({ type: 'CONNECTED' }),
      onClose: () => dispatch({ type: 'DISCONNECTED' }),
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
  const wsRef = useWizardSocket(dispatch);

  function start() {
    dispatch({ type: 'START' });
    if (wsRef.current) sendStart(wsRef.current, seedRoute);
  }

  function submitAnswer(e: FormEvent) {
    e.preventDefault();
    if (!state.awaitingAnswer) return;
    dispatch({ type: 'ANSWER_SENT', text: input });
    if (wsRef.current) sendAnswer(wsRef.current, input);
    setInput('');
  }

  return {
    messages: state.messages,
    status: state.status,
    awaitingAnswer: state.awaitingAnswer,
    input,
    setInput,
    seedRoute,
    setSeedRoute,
    start,
    submitAnswer,
  };
}
