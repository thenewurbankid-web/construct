import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOTS_DIR = path.resolve(__dirname, '../screenshots');
fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });

const API_BASE = process.env.E2E_API_BASE || 'http://localhost:4000';

// Commit on save (#283), end to end in a real browser against a REAL git repository.
//
// The claim this proves is not "the API returns ok" — ui/server/src/autoCommit.test.mjs already
// covers that. It is the one that matters to a user: I edited a page in the Cockpit, I pressed
// save, and a real commit now exists in my repository with the expected message, on a branch the
// Cockpit created and named after my work — and the screen told me so.
//
// Each test reads `git log` off disk as well as asserting on the screen, so a UI that merely
// claimed success could not pass.
const FIXTURE_PAGE = `import React, { useState } from 'react';
import { Counter } from '../components/Counter';

export default function HomePage({ title }: { title: string }) {
  const [count, setCount] = useState(0);

  return (
    <main>
      <h1>{title}</h1>
      <Counter count={count} label="Counter" />
    </main>
  );
}
`;

const FIXTURE_COMPONENT = `export function Counter({ count, label }: { count: number; label: string }) {
  return <div className="counter">{label}: {count}</div>;
}
`;

test.describe.serial('Commit on save (#283)', () => {
  let projectDir;
  let pagePath;
  let otherPath;

  const git = (...args) => execFileSync('git', args, { cwd: projectDir, encoding: 'utf8' }).trim();
  const log = (format, n = 1) => git('log', `-${n}`, `--format=${format}`);

  test.beforeAll(async ({ request }) => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-ui-e2e-commit-'));
    await request.post(`${API_BASE}/api/settings`, { data: { projectDir } });
    await request.post(`${API_BASE}/api/init`);
    await request.post(`${API_BASE}/api/create`, { data: { kind: 'single', name: 'Home', feature: 'billing', layer: 'page' } });

    pagePath = path.join(projectDir, 'features/billing/pages/HomePage.tsx');
    fs.writeFileSync(pagePath, FIXTURE_PAGE);
    fs.mkdirSync(path.join(projectDir, 'features/billing/components'), { recursive: true });
    fs.writeFileSync(path.join(projectDir, 'features/billing/components/Counter.tsx'), FIXTURE_COMPONENT);
    // A second, unrelated file — this is what will be dirty when the session starts.
    otherPath = path.join(projectDir, 'features/billing/domain/BillingRules.ts');
    fs.mkdirSync(path.dirname(otherPath), { recursive: true });
    fs.writeFileSync(otherPath, '// Pure billing rules.\nexport const vat = (n: number) => n * 0.2;\n');

    git('init', '-q', '-b', 'main');
    git('config', 'user.email', 'e2e@example.com');
    git('config', 'user.name', 'E2E');
    git('add', '-A');
    git('commit', '-qm', 'initial');

    // `every-save` for the first three tests: the point here is the commit and its message, and a
    // 30s default window would only make the test slow. The window itself is exercised for real in
    // test 5, and in ui/server/src/autoCommit.test.mjs.
    await request.post(`${API_BASE}/api/git/config`, {
      data: { enabled: true, mode: 'every-save', messagePrefix: 'CON', branchPrefix: 'cockpit', branchSuffix: '' },
    });
  });

  test.afterAll(async ({ request }) => {
    // Leave auto-commit OFF and the project dir pointed back at this repo, exactly as the other
    // pages-editor specs do: the backend's git config is process-global, and a later spec saving a
    // page while pointed at a real repository must not commit to it as a side effect of this file.
    await request.post(`${API_BASE}/api/git/config`, { data: { enabled: false } });
    await request.post(`${API_BASE}/api/settings`, { data: { projectDir: path.resolve(__dirname, '../../..') } });
    fs.rmSync(projectDir, { recursive: true, force: true });
  });

  async function openHomePage(page) {
    await page.goto('/pages');
    await expect(page.locator('h1')).toHaveText('Pages Editor');
    await page.locator('.pages-browser select').selectOption('billing');
    const openButton = page.getByRole('button', { name: 'HomePage.tsx' });
    await expect(openButton).toBeVisible({ timeout: 10_000 });
    await openButton.click();
    await expect(page.locator('.tree-panel')).toBeVisible();
  }

  /** Edit the <h1> snippet and run the real two-step save (#81), returning the POST response. */
  async function editAndSave(page, snippet) {
    await page.locator('.tree-panel').getByText('<h1>', { exact: true }).click();
    const textarea = page.locator('.snippet-textarea');
    await expect(textarea).toBeVisible();
    await textarea.fill(snippet);
    await page.getByRole('button', { name: 'Preview & save' }).click();
    await expect(page.locator('.snippet-diff-preview')).toBeVisible();
    const [response] = await Promise.all([
      page.waitForResponse((res) => res.url().includes('/api/pages/node') && res.request().method() === 'POST'),
      page.getByRole('button', { name: 'Confirm save' }).click(),
    ]);
    expect(response.ok()).toBeTruthy();
    return response;
  }

  test('1. commit-on-save-settings.png — the user owns the mode, the window and the prefixes', async ({ page }) => {
    await page.goto('/settings');
    const section = page.locator('.git-settings');
    await expect(section.getByRole('heading', { name: 'Commit on save' })).toBeVisible({ timeout: 10_000 });

    // Auto-commit is on by default, and all three modes are offered — none of them hidden behind a
    // flag, because #283 makes the opt-out part of the feature rather than polish.
    await expect(page.getByTestId('auto-commit-enabled')).toBeChecked();
    await expect(page.getByTestId('auto-commit-mode').locator('option')).toHaveText([
      'Group rapid saves',
      'Every save',
      'Only when I click Commit',
    ]);

    // The prefix is the user's; the session id and serial are ours. The example proves it live.
    await expect(page.getByTestId('auto-commit-message-example')).toHaveText('CON-a3f7-0007: …');
    await page.getByTestId('auto-commit-prefix').fill('PROJ-9');
    await expect(page.getByTestId('auto-commit-message-example')).toHaveText('PROJ-9-a3f7-0007: …', { timeout: 10_000 });
    await page.getByTestId('auto-commit-prefix').fill('CON');
    await expect(page.getByTestId('auto-commit-message-example')).toHaveText('CON-a3f7-0007: …', { timeout: 10_000 });

    await expect(page.getByTestId('auto-commit-branch-example')).toHaveText('cockpit/billing-invoice-a3f7');
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'commit-on-save-settings.png'), fullPage: true });
  });

  test('2. commit-on-save-dirty-prompt.png — a dirty tree is asked about, with the files grouped by feature and layer', async ({ page }) => {
    // Someone was already working in this repo when the Cockpit session started.
    fs.writeFileSync(otherPath, '// Pure billing rules.\nexport const vat = (n: number) => n * 0.25;\n');

    await openHomePage(page);
    await editAndSave(page, '<h1 className="headline">{title}</h1>');

    const prompt = page.getByTestId('dirty-tree-prompt');
    await expect(prompt).toBeVisible({ timeout: 10_000 });
    // Not a generic "you have uncommitted changes" — it names the feature and the layer, from the
    // same impact computation (#288) the commit messages use.
    await expect(page.getByTestId('dirty-groups')).toContainText('billing (domain)');
    await expect(page.getByTestId('dirty-question')).toContainText('carry onto this session');
    await expect(page.getByTestId('commit-indicator')).toHaveAttribute('data-state', 'asking');

    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'commit-on-save-dirty-prompt.png'), fullPage: true });

    // Nothing has been committed while the question is outstanding.
    expect(git('rev-list', '--count', 'HEAD')).toBe('1');
    expect(git('rev-parse', '--abbrev-ref', 'HEAD')).toBe('main');
  });

  test('3. commit-on-save-committed.png — answering it commits, on a session branch named after the work', async ({ page }) => {
    await openHomePage(page);
    await expect(page.getByTestId('dirty-carry')).toBeVisible({ timeout: 10_000 });
    await page.getByTestId('dirty-carry').click();

    const indicator = page.getByTestId('commit-indicator');
    await expect(indicator).toHaveAttribute('data-state', 'committed', { timeout: 15_000 });

    // What the screen says...
    const subject = page.getByTestId('last-commit-subject');
    await expect(subject).toHaveText(/^CON-[0-9a-f]{4}-0001: billing: update HomePage$/);
    await expect(page.getByTestId('last-commit-impact')).toHaveText('1 feature, 1 layer, 1 file — billing: page');
    await expect(page.getByTestId('last-commit-branch')).toHaveText(/^cockpit\/billing-home-page-[0-9a-f]{4}$/);

    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'commit-on-save-committed.png'), fullPage: true });

    // ...and what git actually contains. This is the assertion the ticket is about.
    expect(git('rev-list', '--count', 'HEAD')).toBe('2');
    expect(git('rev-parse', '--abbrev-ref', 'HEAD')).toMatch(/^cockpit\/billing-home-page-[0-9a-f]{4}$/);
    expect(log('%s')).toMatch(/^CON-[0-9a-f]{4}-0001: billing: update HomePage$/);

    const body = log('%b');
    expect(body).toMatch(/^1 feature, 1 layer, 1 file$/m);
    expect(body).toMatch(/^ {2}billing: page$/m);
    expect(body).toMatch(/^Construct-Serial: 1$/m);
    expect(body).toMatch(/^Construct-Summary: deterministic .*no LLM$/m);
    // The carried file is committed but NOT counted — the honesty rule from the ticket.
    expect(body).toMatch(/^Carried in from before this session \(committed, not counted above\): 1 file\(s\)$/m);
    expect(body).toContain('features/billing/domain/BillingRules.ts');

    const committed = git('show', '--name-only', '--format=', 'HEAD').split('\n').sort();
    expect(committed).toEqual(['features/billing/domain/BillingRules.ts', 'features/billing/pages/HomePage.tsx']);

    // And the edit really is on disk, not just in the browser.
    expect(fs.readFileSync(pagePath, 'utf8')).toContain('<h1 className="headline">{title}</h1>');
  });

  test('4. the next save commits again, with the serial advancing inside the same branch', async ({ page }) => {
    const branchBefore = git('rev-parse', '--abbrev-ref', 'HEAD');

    await openHomePage(page);
    await editAndSave(page, '<h1 className="headline large">{title}</h1>');

    const indicator = page.getByTestId('commit-indicator');
    await expect(indicator).toHaveAttribute('data-state', 'committed', { timeout: 15_000 });
    await expect(page.getByTestId('last-commit-subject')).toHaveText(/^CON-[0-9a-f]{4}-0002: /, { timeout: 15_000 });

    expect(git('rev-parse', '--abbrev-ref', 'HEAD')).toBe(branchBefore); // the name is fixed once created
    expect(git('rev-list', '--count', 'HEAD')).toBe('3');
    expect(log('%s')).toMatch(/^CON-[0-9a-f]{4}-0002: /);
    // No prompt this time: the tree is clean and the session already exists.
    await expect(page.getByTestId('dirty-tree-prompt')).toHaveCount(0);
    // This commit contains only what the Cockpit wrote.
    expect(git('show', '--name-only', '--format=', 'HEAD')).toBe('features/billing/pages/HomePage.tsx');
  });

  test('5. commit-on-save-coalescing.png — the grouping window holds the save, and Commit now lands it', async ({ page, request }) => {
    // The default mode, with a window long enough to see. The indicator must say what is ABOUT to
    // happen, not only what already did — this is the state a user is in most of the time.
    await request.post(`${API_BASE}/api/git/config`, { data: { mode: 'coalesce', coalesceMs: 300_000 } });

    await openHomePage(page);
    await editAndSave(page, '<h1 className="headline large" id="title">{title}</h1>');

    const indicator = page.getByTestId('commit-indicator');
    await expect(indicator).toHaveAttribute('data-state', 'pending', { timeout: 10_000 });
    await expect(page.getByTestId('commit-indicator-text')).toContainText('committing in');
    expect(git('rev-list', '--count', 'HEAD')).toBe('3'); // still held

    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'commit-on-save-coalescing.png'), fullPage: true });

    await page.getByTestId('commit-now').click();
    await expect(indicator).toHaveAttribute('data-state', 'committed', { timeout: 15_000 });
    expect(git('rev-list', '--count', 'HEAD')).toBe('4');
    expect(log('%s')).toMatch(/^CON-[0-9a-f]{4}-0003: /);
  });

  test('6. the off switch stops it, and the indicator says so', async ({ page, request }) => {
    await request.post(`${API_BASE}/api/git/config`, { data: { enabled: false } });
    const before = git('rev-list', '--count', 'HEAD');

    await openHomePage(page);
    await editAndSave(page, '<h1>{title}</h1>');

    await expect(page.getByTestId('commit-indicator')).toHaveAttribute('data-state', 'off', { timeout: 10_000 });
    await expect(page.getByTestId('commit-indicator-text')).toContainText('Auto-commit is off');
    expect(git('rev-list', '--count', 'HEAD')).toBe(before);
    expect(git('status', '--porcelain')).toContain('features/billing/pages/HomePage.tsx');
  });
});
