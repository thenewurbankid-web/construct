import { test, expect } from '@playwright/test';
import { gotoCockpit } from './support/cockpit.js';

// #592: the Review branch list is a discriminated union (idle | loading | error | ready). A poll that fails
// stops the polling, and the screen must say so: it used to keep the last rows on screen still marked
// "Analysing" forever, because the failed read left the stale rows in the state. Here the server answers
// through a route stub (the seam is the HTTP boundary; the client machine, hook, controller and page are real).
const row = (state) => ({
  name: 'feat/one',
  sha: 'abc1234',
  subject: 'One change',
  author: 'E2E',
  date: '2026-09-24',
  current: false,
  ahead: 1,
  analysis: { state },
});
const list = (state) => ({ ok: true, source: { id: 'local', label: 'Local branches' }, base: 'main', baseSha: 'def5678', current: 'main', refs: ['main', 'feat/one'], branches: [row(state)] });

test.describe('Review list: a failed poll (#592)', () => {
  test('a poll that fails after a running read shows the failure, not a stale "Analysing" row, and Try again recovers', async ({ page }) => {
    let mode = 'running-then-fail';
    let reads = 0;
    await page.route('**/api/review/analyze', (route) => route.fulfill({ json: { ok: true } }));
    await page.route('**/api/review/branches*', (route) => {
      reads += 1;
      if (mode === 'recovered') return route.fulfill({ json: list('cancelled') });
      // First read: the row is running, so the list schedules another read. Every later read fails.
      if (reads === 1) return route.fulfill({ json: list('running') });
      return route.fulfill({ status: 500, json: { ok: false, error: 'The engine stopped answering.', code: 'WORKER_FAILED' } });
    });

    await gotoCockpit(page, '/review');
    // The stale rows are gone and the failure says what happened; nothing claims to still be analysing.
    await expect(page.getByTestId('review-error')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('review-error')).toContainText('The engine stopped answering.');
    await expect(page.getByTestId('review-analysing')).toHaveCount(0);
    await expect(page.getByTestId('review-row')).toHaveCount(0);

    // The polling really stopped on the error: no further read arrives while the failure is shown.
    const seen = reads;
    await page.waitForTimeout(2500);
    expect(reads, 'no read after the failure').toBe(seen);

    // Try again re-reads; the list comes back.
    mode = 'recovered';
    await page.getByTestId('review-error').getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByTestId('review-row')).toHaveCount(1);
    await expect(page.getByTestId('review-error')).toHaveCount(0);
    await expect(page.getByTestId('review-analysing')).toHaveCount(0);
  });

  test('a first read that fails shows the failure, and the order switch still works once it is retried', async ({ page }) => {
    let fail = true;
    await page.route('**/api/review/analyze', (route) => route.fulfill({ json: { ok: true } }));
    await page.route('**/api/review/branches*', (route) => (fail
      ? route.fulfill({ status: 500, json: { ok: false, error: 'Nope.', code: 'NOT_A_GIT_REPO' } })
      : route.fulfill({ json: list('cancelled') })));

    await gotoCockpit(page, '/review');
    await expect(page.getByTestId('review-error')).toContainText('not a git repository');
    await expect(page.getByTestId('review-loading')).toHaveCount(0);

    fail = false;
    await page.getByTestId('review-error').getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByTestId('review-row')).toHaveCount(1);
    // The order lives beside the machine: switching it keeps the rows.
    await page.getByRole('button', { name: 'Newest' }).click();
    await expect(page.getByTestId('review-order-note')).toContainText('Newest first');
    await expect(page.getByTestId('review-row')).toHaveCount(1);
  });
});
