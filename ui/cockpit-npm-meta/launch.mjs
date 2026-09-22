#!/usr/bin/env node
// #485 -- `npx @line/cockpit` / `cockpit` (the package's `bin` entry). Starts
// the two compiled processes this package ships (ui/server's esbuild
// bundle, ui/client's Next.js standalone server) exactly like
// tools/dev/run-hosted.sh runs them by hand in this repo, using this
// package's own already-compiled output -- no build step at launch time.
//
// NEXT_PUBLIC_API_BASE / NEXT_PUBLIC_WS_BASE are compiled into the client
// bundle at `next build` time (see ui/build.sh), so this launcher can only
// serve the client/server pair at the host they were built for
// (http://localhost:4000 by default for this published package). Point
// CONSTRUCT_WORKSPACE_ROOT/CONSTRUCT_SESSION_SECRET/etc. at real values for
// anything beyond local, loopback-only use; for a different public host,
// build your own image from source instead (see docs/DEPLOY.md in the repo).
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const SERVER_ENTRY = path.join(ROOT, 'ui', 'server', 'dist', 'index.mjs');
const CLIENT_ENTRY = path.join(ROOT, 'ui', 'client', 'standalone', 'server.js');

const serverPort = process.env.PORT_SERVER || '4000';
const clientPort = process.env.PORT_CLIENT || process.env.PORT || '3000';
const host = process.env.HOST || '127.0.0.1';

const workspaceRoot = process.env.CONSTRUCT_WORKSPACE_ROOT || path.join(os.homedir(), '.construct-cockpit', 'workspace');
fs.mkdirSync(workspaceRoot, { recursive: true });

console.log(`Construct Cockpit`);
console.log(`  Server: http://${host}:${serverPort}`);
console.log(`  Client: http://${host}:${clientPort}`);
console.log(`  Workspace: ${workspaceRoot} (set CONSTRUCT_WORKSPACE_ROOT to change it)`);
if (!process.env.CONSTRUCT_GITHUB_CLIENT_ID) {
  console.log('  GitHub login: not configured (set CONSTRUCT_GITHUB_CLIENT_ID/SECRET + CONSTRUCT_ALLOWED_LOGINS for a shared/non-loopback host)');
}

const children = [];
function spawnOne(name, entry, env) {
  const child = spawn(process.execPath, [entry], { stdio: 'inherit', env: { ...process.env, ...env } });
  children.push(child);
  child.on('exit', (code) => {
    console.error(`${name} exited (${code}); stopping the other process.`);
    for (const c of children) if (c !== child && !c.killed) c.kill('SIGTERM');
    process.exitCode = code ?? 1;
  });
  return child;
}

spawnOne('server', SERVER_ENTRY, {
  HOST: host,
  PORT: serverPort,
  CONSTRUCT_WORKSPACE_ROOT: workspaceRoot,
});
spawnOne('client', CLIENT_ENTRY, {
  HOSTNAME: host,
  PORT: clientPort,
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    for (const c of children) if (!c.killed) c.kill(sig);
  });
}
