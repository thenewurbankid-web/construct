// NOT part of the regular suite: several agent worktrees share localhost, and
// the standard config's reuseExistingServer on :3000/:4000 can silently
// attach to another run's servers (see #140). This runs workflows.spec.js
// (epic #57) against dedicated ports 3105/4105 instead, with
// reuseExistingServer:false. Not referenced by package.json's "test" script.
// Usage: npx playwright test --config=playwright.workflows.config.js
import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT_SERVER = 4105;
const PORT_CLIENT = 3105;

export default defineConfig({
  testDir: './tests',
  testMatch: 'workflows.spec.js',
  outputDir: './test-results-workflows',
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
