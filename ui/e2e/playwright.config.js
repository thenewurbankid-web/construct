import { defineConfig, devices } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { workspaceEnv } from './support/workspace.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Ports are env-configurable so concurrent runs (several agents/worktrees,
// or you plus CI, on one host) never share servers (#140). Defaults stay
// :3000/:4000 for humans. Existing servers are NOT reused unless
// E2E_REUSE_SERVERS=1 — reusing whatever happens to be listening on the port
// is what previously caused silent cross-talk between sessions.
const CLIENT_PORT = Number(process.env.E2E_CLIENT_PORT) || 3000;
const SERVER_PORT = Number(process.env.E2E_SERVER_PORT) || 4000;
const CLIENT_ORIGIN = `http://localhost:${CLIENT_PORT}`;
const SERVER_ORIGIN = `http://localhost:${SERVER_PORT}`;
const REUSE = process.env.E2E_REUSE_SERVERS === '1';
// Read by the specs (API_BASE) — set here so Playwright's workers inherit it.
process.env.E2E_API_BASE = SERVER_ORIGIN;
// The server's process-record directory. A spec that needs a saved plan (Review mode's expected scope,
// #316) seeds a process record here, through the same store the server reads.
// The pid in the name is what lets tools/dev/heavy.sh tell a live run's state from a dead one (#414).
const STATE_DIR = process.env.E2E_STATE_DIR || fs.mkdtempSync(path.join(os.tmpdir(), `construct-e2e-state-${process.pid}-`));
process.env.E2E_STATE_DIR = STATE_DIR;

// These tests exercise the real, rendered UI in a real browser — the gap
// left by every prior verification pass (curl for the API, `npm run build`
// for compile correctness, nobody ever loaded a page). They run against
// the actual dev servers (ui/server on :4000, ui/client's Next.js dev
// server on :3000 — moved from Vite's :5173 in #73), started automatically
// below via Playwright's `webServer` option, exactly as documented in
// ui/README.md's "Run (two terminals)" section — just automated instead of
// two manual terminals.
export default defineConfig({
  testDir: './tests',
  // Two specs need a server of their own (a fake step executor, and a seed route that only that harness
  // exposes) and assert a clean process store, so under THIS config they fail by construction. They run under
  // their own configs, which the full-suite recipe in ui/README.md lists:
  //   npx playwright test -c playwright.processes.config.js
  //   npx playwright test -c playwright.processes-approval.config.js
  testIgnore: [/processes-drawer\.spec\.js/, /processes-approval\.spec\.js/, /workspace\.spec\.js/, /project-gate\.spec\.js/, /clone\.spec\.js/, /directory-picker\.spec\.js/, /auth\.spec\.js/, /login-hero\.spec\.js/],
  outputDir: './test-results',
  fullyParallel: false, // the backend serializes create/refactor/research/import command execution (commandRunner.mjs's queue) — unrelated to the wizard, whose sessions (#80) can now run concurrently and are exercised that way within a single test below
  workers: 1,
  retries: 0,
  timeout: 30_000,
  reporter: [['list']],
  use: {
    baseURL: CLIENT_ORIGIN,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: [
    {
      command: 'npm start',
      cwd: path.resolve(__dirname, '../server'),
      url: `${SERVER_ORIGIN}/api/health`,
      reuseExistingServer: REUSE,
      timeout: 30_000,
      stdout: 'pipe',
      stderr: 'pipe',
      // ui/server restricts CORS + WebSocket origin to UI_CLIENT_ORIGIN.
      // #292: process records live in a per-user state dir; a fresh one keeps the
      // ordinary suite from ever seeing a real process of the developer's own.
      env: { PORT: String(SERVER_PORT), UI_CLIENT_ORIGIN: CLIENT_ORIGIN, CONSTRUCT_STATE_DIR: STATE_DIR, ...workspaceEnv() },
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
