// Renders every mock (dark + light) to docs/design/mocks/png/<name>--<theme>.png with Playwright.
// Usage: node docs/design/mocks/render.mjs [name-prefix]   (needs @playwright/test installed, e.g. in ui/e2e)
import { readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(resolve(here, '../../../ui/e2e/package.json'));
const { chromium } = require('@playwright/test');

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
for (const f of readdirSync(here).filter((n) => n.endsWith('.html') && n.startsWith(process.argv[2] || ''))) {
  for (const theme of ['dark', 'light']) {
    await page.goto(`${pathToFileURL(join(here, f)).href}?theme=${theme}`);
    await page.screenshot({ path: join(here, 'png', `${f.replace('.html', '')}--${theme}.png`) });
  }
}
await browser.close();
console.log('rendered');
