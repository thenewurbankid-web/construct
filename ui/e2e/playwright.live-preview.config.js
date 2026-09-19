// Dedicated-port run for the live-preview spec (see #140):
//   E2E_CLIENT_PORT=3125 E2E_SERVER_PORT=4125 E2E_PREVIEW_PORT=5125 npx playwright test -c playwright.live-preview.config.js
import base from './playwright.config.js';

export default {
  ...base,
  testMatch: /pages-editor-live-preview\.spec\.js/,
  timeout: 90_000,
};
