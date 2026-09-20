// Dedicated run for the Processes drawer spec (#292).
//
//   E2E_CLIENT_PORT=3121 E2E_SERVER_PORT=4121 npx playwright test -c playwright.processes.config.js
//
// The spec needs ui/server started with a fake step executor (support/
// processes-server.mjs: the real server, the real engine, one seam swapped),
// so it cannot share the ordinary config's `npm start`. Kept separate for the
// same reason playwright.auth.config.js is: the ordinary suite keeps proving
// the plain server.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import base from './playwright.config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_PORT = Number(process.env.E2E_SERVER_PORT) || 4000;
const CLIENT_ORIGIN = `http://localhost:${Number(process.env.E2E_CLIENT_PORT) || 3000}`;

export default {
  ...base,
  testMatch: /processes-drawer\.spec\.js/,
  timeout: 60_000,
  webServer: [
    {
      ...base.webServer[0],
      command: 'node ../e2e/support/processes-server.mjs',
      cwd: path.resolve(__dirname, '../server'),
      reuseExistingServer: false,
      env: { PORT: String(SERVER_PORT), UI_CLIENT_ORIGIN: CLIENT_ORIGIN },
    },
    { ...base.webServer[1], reuseExistingServer: false },
  ],
};
