// #306 -- can Playwright launch Chromium on this machine? A read-only look at the browsers cache, so the Tests tab can
// say "Browsers are not installed" with the command BEFORE anything runs. Takes no client input: the only paths read
// come from the server's own environment. When it cannot tell (a custom PLAYWRIGHT_BROWSERS_PATH=0 layout), it says
// 'installed': it never claims a problem it did not see.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CHROMIUM = /^chromium(_headless_shell)?-\d+/;

function cacheDir(env, home, platform) {
  const custom = env.PLAYWRIGHT_BROWSERS_PATH;
  if (custom === '0') return null;
  if (custom) return path.resolve(custom);
  if (platform === 'win32') return env.LOCALAPPDATA ? path.join(env.LOCALAPPDATA, 'ms-playwright') : null;
  return path.join(home, platform === 'darwin' ? path.join('Library', 'Caches') : '.cache', 'ms-playwright');
}

/** -> { browsers: 'installed' | 'missing' } */
export function environmentState({ env = process.env, home = os.homedir(), platform = process.platform } = {}) {
  const dir = cacheDir(env, home, platform);
  if (!dir) return { browsers: 'installed' };
  try {
    return { browsers: fs.readdirSync(dir).some((n) => CHROMIUM.test(n)) ? 'installed' : 'missing' };
  } catch {
    return { browsers: 'missing' };
  }
}
