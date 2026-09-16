import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// These tests exercise the real, rendered UI in a real browser — the gap
// left by every prior verification pass (curl for the API, `npm run build`
// for compile correctness, nobody ever loaded a page). They run against
// the actual dev servers (ui/server on :4000, ui/client's Vite dev server
// on :5173), started automatically below via Playwright's `webServer`
// option, exactly as documented in ui/README.md's "Run (two terminals)"
// section — just automated instead of two manual terminals.
export default defineConfig({
  testDir: './tests',
  outputDir: './test-results',
  fullyParallel: false, // the backend serializes command execution and allows only one wizard session at a time
  workers: 1,
  retries: 0,
  timeout: 30_000,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5173',
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
      url: 'http://localhost:4000/api/health',
      reuseExistingServer: true,
      timeout: 30_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      command: 'npm run dev',
      cwd: path.resolve(__dirname, '../client'),
      url: 'http://localhost:5173',
      reuseExistingServer: true,
      timeout: 30_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
  ],
});
