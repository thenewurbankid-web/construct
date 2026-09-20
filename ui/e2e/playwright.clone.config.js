// Dedicated run for cloning a repository into the workspace (#330 slice A).
//
//   E2E_CLIENT_PORT=3771 E2E_SERVER_PORT=4771 npx playwright test -c playwright.clone.config.js --workers=1
//
// Same harness as the workspace config (a narrow workspace of its own, NO preloaded project) plus ONE test-only
// switch: CONSTRUCT_E2E_CLONE_LOCAL_ROOT names a directory of fixture repositories that may be cloned through a
// file:// URL. The server refuses that variable on a non-loopback host (the same guard as
// CONSTRUCT_E2E_PROJECT_DIR), and without it the clone path is https-only. There is no network in this run.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import base from './playwright.config.js';

if (!process.env.E2E_WORKSPACE_SANDBOX || !fs.existsSync(process.env.E2E_WORKSPACE_SANDBOX)) {
  process.env.E2E_WORKSPACE_SANDBOX = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-clone-')));
}
const SANDBOX = process.env.E2E_WORKSPACE_SANDBOX;
const WORKSPACE = path.join(SANDBOX, 'workspace');
const FIXTURES = path.join(SANDBOX, 'fixtures');
fs.mkdirSync(WORKSPACE, { recursive: true });
fs.mkdirSync(FIXTURES, { recursive: true });
process.env.E2E_WORKSPACE_ROOT = WORKSPACE; // read by the spec
process.env.E2E_CLONE_FIXTURES = FIXTURES;

const SERVER_PORT = Number(process.env.E2E_SERVER_PORT) || 4000;
const CLIENT_ORIGIN = `http://localhost:${Number(process.env.E2E_CLIENT_PORT) || 3000}`;

export default {
  ...base,
  testIgnore: [],
  testMatch: /clone\.spec\.js/,
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
        CONSTRUCT_E2E_CLONE_LOCAL_ROOT: FIXTURES,
      },
    },
    { ...base.webServer[1], reuseExistingServer: false },
  ],
};
