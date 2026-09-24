import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { gotoCockpit, setTheme } from './support/cockpit.js';
import { makeBrowseProject, openProject } from './support/browseProject.js';
import { runAxe, isBlocking, format } from './support/axe.js';
import { openNotesStore } from '../../server/src/notesStore.mjs';

// #642 (part of epic #616) -- the Requirement screen, end to end in a real browser against the real server and a real throwaway
// git project. Nothing is mocked: the sentence is read by the real deterministic blocks (parseRequirement, placeCard,
// planFromBlocks), and Approve hands the plan to the real Plan run route, which creates a real process.
// Ports (this spec's own): E2E_CLIENT_PORT=49450 E2E_SERVER_PORT=49451 E2E_DEVSERVER_PORT_BASE=49460.
const API = process.env.E2E_API_BASE || 'http://localhost:4000';
const STATE_DIR = process.env.E2E_STATE_DIR;
const BILLING = 'A logged-in user needs to see their current subscription plan and be able to click a button to manage their billing details safely via Stripe.';
const UNKNOWN_WORD = 'A customer wants to frobnicate the invoice list.';
const BILLING_FILES = [
  'features/subscription-plan/domain/SubscriptionPlan.tsx',
  'features/subscription-plan/services/SubscriptionPlan.tsx',
  'features/subscription-plan/controllers/SubscriptionPlanController.tsx',
  'features/subscription-plan/components/SubscriptionPlan.tsx',
  'features/subscription-plan/pages/SubscriptionPlanPage.tsx',
  'features/subscription-plan/hooks/useClickButton.tsx',
  'features/subscription-plan/services/ManageBillingDetails.tsx',
  'features/subscription-plan/workflows/ManageBillingDetails.tsx',
];

const stage = (page) => page.getByTestId('requirement-stage');
const read = async (page) => {
  await page.getByTestId('requirement-read').click();
  await expect(page.getByTestId('requirement-card')).toBeVisible();
};

