// Dedicated run for "Connect GitHub for private repositories" (#638): connect, pick a repository, clone with the login,
// disconnect, and the pasted-token fallback. Everything runs against a MOCK GitHub (support/mock-github.mjs, a local http
// server standing in for github.com/login/oauth and api.github.com); the real one is never contacted.
//
//   npx playwright test -c playwright.github-repo.config.js --workers=1
//
// Ports (this feature's e2e range is 49200-49299; override with the E2E_* variables): mock GitHub 49210, Cockpit client
// 49211, Cockpit server 49212. Playwright starts all three and stops all three when the run ends.
//
// The server runs in the posture the hosted Cockpit has: login REQUIRED, with the e2e test login (which mints a real
// signed session cookie) so the connection is proven session-bound. The clone source is a local bare repository named
// through the test-harness-only CONSTRUCT_E2E_CLONE_LOCAL_ROOT; the connection's GitHub URLs are pointed at the mock
// through the test-harness-only CONSTRUCT_E2E_GITHUB_REPO_*_BASE variables (both are refused off loopback).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.E2E_CLIENT_PORT ||= '49211';
process.env.E2E_SERVER_PORT ||= '49212';
process.env.E2E_MOCK_GITHUB_PORT ||= '49210';
const { default: base } = await import('./playwright.config.js');
const { MOCK_CLIENT_ID, MOCK_CLIENT_SECRET } = await import('./support/mock-github.mjs');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
if (!process.env.E2E_WORKSPACE_SANDBOX || !fs.existsSync(process.env.E2E_WORKSPACE_SANDBOX)) {
  process.env.E2E_WORKSPACE_SANDBOX = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-ghrepo-')));
}
const SANDBOX = process.env.E2E_WORKSPACE_SANDBOX;
const WORKSPACE = path.join(SANDBOX, 'workspace');
const FIXTURES = path.join(SANDBOX, 'fixtures');
fs.mkdirSync(WORKSPACE, { recursive: true });
fs.mkdirSync(FIXTURES, { recursive: true });
process.env.E2E_WORKSPACE_ROOT = WORKSPACE; // read by the spec
process.env.E2E_CLONE_FIXTURES = FIXTURES;

const SERVER_PORT = Number(process.env.E2E_SERVER_PORT);
const MOCK_PORT = Number(process.env.E2E_MOCK_GITHUB_PORT);
const CLIENT_ORIGIN = `http://localhost:${Number(process.env.E2E_CLIENT_PORT)}`;
const MOCK_ORIGIN = `http://127.0.0.1:${MOCK_PORT}`;
process.env.E2E_MOCK_GITHUB_ORIGIN = MOCK_ORIGIN;

export default {
  ...base,
  testIgnore: [],
  testMatch: /private-repo-login\.spec\.js/,
  timeout: 90_000,
  webServer: [
    {
      command: `node support/mock-github.mjs ${MOCK_PORT}`,
      cwd: __dirname,
      url: `${MOCK_ORIGIN}/__seen`,
      reuseExistingServer: false,
      timeout: 15_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      ...base.webServer[0],
      reuseExistingServer: false,
      env: {
        PORT: String(SERVER_PORT),
        HOST: '127.0.0.1',
        UI_CLIENT_ORIGIN: CLIENT_ORIGIN,
        NODE_ENV: 'test',
        CONSTRUCT_AUTH: 'required',
        CONSTRUCT_AUTH_TEST_USER: 'e2e-owner',
        CONSTRUCT_SESSION_SECRET: 'e2e-session-secret-not-a-real-one-0123456789',
        CONSTRUCT_STATE_DIR: path.join(SANDBOX, 'state'),
        CONSTRUCT_WORKSPACE_ROOT: WORKSPACE,
        CONSTRUCT_E2E_CLONE_LOCAL_ROOT: FIXTURES,
        // The mock's own client id and secret: fixed test values, not credentials for anything.
        CONSTRUCT_GITHUB_REPO_CLIENT_ID: MOCK_CLIENT_ID,
        CONSTRUCT_GITHUB_REPO_CLIENT_SECRET: MOCK_CLIENT_SECRET,
        CONSTRUCT_E2E_GITHUB_REPO_OAUTH_BASE: MOCK_ORIGIN,
        CONSTRUCT_E2E_GITHUB_REPO_API_BASE: MOCK_ORIGIN,
      },
    },
    { ...base.webServer[1], reuseExistingServer: false },
  ],
};
