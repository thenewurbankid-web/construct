// WebSocket endpoint for the `import --route` guided wizard — the one
// inherently multi-turn, chat-shaped flow in Construct. Drives the core
// CLI's `runImportRouteWizardEventDriven` (a thin, additive adapter added
// alongside the original `importRouteWizard` in src/cli.mjs) so the wizard
// itself is completely unmodified; this module only wires its events to a
// WebSocket connection and its `ask`-answers back from client messages.
//
// Message shapes:
//   client -> server: { type: 'start', seedRoute?: string }
//                      { type: 'answer', text: string }
//   server -> client: { type: 'log', kind?: 'warn'|'error', text }
//                      { type: 'question', text }
//                      { type: 'done' }
import { WebSocketServer } from 'ws';
import { runImportRouteWizardEventDriven } from '../../../src/cli.mjs';
import { getSettings } from './settings.mjs';

// The wizard's console-capturing adapter patches process-global console
// methods for its duration, so only one session may run at a time across
// this whole server — reasonable for a local, single-user tool.
let activeSession = null;

function send(ws, payload) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(payload));
}

export function attachWizardSocket(server, path = '/ws/wizard') {
  const wss = new WebSocketServer({ server, path });

  wss.on('connection', (ws) => {
    send(ws, {
      type: 'log',
      text: 'Connected to the import route wizard. Send {"type":"start"} to begin (optionally with a seedRoute).',
    });

    ws.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        send(ws, { type: 'log', kind: 'error', text: 'Malformed message — expected JSON.' });
        return;
      }

      if (msg.type === 'start') {
        if (activeSession) {
          send(ws, {
            type: 'log',
            kind: 'error',
            text: 'A wizard session is already running on this server — finish it (or restart the server) before starting another.',
          });
          return;
        }
        // importRouteWizard resolves its project root via process.cwd()
        // (same as every other Construct command run without --dir) — it
        // has no --dir flag of its own, so the settings-configured project
        // directory is applied here, once, at session start.
        const { projectDir } = getSettings();
        if (projectDir) {
          try {
            process.chdir(projectDir);
          } catch (e) {
            send(ws, { type: 'log', kind: 'error', text: `Could not switch to project directory "${projectDir}": ${e.message}` });
            return;
          }
        }
        activeSession = runImportRouteWizardEventDriven((event) => send(ws, event), msg.seedRoute || undefined);
        activeSession.done.finally(() => {
          activeSession = null;
        });
        return;
      }

      if (msg.type === 'answer') {
        if (!activeSession) {
          send(ws, { type: 'log', kind: 'error', text: 'No wizard session is running — send {"type":"start"} first.' });
          return;
        }
        activeSession.answer(typeof msg.text === 'string' ? msg.text : '');
        return;
      }

      send(ws, { type: 'log', kind: 'error', text: `Unknown message type "${msg.type}".` });
    });
  });

  return wss;
}
