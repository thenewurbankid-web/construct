// Dedicated-port run for the quick-fix spec (see #140):
//   E2E_CLIENT_PORT=3181 E2E_SERVER_PORT=4181 npx playwright test -c playwright.quick-fix.config.js
// Never reuses another session's servers.
import base from './playwright.config.js';

export default {
  ...base,
  testMatch: /pages-editor-quick-fix\.spec\.js/,
  timeout: 60_000,
};
