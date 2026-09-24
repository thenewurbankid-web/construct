import { parseAttributionLine } from '../domain/Wizard';
import { applyStepEvent, endRun, initialSteps, stepNote, type WizardStep } from '../domain/WizardSteps';
import type { ChatMessageData, ChatRole, PathExpectation, ServerWizardEvent, WizardStatus } from '../types';

// Pure (WORKFLOW-001) — the wizard's whole chat/connection flow as a plain
// reducer instead of ad hoc setState calls scattered across event handlers.
export type WizardState = {
  messages: ChatMessageData[];
  status: WizardStatus;
  awaitingAnswer: boolean;
  /** Set while the open question wants a project path, so the UI can offer the picker (#600). */
  expects?: PathExpectation;
  nextId: number;
  /** The framework's blocks in run order, one active at a time (#599). */
  steps: WizardStep[];
  cancelling: boolean;
};

export type WizardAction =
  | { type: 'CONNECTED' }
  | { type: 'DISCONNECTED' }
  | { type: 'SOCKET_ERROR' }
  | { type: 'SERVER_EVENT'; event: ServerWizardEvent }
  | { type: 'START' }
  | { type: 'ANSWER_SENT'; text: string }
  | { type: 'CANCEL_SENT' };

export const initialWizardState: WizardState = { messages: [], status: 'connecting', awaitingAnswer: false, nextId: 1, steps: initialSteps(), cancelling: false };

function pushMessage(state: WizardState, role: ChatRole, text: string): WizardState {
  const attribution = role === 'log' ? parseAttributionLine(text) : undefined;
  return { ...state, messages: [...state.messages, { id: state.nextId, role, text, attribution }], nextId: state.nextId + 1 };
}

/** The model's streamed output arrives in pieces: a piece continues the previous `thought` message when
 * nothing else has been said since, otherwise it opens a new one. */
function appendThought(state: WizardState, text: string): WizardState {
  const last = state.messages[state.messages.length - 1];
  if (last && last.role === 'thought') {
    return { ...state, messages: [...state.messages.slice(0, -1), { ...last, text: last.text + text }] };
  }
  return pushMessage(state, 'thought', text);
}

function applyServerEvent(state: WizardState, event: ServerWizardEvent): WizardState {
  if (event.type === 'step') {
    const pushed = pushMessage(state, 'step', stepNote(event));
    const messages = event.reason ? pushed.messages.map((m, i) => (i === pushed.messages.length - 1 ? { ...m, reason: event.reason } : m)) : pushed.messages;
    return { ...pushed, messages, steps: applyStepEvent(state.steps, event) };
  }
  if (event.type === 'thought') {
    return appendThought(state, event.text);
  }
  if (event.type === 'question') {
    return { ...pushMessage(state, 'question', event.text), awaitingAnswer: true, expects: event.expects, status: 'running' };
  }
  if (event.type === 'log') {
    return pushMessage(state, event.kind === 'error' ? 'error' : 'log', event.text);
  }
  return { ...pushMessage(state, 'system', 'Session finished.'), awaitingAnswer: false, status: 'done', steps: endRun(state.steps), cancelling: false };
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
      return { ...state, messages: [], status: 'running', awaitingAnswer: false, steps: initialSteps(), cancelling: false };
    case 'ANSWER_SENT':
      return { ...pushMessage(state, 'answer', action.text), awaitingAnswer: false, expects: undefined };
    case 'CANCEL_SENT':
      return { ...pushMessage(state, 'system', 'Cancelling…'), cancelling: true, awaitingAnswer: false, expects: undefined };
    case 'SERVER_EVENT':
      return applyServerEvent(state, action.event);
    default:
      return state;
  }
}
