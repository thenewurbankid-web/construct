// Recording harness for the user-guide videos (module 10, docs/MEDIA.md).
//
//   E2E_CLIENT_PORT=3820 E2E_SERVER_PORT=4820 \
//     /path/to/tools/dev/heavy.sh npx playwright test -c playwright.media.config.js --workers=1
//
// A real Cockpit with the sign-in gate armed and the documented e2e test login (CONSTRUCT_AUTH_TEST_USER,
// loopback only), and an EMPTY workspace with no project preloaded, so the recording starts at the sign-in
// screen and the "Open a project" gate. Excluded from the default config and every other config.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import base from './playwright.config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// The runner and each worker evaluate this file; the environment carries the one directory between them.
if (!process.env.E2E_MEDIA_SANDBOX || !fs.existsSync(process.env.E2E_MEDIA_SANDBOX)) {
  process.env.E2E_MEDIA_SANDBOX = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-media-')));
}
const SANDBOX = process.env.E2E_MEDIA_SANDBOX;
const WORKSPACE = path.join(SANDBOX, 'workspace');
fs.mkdirSync(WORKSPACE, { recursive: true });
process.env.E2E_WORKSPACE_ROOT = WORKSPACE;

const CLIENT_PORT = Number(process.env.E2E_CLIENT_PORT) || 3820;
const SERVER_PORT = Number(process.env.E2E_SERVER_PORT) || 4820;
const CLIENT_ORIGIN = `http://localhost:${CLIENT_PORT}`;
const SERVER_ORIGIN = `http://localhost:${SERVER_PORT}`;
process.env.E2E_API_BASE = SERVER_ORIGIN;

export default {
  ...base,
  testDir: './tests/media',
  testIgnore: [],
  testMatch: /\.spec\.js$/,
  outputDir: path.join(SANDBOX, 'results'),
  timeout: 240_000,
  use: {
    baseURL: CLIENT_ORIGIN,
    viewport: { width: 1280, height: 720 },
    video: { mode: 'on', size: { width: 1280, height: 720 } },
    trace: 'off',
  },
  projects: [{ name: 'media', use: { browserName: 'chromium', viewport: { width: 1280, height: 720 } } }],
  webServer: [
    {
      command: 'npm start',
      cwd: path.resolve(__dirname, '../server'),
      url: `${SERVER_ORIGIN}/api/health`,
      reuseExistingServer: false,
      timeout: 30_000,
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        PORT: String(SERVER_PORT),
        HOST: '127.0.0.1',
        UI_CLIENT_ORIGIN: CLIENT_ORIGIN,
        CONSTRUCT_AUTH: 'required',
        CONSTRUCT_AUTH_TEST_USER: 'demo-owner',
        CONSTRUCT_SESSION_SECRET: 'media-session-secret-not-a-real-one-0123456789',
        NODE_ENV: 'test',
        CONSTRUCT_STATE_DIR: path.join(SANDBOX, 'state'),
        CONSTRUCT_WORKSPACE_ROOT: WORKSPACE, // empty; deliberately no CONSTRUCT_E2E_PROJECT_DIR
      },
    },
    {
      command: `npx next dev -p ${CLIENT_PORT}`,
      cwd: path.resolve(__dirname, '../client'),
      url: CLIENT_ORIGIN,
      reuseExistingServer: false,
      timeout: 60_000,
      stdout: 'pipe',
      stderr: 'pipe',
      env: { NEXT_PUBLIC_API_BASE: SERVER_ORIGIN, NEXT_PUBLIC_WS_BASE: `ws://localhost:${SERVER_PORT}`, WATCHPACK_POLLING: 'true', CHOKIDAR_USEPOLLING: '1' },
    },
  ],
};
