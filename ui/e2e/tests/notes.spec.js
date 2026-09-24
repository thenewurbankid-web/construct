import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { gotoCockpit } from './support/cockpit.js';
import { makeBrowseProject, openProject } from './support/browseProject.js';
import { runAxe, isBlocking, format } from './support/axe.js';
import { openNotesStore } from '../../server/src/notesStore.mjs';

// #596 (part of #373 / #561) -- durable Notes, end to end in a real browser against the real server and a real
// throwaway git project. Nothing is mocked except one thing on purpose: a disk-full answer to a save (there is no
// honest way to fill the disk from a spec). The rest is the real thing: the note is a file in the per-user state
// directory, a reload reads it back, and the "other tab" is a second real page saving the same note.
const API = process.env.E2E_API_BASE || 'http://localhost:4000';
const STATE_DIR = process.env.E2E_STATE_DIR;
const browser = (page) => page.getByRole('complementary', { name: 'Browser' });
const indicator = (page) => page.getByTestId('note-save-indicator');
const rows = (page) => browser(page).getByTestId('notes-row');
const saved = (page) => expect(indicator(page)).toContainText(/Saved on this machine/);

test.describe.serial('Notes: durable, autosaved drafts (#596)', () => {
  let project;
  let restore;
  const store = () => openNotesStore(project.repo, { stateDir: STATE_DIR });

  test.beforeAll(async () => {
    project = makeBrowseProject('og596-notes-');
    restore = await openProject(API, project.repo);
  });
  test.afterAll(async () => {
    await restore?.();
    project?.remove();
  });

  test('no notes yet: a designed empty state with New note; the rail marks Features', async ({ page }) => {
    await gotoCockpit(page, '/notes');
    await expect(page.getByRole('navigation', { name: 'Screens', exact: true }).getByRole('link', { name: 'Features' })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByTestId('notes-stage')).toContainText('No notes yet');
    await expect(browser(page).getByTestId('notes-list-empty')).toBeVisible();
    await expect(page.getByTestId('note-editor')).toHaveCount(0);
  });

  test('New note, type, and it autosaves ("Saved on this machine"); a reload keeps it and reopens the same note', async ({ page }) => {
    await gotoCockpit(page, '/notes');
    await page.getByTestId('note-new').click();
    await expect(page.getByTestId('note-editor')).toBeVisible();
    await expect(page.getByTestId('note-status')).toHaveText('Draft');
    await page.getByTestId('note-title').fill('Add a login screen');
    await page.getByTestId('note-body').fill('Users sign in with GitHub.\nShow their avatar in the top bar.');
    await expect(indicator(page)).toHaveText(/Unsaved changes|Saving/);
    await saved(page);
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page).first()).toContainText('Add a login screen');
    await expect(page).toHaveURL(/\/notes\?note=[0-9a-f-]+$/);

    // On disk in the state directory, keyed by project; never inside the project.
    const [{ id, title, body, rev }] = store().list().notes;
    expect(title).toBe('Add a login screen');
    expect(body).toContain('avatar');
    expect(rev).toBeGreaterThan(1);
    expect(fs.existsSync(path.join(project.repo, 'notes'))).toBe(false);
    expect(project.git('status', '--porcelain').trim()).toBe('');

    await page.reload();
    await expect(page.getByTestId('note-title')).toHaveValue('Add a login screen');
    await expect(page.getByTestId('note-body')).toHaveValue('Users sign in with GitHub.\nShow their avatar in the top bar.');
    await expect(indicator(page)).toContainText(/Saved on this machine/);
    await expect(page).toHaveURL(new RegExp(`note=${id}$`));

    // A fresh visit with no address lands on the most recent note.
    await gotoCockpit(page, '/notes');
    await expect(page.getByTestId('note-title')).toHaveValue('Add a login screen');
  });

  test('editing again after a reload saves against the stored rev; blur saves at once; no model is called', async ({ page }) => {
    // The shell's own status pill polls /api/ollama/status (is it up?); that is not a model call. Saving must
    // send only /api/notes writes, and nothing that generates.
    const writes = [];
    page.on('request', (r) => { if (r.url().includes('/api/') && r.method() !== 'GET' && r.method() !== 'OPTIONS') writes.push(`${r.method()} ${new URL(r.url()).pathname.replace(/[0-9a-f-]{36}/, ':id')}`); });
    await gotoCockpit(page, '/notes');
    await page.getByTestId('note-body').fill('Users sign in with GitHub.\nShow their avatar in the top bar.\nRemember them for a week.');
    await page.getByTestId('note-title').focus(); // moving focus flushes the save; no waiting for the pause
    await saved(page);
    expect(store().list().notes[0].body).toContain('for a week');
    expect(writes.length).toBeGreaterThan(0);
    expect(writes.every((w) => w === 'PUT /api/notes/:id')).toBe(true);
  });

  test('a second note: the list is per project and switching notes never loses text', async ({ page }) => {
    await gotoCockpit(page, '/notes');
    await page.getByTestId('note-new').click();
    await page.getByTestId('note-title').fill('Fix the totals');
    await page.getByTestId('note-body').fill('Discounts are applied twice.');
    // Switch away straight away: the pending text is saved first, then the other note opens.
    await rows(page).filter({ hasText: 'Add a login screen' }).click();
    await expect(page.getByTestId('note-title')).toHaveValue('Add a login screen');
    await expect(rows(page)).toHaveCount(2);
    await rows(page).filter({ hasText: 'Fix the totals' }).click();
    await expect(page.getByTestId('note-body')).toHaveValue('Discounts are applied twice.');
    expect(store().list().notes.map((n) => n.title).sort()).toEqual(['Add a login screen', 'Fix the totals']);
  });

  test('a stale write (another tab saved first) shows the conflict; Compare shows both copies; Keep mine wins', async ({ page, context }) => {
    await gotoCockpit(page, '/notes');
    await rows(page).filter({ hasText: 'Add a login screen' }).click();
    await expect(page.getByTestId('note-title')).toHaveValue('Add a login screen');
    await saved(page);

    // The other tab: the same note, saved first.
    const other = await context.newPage();
    await gotoCockpit(other, `/notes?note=${store().list().notes.find((n) => n.title === 'Add a login screen').id}`);
    await expect(other.getByTestId('note-title')).toHaveValue('Add a login screen');
    await other.getByTestId('note-body').fill('Users sign in with GitHub.\nTHEIRS: also offer email links.');
    await expect(other.getByTestId('note-save-indicator')).toContainText(/Saved on this machine/);

    await page.getByTestId('note-body').fill('Users sign in with GitHub.\nMINE: also offer passkeys.');
    const conflict = page.getByTestId('note-conflict');
    await expect(conflict).toBeVisible({ timeout: 10_000 });
    await expect(conflict).toContainText('This note changed in another tab');
    await expect(indicator(page)).toContainText('This note changed in another tab');
    await expect(page.getByTestId('note-keep-mine')).toBeVisible();
    await expect(page.getByTestId('note-load-theirs')).toBeVisible();
    // Nothing was overwritten: the disk still holds THEIR copy, my text is still in the page.
    expect(store().list().notes.find((n) => n.title === 'Add a login screen').body).toContain('THEIRS');
    await expect(page.getByTestId('note-body')).toHaveValue(/MINE/);

    await page.getByTestId('note-compare').click();
    const panel = page.getByTestId('note-compare-panel');
    await expect(panel.locator('[data-kind="mine"]')).toContainText('MINE: also offer passkeys.');
    await expect(panel.locator('[data-kind="theirs"]')).toContainText('THEIRS: also offer email links.');
    await expect(panel.locator('[data-kind="same"]').first()).toContainText('Users sign in with GitHub.');
    const blocking = (await runAxe(page)).filter(isBlocking);
    expect(blocking, format(blocking)).toEqual([]);

    await page.getByTestId('note-keep-mine').click();
    await expect(conflict).toHaveCount(0);
    await saved(page);
    expect(store().list().notes.find((n) => n.title === 'Add a login screen').body).toContain('MINE');
    await other.close();
  });

  test('a stale write, then Load theirs: their text replaces mine and nothing of mine is written', async ({ page, context }) => {
    await gotoCockpit(page, '/notes');
    await rows(page).filter({ hasText: 'Add a login screen' }).click();
    await saved(page);
    const id = store().list().notes.find((n) => n.title === 'Add a login screen').id;
    const other = await context.newPage();
    await gotoCockpit(other, `/notes?note=${id}`);
    await other.getByTestId('note-title').fill('Add a login screen (v2)');
    await expect(other.getByTestId('note-save-indicator')).toContainText(/Saved on this machine/);

    await page.getByTestId('note-body').fill('A change that loses.');
    await expect(page.getByTestId('note-conflict')).toBeVisible({ timeout: 10_000 });
    await page.getByTestId('note-load-theirs').click();
    await expect(page.getByTestId('note-conflict')).toHaveCount(0);
    await expect(page.getByTestId('note-title')).toHaveValue('Add a login screen (v2)');
    await expect(page.getByTestId('note-body')).toHaveValue(/MINE: also offer passkeys/);
    await saved(page);
    expect(store().get(id).body).not.toContain('A change that loses');
    await other.close();
  });

  test('a failed save keeps the text in the page with Retry; Retry saves once the disk allows it', async ({ page }) => {
    await gotoCockpit(page, '/notes');
    await rows(page).filter({ hasText: 'Fix the totals' }).click();
    await saved(page);
    let failing = true;
    await page.route(/\/api\/notes\/[^/]+$/, async (route) => {
      if (failing && route.request().method() === 'PUT') return route.fulfill({ status: 507, contentType: 'application/json', headers: { 'access-control-allow-origin': `http://localhost:${process.env.E2E_CLIENT_PORT || 3000}`, 'access-control-allow-credentials': 'true' }, body: JSON.stringify({ ok: false, code: 'DISK_FULL', error: 'The disk is full, so the note could not be saved.' }) });
      return route.fallback();
    });
    await page.getByTestId('note-body').fill('Discounts are applied twice. Reproduce with a 10% code.');
    await expect(indicator(page)).toContainText('Not saved · disk full', { timeout: 10_000 });
    await expect(page.getByTestId('note-failed')).toContainText('Your text stays in the page');
    await expect(page.getByTestId('note-body')).toHaveValue(/10% code/);
    expect(store().list().notes.find((n) => n.title === 'Fix the totals').body).not.toContain('10% code');
    // It does not hammer the server in a loop: the failure waits for a person.
    await page.waitForTimeout(1500);
    await expect(indicator(page)).toContainText('Not saved');
    failing = false;
    await page.getByTestId('note-retry').click();
    await saved(page);
    await expect(page.getByTestId('note-failed')).toHaveCount(0);
    expect(store().list().notes.find((n) => n.title === 'Fix the totals').body).toContain('10% code');
  });

  test('a note with a plan: editing the text marks the plan Out of date; a ran note is read-only and duplicates to iterate', async ({ page }) => {
    const target = store().list().notes.find((n) => n.title === 'Fix the totals');
    store().update(target.id, { rev: target.rev, plan: { version: 1, steps: [{ id: 's1' }] }, status: 'plan-ready' });
    await gotoCockpit(page, `/notes?note=${target.id}`);
    await expect(page.getByTestId('note-status')).toHaveText('Plan ready');
    await page.getByTestId('note-body').fill('Discounts are applied twice. Reproduce with a 10% code. Also rounding.');
    await saved(page);
    await expect(page.getByTestId('note-status')).toHaveText('Plan out of date');
    await expect(rows(page).filter({ hasText: 'Fix the totals' })).toContainText('Plan out of date');

    const fresh = store().get(target.id);
    store().update(target.id, { rev: fresh.rev, status: 'ran', processId: 'p-12' });
    await page.reload();
    await expect(page.getByTestId('note-status')).toHaveText('Ran');
    await expect(page.getByTestId('note-ran')).toHaveText('Process p-12');
    await expect(page.getByTestId('note-title')).toHaveAttribute('readonly', '');
    await expect(page.getByTestId('note-body')).toHaveAttribute('readonly', '');
    await expect(indicator(page)).toHaveText('Read-only history');
    await page.getByTestId('note-duplicate').click();
    await expect(page.getByTestId('note-title')).toHaveValue('Fix the totals (copy)');
    await expect(page.getByTestId('note-status')).toHaveText('Draft');
    await expect(page.getByTestId('note-body')).not.toHaveAttribute('readonly', '');
    await expect(rows(page)).toHaveCount(3);
  });

  test('a big note (200 KB, past the 100 KB default) saves; delete asks first and removes the note', async ({ page }) => {
    await gotoCockpit(page, '/notes');
    await page.getByTestId('note-new').click();
    await page.getByTestId('note-title').fill('Big one');
    await page.getByTestId('note-body').fill('x'.repeat(200 * 1024));
    await saved(page);
    expect(store().list().notes.find((n) => n.title === 'Big one').body.length).toBe(200 * 1024);

    const before = await rows(page).count();
    await page.getByTestId('note-delete').click();
    await expect(page.getByRole('group', { name: 'Confirm delete' })).toBeVisible();
    await page.getByRole('group', { name: 'Confirm delete' }).getByRole('button', { name: 'Cancel' }).click();
    await expect(rows(page)).toHaveCount(before);
    await page.getByTestId('note-delete').click();
    await page.getByTestId('note-delete-confirm').click();
    await expect(rows(page)).toHaveCount(before - 1);
    expect(store().list().notes.some((n) => n.title === 'Big one')).toBe(false);
  });

  test('the screen passes the axe scan and is reachable from the palette', async ({ page }) => {
    await gotoCockpit(page, '/notes');
    await expect(page.getByTestId('note-editor')).toBeVisible();
    const blocking = (await runAxe(page)).filter(isBlocking);
    expect(blocking, format(blocking)).toEqual([]);
    await gotoCockpit(page, '/');
    await page.getByTestId('palette-trigger').click();
    const dialog = page.getByRole('dialog', { name: 'Command palette' });
    await dialog.getByRole('combobox').fill('go to notes');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/notes/);
    await expect(page.getByTestId('notes-stage')).toBeVisible();
  });
});