test.describe.serial('Requirement: a sentence read back as card, placement and timeline, then approved (#642)', () => {
  let project;
  let restore;
  const store = () => openNotesStore(project.repo, { stateDir: STATE_DIR });

  test.beforeAll(async () => {
    project = makeBrowseProject('og642-req-');
    restore = await openProject(API, project.repo);
  });
  test.afterAll(async () => {
    await restore?.();
    project?.remove();
  });

  test('the billing sentence: 5 nouns, 3 verbs, 3 checks, four placements with their files, and the timeline in run order', async ({ page }) => {
    const calls = [];
    page.on('request', (r) => {
      const u = new URL(r.url());
      if (u.pathname.startsWith('/api/') && r.method() !== 'GET') calls.push(`${r.method()} ${u.pathname}`);
    });
    await gotoCockpit(page, '/requirement');
    // The rail marks Features (Requirement is part of it, next to Plan) and the Plan screen links here.
    await expect(page.getByRole('navigation', { name: 'Screens', exact: true }).getByRole('link', { name: 'Features' })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('heading', { name: 'Requirement', level: 1 })).toBeVisible();
    await expect(page.getByTestId('requirement-no-model')).toContainText('No model is used');
    await expect(page.getByTestId('requirement-read')).toBeDisabled();
    await expect(page.getByTestId('requirement-card')).toHaveCount(0);

    // Three examples, as buttons; one fills the box, then Read it.
    await expect(page.getByRole('group', { name: 'Example sentences' }).getByRole('button')).toHaveText(['Billing', 'Profile picture', 'Instant search']);
    await page.getByTestId('requirement-text').fill(BILLING);
    await read(page);

    // The card.
    await expect(page.getByTestId('requirement-counts')).toHaveText('5 nouns, 3 verbs, 3 checks');
    await expect(page.getByTestId('requirement-noun')).toHaveCount(5);
    await expect(page.getByTestId('requirement-verb')).toHaveCount(3);
    await expect(page.getByTestId('requirement-check')).toHaveCount(3);
    await expect(page.getByTestId('requirement-nouns')).toContainText('Outside service');
    await expect(page.getByTestId('requirement-nouns')).toContainText('Stripe');
    await expect(page.getByTestId('requirement-verbs')).toContainText('Interact');
    for (const name of ['auth-session-check', 'server-only-secret', 'validated-redirect']) await expect(page.getByTestId('requirement-checks')).toContainText(name);
    await expect(page.getByTestId('requirement-check').first()).toContainText('from “safely”');
    await expect(page.getByTestId('requirement-open')).toHaveCount(0);

    // The placement: four blocks, the three answers and why, and the files each will create.
    const blocks = page.getByTestId('requirement-block');
    await expect(blocks).toHaveCount(4);
    await expect(page.getByTestId('requirement-block-kind')).toHaveText(['Server read', 'Presentational', 'Client leaf', 'Mutation']);
    await expect(blocks.nth(3)).toContainText('Does it change data on the backend?');
    await expect(blocks.nth(3)).toContainText('Yes');
    await expect(blocks.nth(0).getByTestId('requirement-block-file')).toHaveCount(3);
    await expect(blocks.nth(0)).toContainText('features/subscription-plan/services/SubscriptionPlan.tsx');
    await expect(blocks.nth(3)).toContainText('features/subscription-plan/workflows/ManageBillingDetails.tsx');

    // The timeline, in the order the blocks run, one plain-English line each.
    const steps = page.getByTestId('timeline-step');
    await expect(steps).toHaveCount(6);
    expect(await steps.evaluateAll((els) => els.map((e) => e.getAttribute('data-kind')))).toEqual(['page-load', 'server-read', 'presentation', 'interaction', 'mutation', 'redirect']);
    await expect(steps.nth(0)).toContainText('The person opens the page "SubscriptionPlan".');
    await expect(steps.nth(1)).toContainText('The server fetches "see current subscription plan" before anything is shown');
    await expect(steps.nth(4)).toContainText('the secret stays on the server');
    await expect(steps.nth(5)).toContainText('only to an allow-listed address');

    // Reading writes nothing and starts nothing: only the read route was called (plus none of Plan's).
    expect(calls.filter((c) => !c.includes('/api/requirement/read'))).toEqual([]);
    expect(project.git('status', '--porcelain').trim()).toBe('');
    await expect(page.getByTestId('requirement-approve-plan')).toBeEnabled();
  });

  test('a word the rules do not know is a closed question; answering it redraws everything', async ({ page }) => {
    await gotoCockpit(page, '/requirement');
    await page.getByTestId('requirement-text').fill(UNKNOWN_WORD);
    await read(page);
    const open = page.getByTestId('requirement-open');
    await expect(open).toBeVisible();
    await expect(page.getByTestId('requirement-question')).toHaveCount(1);
    await expect(page.getByTestId('requirement-question')).toContainText('frobnicate');
    await expect(page.getByTestId('requirement-question').getByRole('button')).toHaveCount(5);
    // Nothing is placed and nothing can be approved until it is answered.
    await expect(page.getByTestId('requirement-placement')).toHaveCount(0);
    await expect(page.getByTestId('timeline-step')).toHaveCount(0);
    await expect(page.getByTestId('requirement-approve-plan')).toBeDisabled();
    await expect(page.getByTestId('requirement-approve-hint')).toHaveText('Answer 1 open question first.');

    await page.getByTestId('requirement-answer-interact').click();
    await expect(open).toHaveCount(0);
    await expect(page.getByTestId('requirement-block')).toHaveCount(1);
    await expect(page.getByTestId('requirement-block-kind')).toHaveText(['Client leaf']);
    await expect(page.getByTestId('timeline-step')).toHaveCount(2);
    await expect(page.getByTestId('requirement-verb')).toContainText('frobnicate');
    await expect(page.getByTestId('requirement-approve-plan')).toBeEnabled();

    // A placement question (a server check with no server block) is answered the same way.
    await page.getByTestId('requirement-text').fill('A user can click a button safely.');
    await read(page);
    await expect(page.getByTestId('requirement-question')).toContainText('Where does it run');
    await expect(page.getByTestId('requirement-approve-plan')).toBeDisabled();
    await page.getByTestId('requirement-answer-mutation').click();
    await expect(page.getByTestId('requirement-open')).toHaveCount(0);
    expect(await page.getByTestId('timeline-step').evaluateAll((els) => els.map((e) => e.getAttribute('data-kind')))).toEqual(['page-load', 'interaction', 'mutation', 'redirect']);
  });

  test('the three example buttons read at once; the Plan screen links here', async ({ page }) => {
    await gotoCockpit(page, '/requirement');
    await page.getByTestId('requirement-example-profile-picture').click();
    await expect(page.getByTestId('requirement-block-kind')).toHaveText(['Client leaf', 'Presentational', 'Mutation']);
    await page.getByTestId('requirement-example-instant-search').click();
    await expect(page.getByTestId('requirement-block-kind')).toHaveText(['Presentational', 'Client leaf']);
    await expect(page.getByTestId('requirement-checks')).toContainText('latency-budget');
    await page.getByTestId('requirement-example-billing').click();
    await expect(page.getByTestId('requirement-counts')).toHaveText('5 nouns, 3 verbs, 3 checks');
    await gotoCockpit(page, '/plan');
    await page.getByTestId('plan-requirement-link').getByRole('link', { name: 'Requirement' }).click();
    await expect(page).toHaveURL(/\/requirement$/);
  });

  test('Approve plan starts a real process through the Plan run route, with the files listed; nothing reaches the project', async ({ page, request }) => {
    const before = project.git('status', '--porcelain=v2', '--untracked-files=all');
    await gotoCockpit(page, '/requirement');
    await page.getByTestId('requirement-example-billing').click();
    await expect(page.getByTestId('requirement-approve-plan')).toBeEnabled();
    // The files the plan will create are listed before anything is approved.
    await page.getByTestId('requirement-files').locator('summary').click();
    await expect(page.getByTestId('requirement-file')).toHaveText(BILLING_FILES);

    const ran = page.waitForResponse((r) => r.url().endsWith('/api/plan/run') && r.request().method() === 'POST');
    await page.getByTestId('requirement-approve-plan').click();
    const res = await ran;
    expect(res.status()).toBe(200);
    const { processId } = await res.json();
    expect(processId).toBeTruthy();
    await expect(page.getByTestId('requirement-started')).toContainText(processId);
    await expect(page.getByTestId('requirement-approve-plan')).toBeDisabled();

    // The process is in the drawer, the real record has the plan's nine steps (the feature, then the eight units).
    const drawer = page.getByRole('region', { name: 'Drawer' });
    await expect(drawer.getByRole('tab', { name: /Processes/ })).toHaveAttribute('aria-selected', 'true');
    await expect(drawer.getByTestId('process-row').filter({ hasText: 'Requirement: A logged-in user needs to see' })).toHaveCount(1);
    const detail = await (await request.get(`${API}/api/processes/${processId}`)).json();
    expect(detail.ok).toBe(true);
    expect(detail.process.steps.map((s) => s.flow)).toEqual(['create.feature', ...Array(8).fill('create.unit')]);
    expect(detail.process.steps.map((s) => s.title)).toContain('Create workflow ManageBillingDetails');
    // The bot works in its own worktree; the project tree is untouched until a person approves each file.
    expect(project.git('status', '--porcelain=v2', '--untracked-files=all')).toEqual(before);
    for (const f of BILLING_FILES) expect(fs.existsSync(path.join(project.repo, f)), f).toBe(false);
  });

  test('Save as note keeps the card and the plan as a durable note', async ({ page }) => {
    await gotoCockpit(page, '/requirement');
    await page.getByTestId('requirement-example-instant-search').click();
    await expect(page.getByTestId('requirement-save-note')).toBeEnabled();
    await page.getByTestId('requirement-save-note').click();
    await expect(page.getByTestId('requirement-note-saved')).toBeVisible();
    const note = store().list().notes.find((n) => n.title.startsWith('A customer wants to search products'));
    expect(note).toBeTruthy();
    const full = store().get(note.id);
    expect(full.body).toContain('"search" shows "products".');
    expect(full.body).toContain('Placement:');
    expect(full.plan.steps.map((s) => s.flow)[0]).toBe('create.feature');
    expect(project.git('status', '--porcelain').trim()).toBe('');
  });

  test('a read that fails says so and keeps the sentence', async ({ page }) => {
    await gotoCockpit(page, '/requirement');
    await page.route('**/api/requirement/read', (route) => route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'Write the requirement first.' }) }));
    await page.getByTestId('requirement-text').fill('anything');
    await page.getByTestId('requirement-read').click();
    await expect(page.getByTestId('requirement-error')).toHaveText('Write the requirement first.');
    await expect(page.getByTestId('requirement-text')).toHaveValue('anything');
  });

  for (const theme of ['dark', 'light']) {
    for (const [vp, size] of [['wide', { width: 1280, height: 900 }], ['phone-390', { width: 390, height: 844 }]]) {
      test(`accessibility and layout: ${theme} ${vp}, the billing sentence read, then an open question`, async ({ page }) => {
        await page.addInitScript((t) => localStorage.setItem('construct.theme', t), theme);
        await page.setViewportSize(size);
        await gotoCockpit(page, '/requirement');
        await page.getByTestId('requirement-example-billing').click();
        await expect(page.getByTestId('timeline-step')).toHaveCount(6);
        const found = await runAxe(page);
        expect(found.filter(isBlocking), format(found.filter(isBlocking))).toEqual([]);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        expect(await stage(page).evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
        await page.getByTestId('requirement-text').fill(UNKNOWN_WORD);
        await page.getByTestId('requirement-read').click();
        await expect(page.getByTestId('requirement-open')).toBeVisible();
        const open = await runAxe(page);
        expect(open.filter(isBlocking), format(open.filter(isBlocking))).toEqual([]);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      });
    }
  }

  test('the theme switch in the profile menu restyles the screen without losing the result', async ({ page }) => {
    await gotoCockpit(page, '/requirement');
    await page.getByTestId('requirement-example-billing').click();
    await expect(page.getByTestId('timeline-step')).toHaveCount(6);
    await setTheme(page, 'light');
    await expect(page.getByTestId('timeline-step')).toHaveCount(6);
    await setTheme(page, 'dark');
  });
});
