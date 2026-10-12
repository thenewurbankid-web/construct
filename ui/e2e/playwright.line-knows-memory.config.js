// "What Line knows", Memory tab: forget one record on the real server and store. Dedicated ports, never another
// session's servers (#140):
//   E2E_CLIENT_PORT=3397 E2E_SERVER_PORT=4397 npx playwright test -c playwright.line-knows-memory.config.js --workers=1
import base from './playwright.config.js';

export default {
  ...base,
  testDir: '.',
  testMatch: /tests[\\/]line-knows-memory\.spec\.js$/,
  timeout: 120_000,
};
