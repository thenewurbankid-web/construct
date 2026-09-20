// Dedicated run for the approval-gate spec (#341).
//
//   E2E_CLIENT_PORT=3161 E2E_SERVER_PORT=4161 npx playwright test -c playwright.processes-approval.config.js
//
// Same harness as the Processes drawer run (support/processes-server.mjs), but its own server: the
// drawer spec asserts "0 processes" first, and this spec seeds a finished process with a real git
// repo and a bot branch, so the two must not share a server.
import base from './playwright.processes.config.js';

export default {
  ...base,
  testMatch: /processes-approval\.spec\.js/,
};
