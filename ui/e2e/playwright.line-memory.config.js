// im3 + j5 (memory of past answers per step): the UAT walk, on a server started with LINE_DRAFTER=1. Dedicated ports,
// never another session's servers (#140):
//   E2E_CLIENT_PORT=3399 E2E_SERVER_PORT=4399 npx playwright test -c playwright.line-memory.config.js --workers=1
import base from './playwright.config.js';

export default {
  ...base,
  testDir: '.',
  testMatch: /(uat[\\/]im3-j5|tests[\\/]line-ai-steps)\.spec\.js$/,
  timeout: 180_000,
  webServer: base.webServer.map((w, i) => (i === 0 ? { ...w, env: { ...w.env, LINE_DRAFTER: '1' } } : w)),
};
