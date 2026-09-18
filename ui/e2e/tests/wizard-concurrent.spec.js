import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOTS_DIR = path.resolve(__dirname, '../screenshots');
fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });

const API_BASE = process.env.E2E_API_BASE || 'http://localhost:4000';

async function answerNextQuestion(page, text) {
  const input = page.locator('.chat-input input');
  await expect(input).toBeVisible({ timeout: 15000 });
  if (text) await input.fill(text);
  await page.getByRole('button', { name: 'Send' }).click();
}

// #80 — the wizard's console-capture (src/cli.mjs's
// runImportRouteWizardEventDriven) used to monkey-patch process-global
// console.log/warn/error per session, which corrupted (not just serialized)
// a second concurrent session's captured output, and ui/server/src/
// wizardSocket.mjs worked around it by flatly rejecting a second concurrent
// `start`. Both are fixed: log capture is now scoped per session via
// AsyncLocalStorage, and the socket no longer rejects a second connection.
// This test proves it end to end, in the real rendered UI: two independent
// browser contexts each run their own wizard session, interleaved (not
// sequential — each turn of session A is answered, then the corresponding
// turn of session B, back and forth) all the way to completion, and each
// transcript must only ever contain its own feature/route, never the
// other's.
test.describe('Wizard: two concurrent sessions do not cross-talk (#80)', () => {
  let tmpProjectDir;

  test.beforeAll(async ({ request }) => {
    tmpProjectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-ui-e2e-wizard-concurrent-'));
    const settingsRes = await request.post(`${API_BASE}/api/settings`, { data: { projectDir: tmpProjectDir } });
    expect(settingsRes.ok()).toBeTruthy();
    const initRes = await request.post(`${API_BASE}/api/init`);
    expect(initRes.ok()).toBeTruthy();
  });

  test.afterAll(() => {
    fs.rmSync(tmpProjectDir, { recursive: true, force: true });
  });

  test('session A and session B each capture only their own transcript', async ({ browser }) => {
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    try {
      await pageA.goto('/wizard');
      await pageB.goto('/wizard');
      await expect(pageA.locator('h1')).toHaveText('Import Route Wizard');
      await expect(pageB.locator('h1')).toHaveText('Import Route Wizard');

      // Distinct, unmistakable seed routes/feature names per session so
      // any cross-talk is trivially detectable in either transcript.
      await pageA.getByPlaceholder('/v2/home').fill('/definitely-not-real-concurrent-A');
      await pageB.getByPlaceholder('/v2/home').fill('/definitely-not-real-concurrent-B');

      // Start both sessions before finishing either — genuinely
      // interleaved, not one-then-the-other.
      await pageA.getByRole('button', { name: 'Start wizard session' }).click();
      await pageB.getByRole('button', { name: 'Start wizard session' }).click();

      // Turn 1: destination feature name, answered alternately.
      await expect(pageA.locator('.chat-question').last()).toContainText('Destination feature');
      await answerNextQuestion(pageA, 'concurrent-wizard-feature-a');
      await expect(pageB.locator('.chat-question').last()).toContainText('Destination feature');
      await answerNextQuestion(pageB, 'concurrent-wizard-feature-b');

      // Turn 2: seedRoute pre-fills routeArgs -> "Another route to include".
      await expect(pageA.locator('.chat-question').last()).toContainText('Another route to include');
      await answerNextQuestion(pageA, '');
      await expect(pageB.locator('.chat-question').last()).toContainText('Another route to include');
      await answerNextQuestion(pageB, '');

      // Turn 3: LLM-fill y/N.
      await expect(pageA.locator('.chat-question').last()).toContainText('LLM also write the ported logic');
      await answerNextQuestion(pageA, 'n');
      await expect(pageB.locator('.chat-question').last()).toContainText('LLM also write the ported logic');
      await answerNextQuestion(pageB, 'n');

      // Turn 4: Next.js app/ directory (seed route isn't an existing dir).
      await expect(pageA.locator('.chat-question').last()).toContainText('Next.js app');
      await answerNextQuestion(pageA, 'definitely-not-a-real-app-dir-A');
      await expect(pageB.locator('.chat-question').last()).toContainText('Next.js app');
      await answerNextQuestion(pageB, 'definitely-not-a-real-app-dir-B');

      // Both end in a real, unmocked resolution error — never reaching the
      // claude CLI call.
      await expect(pageA.locator('.chat-error')).toBeVisible({ timeout: 15_000 });
      await expect(pageB.locator('.chat-error')).toBeVisible({ timeout: 15_000 });
      await expect(pageA.locator('.chat-system').last()).toContainText('Session finished', { timeout: 15_000 });
      await expect(pageB.locator('.chat-system').last()).toContainText('Session finished', { timeout: 15_000 });

      const transcriptA = await pageA.locator('.chat').innerText();
      const transcriptB = await pageB.locator('.chat').innerText();

      // Each transcript shows its own session's content...
      expect(transcriptA).toContain('concurrent-wizard-feature-a');
      expect(transcriptA).toContain('definitely-not-real-concurrent-A');
      expect(transcriptB).toContain('concurrent-wizard-feature-b');
      expect(transcriptB).toContain('definitely-not-real-concurrent-B');

      // ...and never the other session's — the actual regression this
      // issue fixes.
      expect(transcriptA).not.toContain('concurrent-wizard-feature-b');
      expect(transcriptA).not.toContain('definitely-not-real-concurrent-B');
      expect(transcriptB).not.toContain('concurrent-wizard-feature-a');
      expect(transcriptB).not.toContain('definitely-not-real-concurrent-A');

      for (const p of [pageA, pageB]) {
        await p.locator('.chat').evaluate((el) => {
          el.scrollTop = el.scrollHeight;
        });
      }
      await pageA.screenshot({ path: path.join(SCREENSHOTS_DIR, 'wizard-concurrent-session-a.png'), fullPage: true });
      await pageB.screenshot({ path: path.join(SCREENSHOTS_DIR, 'wizard-concurrent-session-b.png'), fullPage: true });
    } finally {
      await contextA.close();
      await contextB.close();
    }
  });
});
