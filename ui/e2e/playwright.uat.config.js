// The owner's UAT walks (ui/e2e/uat/<step>.spec.js), ONE config for every step's walk: each review.md "UAT" how-to walked
// in a real browser the way a non-technical owner would (clicks and typing, no API shortcuts), failing on a console
// error, a 4xx/5xx answer, the error overlay, a serious axe finding or a sideways scroll (uat/support/uat.js). Like
// playwright.workspace.config.js: a narrow workspace of its own and NO preloaded project, so every walk starts at
// "Open a project" and opens its sample (copied into the workspace) from the list.
//
//   cd ui/e2e && E2E_CLIENT_PORT=3371 E2E_SERVER_PORT=4371 ../../packages/tools/dev/heavy.sh npx playwright test -c playwright.uat.config.js --workers=1
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import base from './playwright.config.js';

if (!process.env.E2E_UAT_SANDBOX || !fs.existsSync(process.env.E2E_UAT_SANDBOX)) {
  process.env.E2E_UAT_SANDBOX = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-uat-')));
}
const SANDBOX = process.env.E2E_UAT_SANDBOX;
const WORKSPACE = path.join(SANDBOX, 'workspace');
const STATE_DIR = path.join(SANDBOX, 'state');
fs.mkdirSync(WORKSPACE, { recursive: true });
// Read by the walks (both names: the integrator's walks use the first, the pre-UAT walks the second).
process.env.E2E_WORKSPACE_ROOT = WORKSPACE;
process.env.E2E_UAT_WORKSPACE = WORKSPACE;
process.env.E2E_STATE_DIR = STATE_DIR;

const SERVER_PORT = Number(process.env.E2E_SERVER_PORT) || 4000;
const CLIENT_ORIGIN = `http://localhost:${Number(process.env.E2E_CLIENT_PORT) || 3000}`;
process.env.E2E_API_BASE = `http://localhost:${SERVER_PORT}`;

export default {
  ...base,
  testDir: './uat',
  testIgnore: [],
  testMatch: /\.spec\.js$/,
  outputDir: './test-results-uat',
  timeout: 120_000,
  webServer: [
    {
      ...base.webServer[0],
      reuseExistingServer: false,
      // LINE_DRAFTER=1: the System 1 drafter's walk needs its routes on (off by default in Cockpit).
      env: { PORT: String(SERVER_PORT), UI_CLIENT_ORIGIN: CLIENT_ORIGIN, CONSTRUCT_STATE_DIR: STATE_DIR, CONSTRUCT_WORKSPACE_ROOT: WORKSPACE, LINE_DRAFTER: '1' },
    },
    { ...base.webServer[1], reuseExistingServer: false },
  ],
};
