import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOTS_DIR = path.resolve(__dirname, '../screenshots');
fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });

// #154/#155/#156/#157: the Help page's Tutorials section embeds real local
// screenshots (ui/client/public/tutorials/**), never hotlinked to GitHub.
// This test drives the actual rendered page and confirms both that the
// section (and all three tutorials) render, and that every <img> it embeds
// actually loaded a real image — not a broken link — by checking
// naturalWidth is nonzero after load, the same signal a human would use
// ("did the picture actually show up").
const EXPECTED_IMAGE_PATHS = [
  '/tutorials/route-import/route-import-146-ui-1-plan-proposed.png',
  '/tutorials/route-import/route-import-146-ui-2-approved-and-scaffolded.png',
  '/tutorials/route-import/route-import-147-ui-1-scaffold-and-ollama-fill.png',
  '/tutorials/setup-settings/149-1-gate-not-initialized.png',
  '/tutorials/setup-settings/149-2-gate-initialized-dashboard.png',
  '/tutorials/setup-settings/150-1-settings-initial.png',
  '/tutorials/setup-settings/150-2-settings-project-dir-switched.png',
  '/tutorials/setup-settings/150-3-settings-ollama-selected.png',
  '/tutorials/setup-settings/150-4-settings-plananalysis-ollama-rejected.png',
  '/tutorials/listing-details/listing-details-1-ui-create-feature.png',
  '/tutorials/listing-details/listing-details-2-ui-create-listing-slice.png',
  '/tutorials/listing-details/listing-details-3-ui-browse-pages.png',
  '/tutorials/listing-details/listing-details-4-ui-llm-option-on-create.png',
  '/tutorials/listing-details/listing-details-5-ui-research-openapi-service.png',
];

test.describe('Help page — Tutorials section (#154)', () => {
  test('Tutorials section renders all three tutorials with real, loaded local screenshots', async ({ page }) => {
    const consoleErrors = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await page.goto('/help');
    await expect(page.locator('h1')).toHaveText('Help');

    // Nav entry present and links to the section, matching the existing
    // #getting-started/#attribution/#ui-guide/#cli-reference pattern.
    // #391: the link row under the title is gone (the Browser's Contents tab is the one list) and every
    // section but Getting started starts collapsed, so the Contents link both jumps to and opens Tutorials.
    await expect(page.locator('.help-contents')).toHaveCount(0);
    const tutorials = page.locator('#tutorials');
    await expect(tutorials).not.toHaveAttribute('open', '');
    const browser = page.getByRole('complementary', { name: 'Browser' });
    await browser.getByRole('tab', { name: 'Contents' }).click();
    await browser.getByRole('link', { name: 'Tutorials' }).click();
    await expect(tutorials).toHaveAttribute('open', '');
    await expect(tutorials).toBeVisible();
    await expect(tutorials).toContainText('Guided route import');
    await expect(tutorials).toContainText('New user setup and settings');
    await expect(tutorials).toContainText('Auto code generation and LLM-assisted implementation');

    // The planAnalysis guardrail is a real, verifiable safety behaviour —
    // confirm the tutorial actually mentions it, not just generic filler.
    await expect(tutorials).toContainText('planAnalysis');

    const images = tutorials.locator('img.tutorial-screenshot');
    await expect(images).toHaveCount(EXPECTED_IMAGE_PATHS.length);

    for (let i = 0; i < EXPECTED_IMAGE_PATHS.length; i++) {
      const img = images.nth(i);
      await img.scrollIntoViewIfNeeded();
      const src = await img.getAttribute('src');
      expect(src).toBe(EXPECTED_IMAGE_PATHS[i]);

      // Confirm the browser actually decoded a real image for this <img> —
      // naturalWidth stays 0 for a broken/missing image even once "loaded".
      const naturalWidth = await img.evaluate((el) => {
        if (el.complete) return el.naturalWidth;
        return new Promise((resolve) => {
          el.addEventListener('load', () => resolve(el.naturalWidth), { once: true });
          el.addEventListener('error', () => resolve(0), { once: true });
        });
      });
      expect(naturalWidth, `image did not load: ${src}`).toBeGreaterThan(0);

      // Independently confirm the asset itself is served with a real 200,
      // not just that some cached/placeholder bitmap rendered.
      const response = await page.request.get(src);
      expect(response.status(), `unexpected status for ${src}`).toBe(200);
    }

    // A legible, viewport-sized shot of the nav + top of the Tutorials
    // section (for the GitHub issue) in addition to the full-page one
    // (for completeness) — a 22k-pixel-tall full-page capture alone isn't
    // readable evidence on its own.
    await tutorials.locator('h2').scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'help-tutorials-section.png') });

    // A second, further-scrolled shot showing an actual embedded
    // screenshot rendered inline (stronger evidence than the heading
    // alone that these are real images, not broken links).
    await images.first().scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'help-tutorials-image.png') });

    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'help-tutorials.png'), fullPage: true });

    expect(consoleErrors, `console errors: ${consoleErrors.join('\n')}`).toEqual([]);
  });
});
