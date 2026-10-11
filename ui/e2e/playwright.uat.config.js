// The owner's UAT walks (ui/e2e/uat/<step>.spec.js): each review.md "UAT" how-to walked in a real browser the way a
// non-technical owner would, nothing through the API. Like playwright.workspace.config.js: a narrow workspace of its
// own and NO preloaded project, so every walk starts at "Open a project" and opens its sample from the list.
//
//   E2E_CLIENT_PORT=3348 E2E_SERVER_PORT=4358 npx playwright test -c playwright.uat.config.js --workers=1
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import base from './playwright.config.js';

if (!process.env.E2E_UAT_SANDBOX || !fs.existsSync(process.env.E2E_UAT_SANDBOX)) {
  process.env.E2E_UAT_SANDBOX = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-uat-')));
}
const SANDBOX = process.env.E2E_UAT_SANDBOX;
const WORKSPACE = path.join(SANDBOX, 'workspace');
fs.mkdirSync(WORKSPACE, { recursive: true });
process.env.E2E_WORKSPACE_ROOT = WORKSPACE; // read by the walks

const SERVER_PORT = Number(process.env.E2E_SERVER_PORT) || 4000;
const CLIENT_ORIGIN = `http://localhost:${Number(process.env.E2E_CLIENT_PORT) || 3000}`;

export default {
  ...base,
  testDir: './uat',
  testIgnore: [],
  testMatch: /\.spec\.js$/,
  timeout: 90_000,
  webServer: [
    {
      ...base.webServer[0],
      reuseExistingServer: false,
      env: { PORT: String(SERVER_PORT), UI_CLIENT_ORIGIN: CLIENT_ORIGIN, CONSTRUCT_STATE_DIR: path.join(SANDBOX, 'state'), CONSTRUCT_WORKSPACE_ROOT: WORKSPACE },
    },
    { ...base.webServer[1], reuseExistingServer: false },
  ],
};
