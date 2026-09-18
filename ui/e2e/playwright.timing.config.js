import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Dedicated config for #167's timing-display spec: its own client/server
// port pair (3102/4102) and reuseExistingServer:false, so it can never
// silently attach to another checkout's dev servers on :3000/:4000.
// Run: npx playwright test -c playwright.timing.config.js
export default defineConfig({
  testDir: './tests',
  testMatch: 'timing-display.spec.js',
  outputDir: './test-results-timing',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30_000,
  reporter: [['list']],
  use: { baseURL: 'http://localhost:3102', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'npm start',
      cwd: path.resolve(__dirname, '../server'),
      url: 'http://localhost:4102/api/health',
      reuseExistingServer: false,
      env: { PORT: '4102', UI_CLIENT_ORIGIN: 'http://localhost:3102' },
      timeout: 30_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      command: 'npm run dev -- -p 3102',
      cwd: path.resolve(__dirname, '../client'),
      url: 'http://localhost:3102',
      reuseExistingServer: false,
      env: { NEXT_PUBLIC_API_BASE: 'http://localhost:4102', NEXT_PUBLIC_WS_BASE: 'ws://localhost:4102' },
      timeout: 60_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
  ],
});
