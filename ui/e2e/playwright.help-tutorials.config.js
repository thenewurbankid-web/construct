// Temporary, NOT part of the regular suite: this sandbox runs several
// concurrent agent worktrees on the same host, all sharing localhost — the
// checked-in playwright.config.js's reuseExistingServer:true on the
// standard :3000/:4000 ports means a run here can silently attach to
// ANOTHER agent's already-running dev server (observed directly while
// verifying #154's Tutorials section: :3000 was already serving a stale
// build from a different worktree with no /tutorials content). This file
// runs help-tutorials.spec.js against dedicated ports instead, the same
// pattern playwright.demo-listing-details.config.js established for #140.
// Not referenced by package.json's "test" script — a manual escape hatch
// for exactly this sandbox condition.
// Usage: npx playwright test --config=playwright.help-tutorials.config.js
import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT_SERVER = 4913;
const PORT_CLIENT = 3913;

export default defineConfig({
  testDir: './tests',
  testMatch: 'help-tutorials.spec.js',
  outputDir: './test-results-help-tutorials',
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
      env: { PORT: String(PORT_SERVER), UI_CLIENT_ORIGIN: `http://localhost:${PORT_CLIENT}` },
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
