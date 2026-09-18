// Dedicated-ports config for settings-llm.spec.js (#109) — same pattern as
// playwright.help-tutorials.config.js (#140): a run on the shared :3000/:4000
// can silently attach to another agent's servers, so this uses its own pair
// with reuseExistingServer:false. Not referenced by package.json's "test".
// Usage: npx playwright test --config=playwright.settings-llm.config.js
import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT_SERVER = 4103;
const PORT_CLIENT = 3103;

export default defineConfig({
  testDir: './tests',
  testMatch: 'settings-llm.spec.js',
  outputDir: './test-results-settings-llm',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 240_000,
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
      timeout: 90_000,
      stdout: 'pipe',
      stderr: 'pipe',
      env: { NEXT_PUBLIC_API_BASE: `http://localhost:${PORT_SERVER}`, NEXT_PUBLIC_WS_BASE: `ws://localhost:${PORT_SERVER}` },
    },
  ],
});
