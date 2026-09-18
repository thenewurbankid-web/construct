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
//
// #80 — runImportRouteWizardEventDriven's console-capture is now scoped
// per-session via an AsyncLocalStorage context (src/cli.mjs), not a global
// monkey-patch, so more than one wizard session can genuinely run at once
// without cross-talk. The guard below is per-*connection* only (a single
// WebSocket still can't double-start a session on itself) — different
// connections no longer block each other the way the old single
// process-wide `activeSession` variable did.
import { WebSocketServer } from 'ws';
import { runImportRouteWizardEventDriven } from '../../../src/cli.mjs';
import { getSettings } from './settings.mjs';

function send(ws, payload) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(payload));
}

// WebSocket handshakes aren't covered by Express's cors() middleware (that
// only guards regular HTTP requests) and browsers don't block a cross-
// origin `new WebSocket(...)` the way they block a cross-origin fetch --
// the server has to check the Origin header itself, or any page a
// developer has open can quietly drive this wizard (which can call an LLM)
// from their own tab. `allowedOrigin` mirrors index.mjs's CLIENT_ORIGIN
// check; omit it (leave undefined) only in a context that intentionally
// wants no restriction, e.g. a future test harness -- never in production.
export function attachWizardSocket(server, path = '/ws/wizard', allowedOrigin) {
  const wss = new WebSocketServer({
    server,
    path,
    verifyClient: allowedOrigin
      ? (info) => info.origin === allowedOrigin
      : undefined,
  });

  wss.on('connection', (ws) => {
    let session = null;

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
        if (session) {
          send(ws, {
            type: 'log',
            kind: 'error',
            text: 'A wizard session is already running on this connection — finish it before starting another.',
          });
          return;
        }
        // importRouteWizard resolves its project root via process.cwd()
        // (same as every other Construct command run without --dir) — it
        // has no --dir flag of its own, so the settings-configured project
        // directory is applied here, once, at session start. This is
        // process-wide (one settings store for the whole server), so
        // concurrent sessions always share the same project root — that's
        // expected (they're all working in the same Construct project),
        // and unrelated to the per-session log-capture this fixes.
        const { projectDir } = getSettings();
        if (projectDir) {
          try {
            process.chdir(projectDir);
          } catch (e) {
            send(ws, { type: 'log', kind: 'error', text: `Could not switch to project directory "${projectDir}": ${e.message}` });
            return;
          }
        }
        session = runImportRouteWizardEventDriven((event) => send(ws, event), msg.seedRoute || undefined);
        session.done.finally(() => {
          session = null;
        });
        return;
      }

      if (msg.type === 'answer') {
        if (!session) {
          send(ws, { type: 'log', kind: 'error', text: 'No wizard session is running — send {"type":"start"} first.' });
          return;
        }
        session.answer(typeof msg.text === 'string' ? msg.text : '');
        return;
      }

      send(ws, { type: 'log', kind: 'error', text: `Unknown message type "${msg.type}".` });
    });
  });

  return wss;
}
