// Acceptance for any built project: BENCH_PROJECT is the project folder, BENCH_PORT its port (default 3395).
// The project is built and started with `next build && next start` (production mode, one server, one worker).
// Run through ../run-acceptance.sh, which goes through heavy.sh.
import { defineConfig } from '@playwright/test';

const project = process.env.BENCH_PROJECT;
if (!project) throw new Error('Set BENCH_PROJECT to the project folder to test.');
const port = Number(process.env.BENCH_PORT ?? 3395);

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 30_000,
  expect: { timeout: 4_000 },
  reporter: [['list'], ['json', { outputFile: process.env.BENCH_REPORT ?? 'report.json' }]],
  use: { baseURL: `http://localhost:${port}`, trace: 'off' },
  webServer: {
    command: `npx next build && npx next start -p ${port}`,
    cwd: project,
    url: `http://localhost:${port}`,
    timeout: 300_000,
    reuseExistingServer: false,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
