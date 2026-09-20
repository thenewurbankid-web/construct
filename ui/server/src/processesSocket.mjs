// #292 — live updates for the Processes drawer.
//
// One-way: the server pushes `{type:'update', process}` (the same view the
// REST detail returns) every time the engine persists a change to a process
// in the project the Cockpit is looking at. Nothing a client sends changes
// anything — controls are REST POSTs — so this socket is read-only.
//
// It takes the SAME `auth` object as the wizard socket and the `/api` gate,
// so it can never be more permissive than REST: an upgrade with no valid
// session is refused with 401 at the handshake, before a socket exists. The
// origin check mirrors wizardSocket.mjs.
import { WebSocketServer } from 'ws';
import { processView } from './processesService.mjs';
import { routeUpgrade } from './wsUpgrade.mjs';

export function attachProcessesSocket(server, service, path = '/ws/processes', allowedOrigin, auth = null) {
  const wss = new WebSocketServer({
    noServer: true,
    verifyClient: allowedOrigin || auth
      ? (info, cb) => {
        if (allowedOrigin && info.origin !== allowedOrigin) return cb(false, 401, 'Unauthorized origin');
        if (auth && !auth.allows(info.req.headers)) return cb(false, 401, 'Authentication required');
        return cb(true);
      }
      : undefined,
  });

  routeUpgrade(server, wss, path);

  const unsubscribe = service.subscribe((record) => {
    if (!service.isCurrent(record)) return;
    const frame = JSON.stringify({ type: 'update', process: processView(record) });
    for (const ws of wss.clients) if (ws.readyState === ws.OPEN) ws.send(frame);
  });
  wss.on('close', unsubscribe);
  wss.on('connection', (ws) => {
    ws.send(JSON.stringify({ type: 'hello' }));
    ws.on('message', () => { /* read-only: inbound frames are ignored */ });
  });
  return wss;
}
