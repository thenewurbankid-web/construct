import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOTS_DIR = path.resolve(__dirname, '../screenshots');
fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });

const API_BASE = 'http://localhost:4000';

// Retroactive coverage for #52/#53/#54/#55/#56 (CLAUDE.md rule 11): the
// original walkthrough.spec.js#7 proves #50/#51 (tree parse + bidirectional
// selection) end to end in a real browser but deliberately stopped short of
// the actual save round trips, leaving those covered only at the API level
// by ui/server/src/pagesEditor.test.mjs. This suite drives the real,
// rendered UI through each save/edit/enforcement path instead, against a
// fixture page rich enough to exercise all of them: a page component with
// its own prop (`title`) and state (`count`), a custom child component
// (`Counter`) that already receives some but not all of that scope, and a
// plain `<h1>` for the isolated-snippet-edit case.
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

const FIXTURE_COMPONENT = `export function Counter({ count, label, title, setCount }: { count: number; label: string; title?: string; setCount?: (n: number) => void }) {
  return (
    <div className="counter">
      {label}: {count}
    </div>
  );
}
`;

test.describe.serial('Pages Editor save-back / props / auto-map / prop-flow / enforcement (#52-#56)', () => {
  let tmpProjectDir;
  let pagePath;

  test.beforeAll(async ({ request }) => {
    tmpProjectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-ui-e2e-editing-'));
    await request.post(`${API_BASE}/api/settings`, { data: { projectDir: tmpProjectDir } });
    await request.post(`${API_BASE}/api/init`);
    await request.post(`${API_BASE}/api/create`, { data: { kind: 'single', name: 'Home', feature: 'billing', layer: 'page' } });

    // Overwrite the scaffolded page with a richer fixture (real prop/state
    // drilling into a real custom child) so #54's auto-map has a genuine
    // unmapped candidate and #55's diagram has genuine colored edges to
    // draw, instead of the walkthrough's flat single-element page.
    pagePath = path.join(tmpProjectDir, 'features/billing/pages/HomePage.tsx');
    fs.writeFileSync(pagePath, FIXTURE_PAGE);
    fs.mkdirSync(path.join(tmpProjectDir, 'features/billing/components'), { recursive: true });
    fs.writeFileSync(path.join(tmpProjectDir, 'features/billing/components/Counter.tsx'), FIXTURE_COMPONENT);
  });

  test.afterAll(async ({ request }) => {
    // Other spec files in this same run share one backend process's global
    // `projectDir` setting (see ui/server/src/settings.mjs) — leaving it
    // pointed at this tmp dir after deleting it would flip whichever spec
    // runs next into the ProjectGate ("No Construct project here yet")
    // branch instead of the Dashboard, which is exactly how this fixture
    // uncovered a real, previously-dormant bug (see this issue's closing
    // comments): ProjectGate.jsx renders its own inline "Settings" link
    // alongside the nav's, so anything asserting on `getByRole('link',
    // {name:'Settings'})` without scoping to nav breaks. Restore a known-
    // valid projectDir (this repo's own root, which has its own
    // architecture.yml) so later spec files see the same state they would
    // have if this file hadn't run at all.
    await request.post(`${API_BASE}/api/settings`, { data: { projectDir: path.resolve(__dirname, '../../..') } });
    fs.rmSync(tmpProjectDir, { recursive: true, force: true });
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

  async function selectTreeNode(page, tagText) {
    await page.locator('.tree-panel').getByText(tagText, { exact: true }).click();
  }

  test('1. pages-editor-snippet-save.png — isolated snippet edit saves back into the real source file (#52)', async ({ page }) => {
    await openHomePage(page);
    await selectTreeNode(page, '<h1>');

    const textarea = page.locator('.snippet-textarea');
    await expect(textarea).toBeVisible();
    await expect(textarea).toHaveValue('<h1>{title}</h1>');

    await textarea.fill('<h1 className="headline">{title}</h1>');
    // Assert on the real network round trip rather than the transient
    // "Saved" banner: a successful save updates `contentHash`, which
    // re-triggers SnippetEditor's own load effect and clears its status
    // right back to null on the very next render — by design (so a stale
    // banner never survives a tree refresh), but that makes it a race to
    // assert on from outside. The POST response itself is the
    // deterministic signal.
    const [response] = await Promise.all([
      page.waitForResponse((res) => res.url().includes('/api/pages/node') && res.request().method() === 'POST'),
      page.getByRole('button', { name: 'Save snippet' }).click(),
    ]);
    expect(response.ok()).toBeTruthy();
    expect((await response.json()).ok).toBe(true);

    // And proof this isn't just client-side state either: the props panel
    // re-parses from the patched file and now shows the new `className`
    // attribute that didn't exist before the save.
    await expect(page.locator('.prop-row', { has: page.locator('.prop-name', { hasText: 'className' }) })).toBeVisible();

    // The real proof this isn't just client-side state: read the actual
    // file off disk and confirm the splice landed, with every other line
    // (imports, the Counter usage, etc.) untouched.
    const onDisk = fs.readFileSync(pagePath, 'utf8');
    expect(onDisk).toContain('<h1 className="headline">{title}</h1>');
    expect(onDisk).toContain("import { Counter } from '../components/Counter';");
    expect(onDisk).toContain('<Counter count={count} label="Counter" />');

    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'pages-editor-snippet-save.png'), fullPage: true });
  });

  test('2. pages-editor-props-save.png — a generated prop form control edits and saves one attribute (#53)', async ({ page }) => {
    await openHomePage(page);
    await selectTreeNode(page, '<Counter>');

    await expect(page.locator('.props-inspector')).toBeVisible();
    const labelRow = page.locator('.prop-row', { has: page.locator('.prop-name', { hasText: 'label' }) });
    await expect(labelRow).toBeVisible();
    await labelRow.locator('input[type="text"]').fill('Counter Label');
    const [response] = await Promise.all([
      page.waitForResponse((res) => res.url().includes('/api/pages/props') && res.request().method() === 'POST'),
      labelRow.getByRole('button', { name: 'Save' }).click(),
    ]);
    expect(response.ok()).toBeTruthy();
    expect((await response.json()).ok).toBe(true);

    // Re-render proof: the prop row now reflects the saved value, re-read
    // from the reparsed tree (not just the input's own uncommitted state).
    await expect(page.locator('.prop-row', { has: page.locator('.prop-name', { hasText: 'label' }) }).locator('input[type="text"]')).toHaveValue(
      'Counter Label',
    );

    const onDisk = fs.readFileSync(pagePath, 'utf8');
    expect(onDisk).toContain('label="Counter Label"');

    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'pages-editor-props-save.png'), fullPage: true });
  });

  test('3. pages-editor-automap.png — auto-map finds and wires an unmapped parent prop onto the child (#54)', async ({ page }) => {
    await openHomePage(page);
    await selectTreeNode(page, '<Counter>');

    await page.getByRole('button', { name: 'Find unmapped props' }).click();
    const candidates = page.locator('.automap-candidates li');
    await expect(candidates).toContainText(['title']);

    // Counter already receives `count`; the page's own `title` prop and its
    // `setCount` state setter are the genuinely unmapped ones. Wire only
    // `title` for this pass and leave `setCount` unchecked, to prove the
    // form lets you choose a subset rather than all-or-nothing.
    const titleCheckbox = page.locator('.automap-candidates li', { hasText: 'title' }).locator('input[type="checkbox"]');
    const setCountCheckbox = page.locator('.automap-candidates li', { hasText: 'setCount' }).locator('input[type="checkbox"]');
    await expect(titleCheckbox).toBeChecked(); // defaults to all-candidates-checked
    await setCountCheckbox.uncheck();

    const [response] = await Promise.all([
      page.waitForResponse((res) => res.url().includes('/api/pages/automap') && res.request().method() === 'POST'),
      page.getByRole('button', { name: 'Wire 1 prop(s)' }).click(),
    ]);
    expect(response.ok()).toBeTruthy();
    expect((await response.json()).ok).toBe(true);
    await expect(page.locator('.automap-panel .status-ok')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('.automap-panel .status-ok')).toContainText('Wired 1 prop(s)');

    const onDisk = fs.readFileSync(pagePath, 'utf8');
    expect(onDisk).toMatch(/<Counter[^>]*\btitle={title}/);
    expect(onDisk).not.toContain('setCount={setCount}'); // left unchecked, must not have been wired

    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'pages-editor-automap.png'), fullPage: true });
  });

  test('4. pages-editor-propflow.png — the prop-flow diagram draws real colored edges for the drilled props (#55)', async ({ page }) => {
    await openHomePage(page);
    await page.getByRole('button', { name: 'Show diagram' }).click();

    const svg = page.locator('.propflow-svg');
    await expect(svg).toBeVisible();
    // By now the tree carries real, distinct props at more than one level:
    // `className` (main -> h1, from test 1's snippet edit) and `count` /
    // `label` / `title` (main -> Counter, `title` from test 3's auto-map) —
    // four differently-colored legend entries and edges, not the
    // empty-diagram case a single flat element would produce.
    await expect(page.locator('.propflow-legend-item')).toHaveCount(4);
    await expect(page.locator('.propflow-panel')).not.toContainText('No props flow between nodes in this tree');
    const edgeCount = await svg.locator('line').count();
    expect(edgeCount).toBeGreaterThanOrEqual(4);

    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'pages-editor-propflow.png'), fullPage: true });
  });

  test('5. pages-editor-enforcement-blocked.png — a fetch() save is rejected by PAGE-004 and the file is left untouched (#56)', async ({ page }) => {
    await openHomePage(page);
    await selectTreeNode(page, '<h1>');

    const before = fs.readFileSync(pagePath, 'utf8');

    // SnippetEditor's own load effect fetches the node's current snippet
    // asynchronously (api.getNodeSnippet) and overwrites the textarea's
    // value once it resolves. Waiting for that initial fetched value first
    // (same pattern as test 1) avoids a race where `.fill()` runs before
    // the fetch resolves and gets silently clobbered.
    const textarea = page.locator('.snippet-textarea');
    await expect(textarea).toHaveValue('<h1 className="headline">{title}</h1>');
    await textarea.fill('<h1 onClick={() => fetch("/api/x")} className="headline">{title}</h1>');
    const [response] = await Promise.all([
      page.waitForResponse((res) => res.url().includes('/api/pages/node') && res.request().method() === 'POST'),
      page.getByRole('button', { name: 'Save snippet' }).click(),
    ]);
    expect(response.status()).toBe(422);
    expect((await response.json()).ok).toBe(false);

    const errorStatus = page.locator('.status-error').first();
    await expect(errorStatus).toBeVisible({ timeout: 10_000 });
    await expect(errorStatus).toContainText('violates architecture rules');
    await expect(errorStatus.locator('.violation-list')).toContainText('PAGE-004');

    // The whole point of #56: a rejected save must never touch disk.
    const after = fs.readFileSync(pagePath, 'utf8');
    expect(after).toEqual(before);
    expect(after).not.toContain('fetch(');

    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'pages-editor-enforcement-blocked.png'), fullPage: true });
  });
});
