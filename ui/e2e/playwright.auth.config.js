// Dedicated run for the login gate spec (#278).
//
//   E2E_CLIENT_PORT=3051 E2E_SERVER_PORT=4051 npx playwright test -c playwright.auth.config.js
//
// This config exists because the auth spec needs ui/server started in a
// *different posture* from every other spec: the gate armed
// (CONSTRUCT_AUTH=required) and the e2e test login enabled
// (CONSTRUCT_AUTH_TEST_USER). Deliberately not folded into the shared
// playwright.config.js — the rest of the suite keeps running in the
// ordinary unauthenticated-loopback posture, so the escape hatch is not
// quietly normalised across the whole test suite, and the other specs keep
// proving that a Cockpit with no gate still works.
//
// The server refuses to start with CONSTRUCT_AUTH_TEST_USER set unless
// NODE_ENV is not production and it is bound to loopback, both of which
// hold here.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import base from './playwright.config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_PORT = Number(process.env.E2E_CLIENT_PORT) || 3000;
const SERVER_PORT = Number(process.env.E2E_SERVER_PORT) || 4000;
const CLIENT_ORIGIN = `http://localhost:${CLIENT_PORT}`;
const SERVER_ORIGIN = `http://localhost:${SERVER_PORT}`;

export default {
  ...base,
  testMatch: /auth\.spec\.js/,
  timeout: 60_000,
  webServer: [
    {
      command: 'npm start',
      cwd: path.resolve(__dirname, '../server'),
      // /api/health is the one route above the gate, so it still answers
      // 200 with no session and Playwright can wait on it.
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
        CONSTRUCT_AUTH_TEST_USER: 'e2e-owner',
        CONSTRUCT_SESSION_SECRET: 'e2e-session-secret-not-a-real-one-0123456789',
        NODE_ENV: 'test',
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
      env: { NEXT_PUBLIC_API_BASE: SERVER_ORIGIN, NEXT_PUBLIC_WS_BASE: `ws://localhost:${SERVER_PORT}` },
    },
  ],
};
