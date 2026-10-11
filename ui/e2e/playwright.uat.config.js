import { defineConfig, devices } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Pre-UAT walks (ui/e2e/uat/): each spec walks one UAT how-to from docs/line/review.md exactly as the owner would,
// on a fresh copy of examples/line-sample, opened from the project picker (no API shortcut). Every walk also fails on
// a console error, a React warning, a 4xx/5xx answer, the Next.js error overlay, a serious axe finding, or a
// horizontal page scroll at 1280px or 375px (see uat/support/uat.js).
//
//   cd ui/e2e && E2E_CLIENT_PORT=3371 E2E_SERVER_PORT=4371 ../../packages/tools/dev/heavy.sh npx playwright test -c playwright.uat.config.js --workers=1
//
// The workspace root is a fresh temp folder holding only the sample, so the picker shows exactly what the owner sees.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_PORT = Number(process.env.E2E_CLIENT_PORT) || 3000;
const SERVER_PORT = Number(process.env.E2E_SERVER_PORT) || 4000;
const CLIENT_ORIGIN = `http://localhost:${CLIENT_PORT}`;
const SERVER_ORIGIN = `http://localhost:${SERVER_PORT}`;
const REUSE = process.env.E2E_REUSE_SERVERS === '1';
process.env.E2E_API_BASE = SERVER_ORIGIN;
const WORKSPACE = process.env.E2E_UAT_WORKSPACE || fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `line-uat-ws-${process.pid}-`)));
process.env.E2E_UAT_WORKSPACE = WORKSPACE;
const STATE_DIR = process.env.E2E_STATE_DIR || fs.mkdtempSync(path.join(os.tmpdir(), `construct-e2e-state-${process.pid}-`));
process.env.E2E_STATE_DIR = STATE_DIR;

export default defineConfig({
  testDir: './uat',
  outputDir: './test-results-uat',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  reporter: [['list']],
  use: { baseURL: CLIENT_ORIGIN, trace: 'retain-on-failure', viewport: { width: 1280, height: 800 } },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } }],
  webServer: [
    {
      command: 'npm start',
      cwd: path.resolve(__dirname, '../server'),
      url: `${SERVER_ORIGIN}/api/health`,
      reuseExistingServer: REUSE,
      timeout: 30_000,
      stdout: 'pipe',
      stderr: 'pipe',
      env: { PORT: String(SERVER_PORT), UI_CLIENT_ORIGIN: CLIENT_ORIGIN, CONSTRUCT_STATE_DIR: STATE_DIR, CONSTRUCT_WORKSPACE_ROOT: WORKSPACE },
    },
    {
      command: `npx next dev -p ${CLIENT_PORT}`,
      cwd: path.resolve(__dirname, '../client'),
      url: CLIENT_ORIGIN,
      reuseExistingServer: REUSE,
      timeout: 60_000,
      stdout: 'pipe',
      stderr: 'pipe',
      env: { NEXT_PUBLIC_API_BASE: SERVER_ORIGIN, NEXT_PUBLIC_WS_BASE: `ws://localhost:${SERVER_PORT}` },
    },
  ],
});
