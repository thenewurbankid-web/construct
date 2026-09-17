'use client';

import { useEffect, useReducer, useRef, useState } from 'react';
import { connectWizardSocket, sendAnswer, sendStart } from '../services/Wizard';
import { initialWizardState, wizardReducer } from '../workflows/Wizard';

/** Connects to ui/server's /ws/wizard endpoint on mount and drives the
 * whole chat/connection flow through the pure wizardReducer — the hook's
 * own job is just the React lifecycle (the socket's real open/close/error/
 * message wiring lives in the service layer). */
export function useWizard() {
  const [state, dispatch] = useReducer(wizardReducer, initialWizardState);
  const [input, setInput] = useState('');
  const [seedRoute, setSeedRoute] = useState('');
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
  }, []);

  function start() {
    dispatch({ type: 'START' });
    if (wsRef.current) sendStart(wsRef.current, seedRoute);
  }

  function submitAnswer(e: React.FormEvent) {
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
