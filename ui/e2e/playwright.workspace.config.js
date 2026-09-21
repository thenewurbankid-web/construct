// Dedicated run for the workspace boundary (#365) and the directory picker that lives inside it.
//
//   E2E_CLIENT_PORT=3171 E2E_SERVER_PORT=4171 npx playwright test -c playwright.workspace.config.js
//   (the directory picker spec runs against the same harness: playwright.directory-picker.config.js)
//
// This server runs with a NARROW workspace (an empty directory of its own, not the OS temp dir the ordinary
// configs use) and NO preloaded project, so a spec sees exactly what a first-time visitor to a hosted Cockpit
// sees, and can prove the boundary: a sibling of the workspace really exists and must stay unreachable.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import base from './playwright.config.js';

// The runner and each worker evaluate this file; the environment carries the one directory between them.
if (!process.env.E2E_WORKSPACE_SANDBOX || !fs.existsSync(process.env.E2E_WORKSPACE_SANDBOX)) {
  process.env.E2E_WORKSPACE_SANDBOX = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-workspace-')));
}
const SANDBOX = process.env.E2E_WORKSPACE_SANDBOX;
const WORKSPACE = path.join(SANDBOX, 'workspace');
fs.mkdirSync(WORKSPACE, { recursive: true });
process.env.E2E_WORKSPACE_ROOT = WORKSPACE; // read by the specs

const SERVER_PORT = Number(process.env.E2E_SERVER_PORT) || 4000;
const CLIENT_ORIGIN = `http://localhost:${Number(process.env.E2E_CLIENT_PORT) || 3000}`;

export default {
  ...base,
  testIgnore: [],
  testMatch: /(workspace|project-gate)\.spec\.js/,
  timeout: 60_000,
  webServer: [
    {
      ...base.webServer[0],
      reuseExistingServer: false,
      env: {
        PORT: String(SERVER_PORT),
        UI_CLIENT_ORIGIN: CLIENT_ORIGIN,
        CONSTRUCT_STATE_DIR: path.join(SANDBOX, 'state'),
        CONSTRUCT_WORKSPACE_ROOT: WORKSPACE,
      },
    },
    { ...base.webServer[1], reuseExistingServer: false },
  ],
};
