import { parseAttributionLine } from '../domain/Wizard';
import type { ChatMessageData, ChatRole, ServerWizardEvent, WizardStatus } from '../types';

// Pure (WORKFLOW-001) — the wizard's whole chat/connection flow as a plain
// reducer instead of ad hoc setState calls scattered across event handlers.
export type WizardState = {
  messages: ChatMessageData[];
  status: WizardStatus;
  awaitingAnswer: boolean;
  nextId: number;
};

export type WizardAction =
  | { type: 'CONNECTED' }
  | { type: 'DISCONNECTED' }
  | { type: 'SOCKET_ERROR' }
  | { type: 'SERVER_EVENT'; event: ServerWizardEvent }
  | { type: 'START' }
  | { type: 'ANSWER_SENT'; text: string };

export const initialWizardState: WizardState = { messages: [], status: 'connecting', awaitingAnswer: false, nextId: 1 };

function pushMessage(state: WizardState, role: ChatRole, text: string): WizardState {
  const attribution = role === 'log' ? parseAttributionLine(text) : undefined;
  return { ...state, messages: [...state.messages, { id: state.nextId, role, text, attribution }], nextId: state.nextId + 1 };
}

function applyServerEvent(state: WizardState, event: ServerWizardEvent): WizardState {
  if (event.type === 'question') {
    return { ...pushMessage(state, 'question', event.text), awaitingAnswer: true, status: 'running' };
  }
  if (event.type === 'log') {
    return pushMessage(state, event.kind === 'error' ? 'error' : 'log', event.text);
  }
  return { ...pushMessage(state, 'system', 'Session finished.'), awaitingAnswer: false, status: 'done' };
}

export function wizardReducer(state: WizardState, action: WizardAction): WizardState {
  switch (action.type) {
    case 'CONNECTED':
      return { ...state, status: 'idle' };
    case 'DISCONNECTED':
      return { ...state, status: state.status === 'done' ? state.status : 'closed' };
    case 'SOCKET_ERROR':
      return pushMessage(state, 'error', 'WebSocket error — is the backend running?');
    case 'START':
      return { ...state, messages: [], status: 'running', awaitingAnswer: false };
    case 'ANSWER_SENT':
      return { ...pushMessage(state, 'answer', action.text), awaitingAnswer: false };
    case 'SERVER_EVENT':
      return applyServerEvent(state, action.event);
    default:
      return state;
  }
}
