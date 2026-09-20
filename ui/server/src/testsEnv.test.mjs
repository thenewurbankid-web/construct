// #306 -- the browsers check reads only the server's own environment and never claims a problem it did not see.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeTempDir } from '../../../test-utils/tmpdir.mjs';
import { environmentState } from './testsEnv.mjs';

test('missing when the cache is absent or has no chromium; installed when it does', () => {
  const home = makeTempDir('construct-testsenv-');
  assert.deepEqual(environmentState({ env: {}, home, platform: 'linux' }), { browsers: 'missing' });
  const cache = path.join(home, '.cache', 'ms-playwright');
  fs.mkdirSync(path.join(cache, 'firefox-1234'), { recursive: true });
  assert.equal(environmentState({ env: {}, home, platform: 'linux' }).browsers, 'missing');
  fs.mkdirSync(path.join(cache, 'chromium_headless_shell-1200'));
  assert.equal(environmentState({ env: {}, home, platform: 'linux' }).browsers, 'installed');
});

test('a custom path is honoured, and PLAYWRIGHT_BROWSERS_PATH=0 makes no claim', () => {
  const dir = makeTempDir('construct-testsenv-');
  fs.mkdirSync(path.join(dir, 'chromium-1100'));
  assert.equal(environmentState({ env: { PLAYWRIGHT_BROWSERS_PATH: dir }, home: '/nonexistent', platform: 'linux' }).browsers, 'installed');
  assert.equal(environmentState({ env: { PLAYWRIGHT_BROWSERS_PATH: path.join(dir, 'nope') }, home: dir, platform: 'linux' }).browsers, 'missing');
  assert.equal(environmentState({ env: { PLAYWRIGHT_BROWSERS_PATH: '0' }, home: '/nonexistent', platform: 'linux' }).browsers, 'installed');
});
