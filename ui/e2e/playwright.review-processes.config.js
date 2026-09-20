// Dedicated run for the Review-analyses-as-processes spec (#351).
//
//   E2E_CLIENT_PORT=3461 E2E_SERVER_PORT=4461 npx playwright test -c playwright.review-processes.config.js
//
// The spec needs ui/server started with a slow review worker (support/review-server.mjs: the real server,
// the real engine and store, one seam swapped), so it cannot share the ordinary config's `npm start`.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import base from './playwright.config.js';
import { workspaceEnv } from './support/workspace.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_PORT = Number(process.env.E2E_SERVER_PORT) || 4000;
const CLIENT_ORIGIN = `http://localhost:${Number(process.env.E2E_CLIENT_PORT) || 3000}`;
// Where the slow worker records its pid and directories; the spec reads the same file.
const MARKER = process.env.OG351_MARKER || path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'og351-marker-')), 'worker.json');
process.env.OG351_MARKER = MARKER;

export default {
  ...base,
  testMatch: /review-processes\.spec\.js/,
  timeout: 90_000,
  webServer: [
    {
      ...base.webServer[0],
      command: 'node ../e2e/support/review-server.mjs',
      cwd: path.resolve(__dirname, '../server'),
      reuseExistingServer: false,
      env: { PORT: String(SERVER_PORT), UI_CLIENT_ORIGIN: CLIENT_ORIGIN, OG351_MARKER: MARKER, ...workspaceEnv({ preload: false }) },
    },
    { ...base.webServer[1], reuseExistingServer: false },
  ],
};
