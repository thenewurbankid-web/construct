import { WS_BASE } from '@/lib/apiBase';
import type { ClientWizardEvent, ServerWizardEvent } from '../types';

type WizardSocketHandlers = {
  onOpen: () => void;
  onClose: () => void;
  onError: () => void;
  onMessage: (event: ServerWizardEvent) => void;
};

/** Real I/O — opens the wizard's WebSocket and wires the given handlers.
 * The wizard is inherently a multi-turn conversation, which is exactly why
 * it stays on ui/server's own WebSocket transport rather than a Next.js API
 * route (see the decision recorded on epic #64). */
export function connectWizardSocket(handlers: WizardSocketHandlers): WebSocket {
  const ws = new WebSocket(`${WS_BASE}/ws/wizard`);
  ws.onopen = handlers.onOpen;
  ws.onclose = handlers.onClose;
  ws.onerror = handlers.onError;
  ws.onmessage = (event) => {
    try {
      handlers.onMessage(JSON.parse(event.data));
    } catch {
      // Malformed frame — ignored, matching the original client's behavior.
    }
  };
  return ws;
}

function send(ws: WebSocket, event: ClientWizardEvent): void {
  ws.send(JSON.stringify(event));
}

export function sendStart(ws: WebSocket, seedRoute?: string): void {
  send(ws, { type: 'start', seedRoute: seedRoute || undefined });
}

export function sendAnswer(ws: WebSocket, text: string): void {
  send(ws, { type: 'answer', text });
}
