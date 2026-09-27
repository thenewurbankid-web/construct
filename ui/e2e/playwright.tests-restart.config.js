// Dedicated run for the "a done Tests-tab run survives a server restart" spec (#416).
//
//   E2E_CLIENT_PORT=3141 E2E_SERVER_PORT=4141 npx playwright test -c playwright.tests-restart.config.js
//
// The spec itself spawns and kills the REAL ui/server (a genuine OS process, not a stub), so it can restart it
// mid-test and prove the result survives -- something Playwright's own `webServer` option cannot do (it starts a
// command once, before every test, and stops it once, after). Only the Next.js client is started the ordinary
// way; the client's own `NEXT_PUBLIC_API_BASE` (set by the base config from `E2E_SERVER_PORT`) points it at
// whatever port the spec's server child binds, so client and spec-managed server always agree. Kept separate for
// the same reason playwright.processes.config.js is.
import base from './playwright.config.js';

export default {
  ...base,
  testIgnore: [], // the base config ignores nothing here, but a dedicated config never inherits testMatch either
  testMatch: /tests-tab-restart\.spec\.js/,
  timeout: 90_000,
  webServer: [
    { ...base.webServer[1], reuseExistingServer: false },
  ],
};
