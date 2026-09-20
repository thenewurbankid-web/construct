// Two WebSocketServers cannot both be built with `{ server, path }`: ws
// aborts an upgrade whose path is not its own with a 400, so the first one
// attached would refuse the second one's connections. Each socket is instead
// built `noServer` and hands the upgrade over here, by exact pathname, so any
// number of them can share one HTTP server.
export function pathnameOf(req) {
  try {
    return new URL(req.url, 'http://localhost').pathname;
  } catch {
    return null;
  }
}

export function routeUpgrade(server, wss, path) {
  server.on('upgrade', (req, socket, head) => {
    if (pathnameOf(req) !== path) return;
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });
}

/** Refuse an upgrade for a path no socket owns, as ws itself used to (400). */
export function refuseUnknownUpgrades(server, knownPaths) {
  const known = new Set(knownPaths);
  server.on('upgrade', (req, socket) => {
    if (known.has(pathnameOf(req))) return;
    socket.write('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
    socket.destroy();
  });
}
