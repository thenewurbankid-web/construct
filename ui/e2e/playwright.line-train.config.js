// Train Line specs (tests/line-train.spec.js, with the owner's walk merged in) on the real server,
// with a training root of their own (LINE_TRAIN_ROOT, seeded from the repo's line/train on first open), so a run never
// changes the committed cases.
//
//   E2E_CLIENT_PORT=3374 E2E_SERVER_PORT=4374 npx playwright test -c playwright.line-train.config.js --workers=1
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import base from './playwright.config.js';

if (!process.env.E2E_TRAIN_ROOT || !fs.existsSync(process.env.E2E_TRAIN_ROOT)) {
  process.env.E2E_TRAIN_ROOT = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-line-train-')));
}

export default {
  ...base,
  testDir: '.',
  testIgnore: [],
  testMatch: [/tests[\\/]line-train\.spec\.js$/],
  timeout: 90_000,
  webServer: [
    { ...base.webServer[0], env: { ...base.webServer[0].env, LINE_TRAIN_ROOT: process.env.E2E_TRAIN_ROOT } },
    base.webServer[1],
  ],
};
