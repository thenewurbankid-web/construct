// im1 + im2 walk (Settings' miss report; the drafter offering the top miss's route), on a server started with
// LINE_DRAFTER=1. Dedicated ports, never another session's servers (#140):
//   E2E_CLIENT_PORT=3398 E2E_SERVER_PORT=4398 npx playwright test -c playwright.im1-im2.config.js --workers=1
import base from './playwright.config.js';

export default {
  ...base,
  testDir: '.',
  testMatch: /(uat[\\/]im1-im2|tests[\\/]line-ai-steps)\.spec\.js$/,
  timeout: 90_000,
  webServer: base.webServer.map((w, i) => (i === 0 ? { ...w, env: { ...w.env, LINE_DRAFTER: '1' } } : w)),
};
