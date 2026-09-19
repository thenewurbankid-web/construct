// Dedicated-port run for the source-view spec (see #140):
//   E2E_CLIENT_PORT=3121 E2E_SERVER_PORT=4121 npx playwright test -c playwright.source-view.config.js
// Never reuses another session's servers.
import base from './playwright.config.js';

export default {
  ...base,
  testMatch: /pages-editor-source-view\.spec\.js/,
  timeout: 60_000,
};
