// System 1 drafter specs (the "Describe a change" box), on a server started with LINE_DRAFTER=1 (the drafter is off by
// default). Dedicated ports, never another session's servers (#140):
//   E2E_CLIENT_PORT=3373 E2E_SERVER_PORT=4373 npx playwright test -c playwright.line-drafter.config.js --workers=1
import base from './playwright.config.js';

export default {
  ...base,
  testDir: '.',
  testMatch: /(tests[\\/]line-drafter|uat[\\/]s1-drafter)\.spec\.js$/,
  timeout: 60_000,
  webServer: base.webServer.map((w, i) => (i === 0 ? { ...w, env: { ...w.env, LINE_DRAFTER: '1' } } : w)),
};
