// Dedicated-port run for the directory picker spec (see #140):
//   E2E_CLIENT_PORT=3127 E2E_SERVER_PORT=4127 npx playwright test -c playwright.directory-picker.config.js
import base from './playwright.config.js';

export default {
  ...base,
  testMatch: /directory-picker\.spec\.js/,
  timeout: 60_000,
};
