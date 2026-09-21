import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { caption, clearCaption, card, pause } from './support.mjs';

// Episode 1: "From a ticket to a story" (docs/MEDIA.md, #444). A real run of the real Cockpit, real clicks only.
// The captions below ARE the script. The example is the sample shop's product listing (the `catalog` feature).
const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(HERE, '../../../../site/assets/video');
const SLUG = '01-ticket-to-story';
const WS = process.env.E2E_WORKSPACE_ROOT;
const SAMPLE = process.env.E2E_SAMPLE_SHOP || path.join(os.homedir(), 'workspace', 'shop');

export const CAPTIONS = {
  introTitle: 'From a ticket to a story',
  introSub: 'Turn a plain request into a plan you can trust',
  signIn: 'First, sign in. Only accounts the owner allowed get in. (This recording uses the demo login.)',
  gate: 'Nothing is open yet. Let us try the sample shop.',
  features: 'Here is the shop. Its product list lives in the "catalog" feature.',
  ticket: 'Now write the ticket, in plain words.',
  propose: 'Ask the Cockpit which parts of the shop it touches.',
  confirm: 'It makes a guess. You confirm it before anything uses it.',
  impact: 'Here is what the change reaches: files and features. Worked out from your code, no AI model.',
  steps: 'It also suggests a first step: read the catalog. Add more steps, or edit any of them.',
  plan: 'Nothing changes until you run the plan and approve the result.',
  pages: 'And the product page itself is one click away.',
  outroTitle: 'A ticket is now a story',
  outroSub: 'Next: run the plan and approve it, one file at a time.',
};

const TICKET_TITLE = 'Product list';
const TICKET_BODY = 'Show every product in the catalog as a list with its price and an Add to cart button.';

test('episode 1: from a ticket to a story', async ({ page }) => {
  fs.mkdirSync(OUT, { recursive: true });
  // A sample project the gate offers as "Try the sample shop": a copy of the shop in the (otherwise empty) workspace.
  fs.cpSync(SAMPLE, path.join(WS, 'shop'), { recursive: true, filter: (s) => !/[\\/](node_modules|\.next)([\\/]|$)/.test(s) });

  await page.goto('/');
  await expect(page.getByTestId('login-test-user')).toBeVisible();
  await card(page, CAPTIONS.introTitle, CAPTIONS.introSub);

  // 1. Sign in (the documented demo login).
  await caption(page, CAPTIONS.signIn);
  await pause(page, 4500);
  await page.getByTestId('login-test-user').click();

  // 2. The gate: nothing open; the sample shop is one click.
  await expect(page.getByRole('heading', { name: 'Open a project' })).toBeVisible();
  await caption(page, CAPTIONS.gate);
  await pause(page, 3000);
  await page.getByTestId('open-sample-shop').click();

  // 3. Features: the shop and its catalog.
  await expect(page.getByRole('navigation', { name: 'Screens', exact: true })).toBeVisible();
  await expect(page.locator('h1')).toHaveText('Features');
  await caption(page, CAPTIONS.features);
  await pause(page, 4500);

  // 4. The ticket, written in the Notes tab.
  await page.getByRole('complementary', { name: 'Browser' }).getByRole('tab', { name: 'Notes' }).click();
  await caption(page, CAPTIONS.ticket);
  await page.getByTestId('plan-ticket-title').pressSequentially(TICKET_TITLE, { delay: 90 });
  await page.getByTestId('plan-ticket-body').pressSequentially(TICKET_BODY, { delay: 60 });
  await pause(page, 1500);

  // 5. Which parts does it touch? A proposal, confirmed by the person.
  await caption(page, CAPTIONS.propose);
  await pause(page, 2500);
  await page.getByTestId('plan-propose').click();
  await expect(page.getByTestId('plan-proposal').first()).toBeVisible();
  await caption(page, CAPTIONS.confirm);
  await pause(page, 3000);
  const catalog = page.getByTestId('plan-proposal').filter({ hasText: 'catalog' }).first();
  await expect(catalog).toBeVisible();
  await catalog.getByTestId('plan-proposal-confirm').click();

  // 6. Impact.
  await page.getByTestId('plan-analyse').click();
  await expect(page.getByTestId('plan-impact')).toBeVisible();
  await caption(page, CAPTIONS.impact);
  await pause(page, 6000);

  // 7. The plan.
  await page.getByTestId('plan-add-suggested').click();
  await expect(page.getByTestId('plan-step').first()).toBeVisible();
  await caption(page, CAPTIONS.steps);
  await pause(page, 5000);
  await caption(page, CAPTIONS.plan);
  await pause(page, 4500);

  // 8. The product page.
  await page.getByRole('navigation', { name: 'Screens', exact: true }).getByRole('link', { name: 'Pages' }).click();
  await caption(page, CAPTIONS.pages);
  await pause(page, 4500);

  await card(page, CAPTIONS.outroTitle, CAPTIONS.outroSub, 6000);

  const video = page.video();
  await page.close();
  await video.saveAs(path.join(OUT, `${SLUG}.webm`));
  void clearCaption;
});
