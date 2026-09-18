// Temporary, NOT part of the regular suite: this sandbox runs several
// concurrent agent worktrees on the same host, all sharing localhost — the
// checked-in playwright.config.js's reuseExistingServer:true on the
// standard :3000/:4000 ports means a demo run here can silently attach to
// ANOTHER agent's already-running dev server and cross-talk with its
// in-memory currentRoot() state (observed directly: an unrelated
// "DiscountWidget" import command appeared in this run's server log, and a
// created "products" feature never showed up in the Pages Editor select).
// This file runs the exact same demo spec against dedicated ports instead,
// so its evidence is real and not racy. Not referenced by package.json's
// "test" script — a manual escape hatch for exactly this sandbox
// condition (see #140 for the underlying issue and a real fix's shape).
// Usage: NEXT_PUBLIC_API_BASE=http://localhost:4911 npx playwright test
// --config=playwright.demo-listing-details.config.js
import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT_SERVER = 4911;
const PORT_CLIENT = 3911;

export default defineConfig({
  testDir: './tests/demos',
  outputDir: './test-results-demo',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30_000,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT_CLIENT}`,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'npm start',
      cwd: path.resolve(__dirname, '../server'),
      url: `http://localhost:${PORT_SERVER}/api/health`,
      reuseExistingServer: false,
      timeout: 30_000,
      stdout: 'pipe',
      stderr: 'pipe',
      env: { PORT: String(PORT_SERVER) },
    },
    {
      command: `npx next dev -p ${PORT_CLIENT}`,
      cwd: path.resolve(__dirname, '../client'),
      url: `http://localhost:${PORT_CLIENT}`,
      reuseExistingServer: false,
      timeout: 60_000,
      stdout: 'pipe',
      stderr: 'pipe',
      env: { NEXT_PUBLIC_API_BASE: `http://localhost:${PORT_SERVER}` },
    },
  ],
});
