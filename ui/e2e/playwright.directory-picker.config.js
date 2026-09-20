// Dedicated-port run for the directory picker spec (see #140):
//   E2E_CLIENT_PORT=3127 E2E_SERVER_PORT=4127 npx playwright test -c playwright.directory-picker.config.js
// #365: the picker is scoped to the workspace, so this runs under the workspace harness (a narrow workspace,
// no preloaded project). the boundary spec has its own run in `playwright.workspace.config.js`.
import workspace from './playwright.workspace.config.js';

export default {
  ...workspace,
  testMatch: /directory-picker\.spec\.js/,
};
