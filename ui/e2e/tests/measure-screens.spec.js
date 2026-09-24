import { test } from '@playwright/test';
import fs from 'node:fs';

// #391 item 0: count what is actually visible on each Cockpit screen (buttons, fields, badges, hint paragraphs,
// prose words), so a declutter change can be compared before and after. A measuring tool, not a regression test:
// it only runs when MEASURE_SCREENS=1, and writes the table to MEASURE_OUT (a JSON path) when that is set.
//
//   MEASURE_SCREENS=1 MEASURE_OUT=/tmp/after.json E2E_CLIENT_PORT=3300 E2E_SERVER_PORT=4300 \
//     packages/tools/dev/heavy.sh npx playwright test --workers=1 measure-screens
//
// "Visible" is Element.checkVisibility(): display:none, visibility:hidden and the closed content of a
// <details> do not count; a control inside a collapsed section is therefore not counted until it is opened.
// The shell (top bar, left column, right panel, status bar) is counted once per screen, under "shell".

const SCREENS = ['/dashboard', '/settings', '/help', '/plan', '/notes', '/wizard', '/tests', '/review', '/pages', '/workflows', '/components', '/ollama'];

const COUNT = () => {
  const visible = (el) => el.checkVisibility({ checkOpacity: false, checkVisibilityCSS: true });
  const all = (sel, root) => [...(root || document).querySelectorAll(sel)].filter(visible);
  const words = (root) => (root ? root.innerText.split(/\s+/).filter(Boolean).length : 0);
  const region = (root) => ({
    buttons: all('button, [role="button"], summary', root).length,
    fields: all('input:not([type="hidden"]), select, textarea, [role="combobox"], [role="textbox"]', root).length,
    badges: all('[class*="badge"], [class*="pill"], [class*="chip"]', root).length,
    hints: all('.hint, [class*="-hint"], [class*="lede"], .field-hint, .help-section p', root).length,
    words: words(root),
  });
  const main = document.querySelector('main') || document.body;
  const shell = { buttons: 0, fields: 0, badges: 0, hints: 0, words: 0 };
  for (const root of ['header', 'nav', 'aside', 'footer', '[role="status"]']) {
    for (const el of document.querySelectorAll(root)) {
      if (main.contains(el) || !visible(el)) continue;
      const r = region(el);
      for (const k of Object.keys(shell)) shell[k] += r[k];
    }
  }
  return { screen: region(main), shell };
};

test.describe('Measure screens (#391)', () => {
  test.skip(!process.env.MEASURE_SCREENS, 'set MEASURE_SCREENS=1 to measure');

  test('count visible controls per screen', async ({ page }) => {
    test.setTimeout(240_000);
    const out = {};
    for (const route of SCREENS) {
      await page.goto(route);
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(600);
      out[route] = await page.evaluate(COUNT);
    }
    const lines = ['screen | buttons | fields | badges | hints | words | (shell b/f/badge/hint)'];
    for (const [route, v] of Object.entries(out)) {
      const s = v.screen;
      const sh = v.shell;
      lines.push(`${route} | ${s.buttons} | ${s.fields} | ${s.badges} | ${s.hints} | ${s.words} | (${sh.buttons}/${sh.fields}/${sh.badges}/${sh.hints})`);
    }
    console.log(lines.join('\n'));
    if (process.env.MEASURE_OUT) fs.writeFileSync(process.env.MEASURE_OUT, JSON.stringify(out, null, 2));
  });
});
