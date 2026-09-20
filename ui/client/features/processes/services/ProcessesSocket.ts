import { WS_BASE } from '@/lib/apiBase';
import type { ProcessDetail } from '../types';

type Handlers = {
  onOpen: () => void;
  onClose: () => void;
  onUpdate: (detail: ProcessDetail) => void;
};

/** Opens the read-only live socket (ui/server /ws/processes). The server pushes
 * one `update` per persisted change; nothing is ever sent the other way. */
export function connectProcessesSocket(handlers: Handlers): WebSocket {
  const ws = new WebSocket(`${WS_BASE}/ws/processes`);
  ws.onopen = handlers.onOpen;
  ws.onclose = handlers.onClose;
  ws.onmessage = (event) => {
    try {
      const frame = JSON.parse(event.data) as { type?: string; process?: ProcessDetail };
      if (frame.type === 'update' && frame.process) handlers.onUpdate(frame.process);
    } catch {
      // A malformed frame is ignored; the next update replaces the whole view anyway.
    }
  };
  return ws;
}
