import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// #248 (Design: workflows-in-shell): Workflows inside the Cockpit shell. The
// workflow list is a Browser tab, the diagram is the stage, and Narrative /
// Context & actions / Edit are Tools tabs. Checked in BOTH themes: node,
// edge, label and arrowhead colours come from tokens and stay readable, and no
// two edge labels overlap.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../../..');
const SHOTS = path.resolve(__dirname, '../screenshots/workflows-shell');
fs.mkdirSync(SHOTS, { recursive: true });
const API_BASE = process.env.E2E_API_BASE || 'http://localhost:4000';
const DESCRIPTOR = path.join(REPO, 'docs/demos/workflow-flagship/refund.json');
const CLI = path.join(REPO, 'bin/construct.mjs');

const TWO_MACHINES = `import { createMachine } from 'xstate';
export const alpha = createMachine({ id: 'alpha', initial: 'one', states: { one: { on: { GO: 'two' } }, two: { type: 'final' } } });
export const beta = createMachine({ id: 'beta', initial: 'x', states: { x: { on: { NEXT: 'y' } }, y: { on: { BACK: 'x' } } } });
`;

test.describe('Workflows in the shell (#248)', () => {
  test.use({ viewport: { width: 1440, height: 900 } });
  let projectDir;

  test.beforeAll(async ({ request }) => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-wf-shell-'));
    execFileSync('node', [CLI, 'init', projectDir]);
    execFileSync('node', [CLI, 'create', 'workflow', 'refund', '--feature', 'refunds', '--from', DESCRIPTOR, '--dir', projectDir]);
    fs.writeFileSync(path.join(projectDir, 'features/refunds/workflows/Pair.ts'), TWO_MACHINES);
    const res = await request.post(`${API_BASE}/api/settings`, { data: { projectDir } });
    expect(res.ok()).toBeTruthy();
  });

  test.afterAll(async ({ request }) => {
    await request.post(`${API_BASE}/api/settings`, { data: { projectDir: REPO } });
    fs.rmSync(projectDir, { recursive: true, force: true });
  });

  async function open(page, file) {
    await page.goto('/workflows');
    const browser = page.getByRole('complementary', { name: 'Browser' });
    await browser.getByRole('combobox').selectOption('refunds');
    await browser.getByRole('button', { name: file, exact: true }).click();
    await expect(page.getByTestId('wf-machine').first()).toBeVisible();
    await page.locator('.react-flow__edge-text').first().waitFor();
    await page.waitForTimeout(1200); // fitView settle
  }

  const box = async (loc) => (await loc.boundingBox()) ?? { x: 0, y: 0, width: 0, height: 0 };

  test('layout: Browser list | diagram stage | Tools tabs, tabs enable when a file loads', async ({ page }) => {
    await page.goto('/workflows');
    // Before a file is open: the Browser tab is Workflows, and the workflow tabs are disabled.
    await expect(page.getByRole('tab', { name: 'Workflows' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('wf-empty')).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Edit' })).toBeDisabled();

    await open(page, 'RefundWorkflow.tsx');
    const browser = page.getByRole('complementary', { name: 'Browser' });
    const tools = page.getByRole('complementary', { name: 'Tools' });
    await expect(tools).toBeVisible();
    const b = await box(browser);
    const stage = await box(page.getByTestId('wf-stage'));
    const t = await box(tools);
    expect(b.x + b.width).toBeLessThanOrEqual(stage.x + 1);
    expect(stage.x + stage.width).toBeLessThanOrEqual(t.x + 1);
    expect(stage.width).toBeGreaterThan(500);

    // The diagram is inside the stage; the tabs are in the Tools panel.
    await expect(page.getByTestId('wf-stage').getByTestId('wf-machine')).toHaveCount(1);
    const tabs = tools.getByRole('tab');
    await expect(tabs).toHaveText(['Narrative', 'Context & actions', 'Edit', 'Project']);
    // Narrative is the default tab once a file is open.
    await expect(tools.getByRole('tab', { name: 'Narrative' })).toHaveAttribute('aria-selected', 'true');
    await expect(tools.getByTestId('wf-narrative-summary')).toContainText('refund request');
    await tools.getByRole('tab', { name: 'Context & actions' }).click();
    await expect(tools.getByTestId('wf-context-panel')).toBeVisible();
    await tools.getByRole('tab', { name: 'Edit' }).click();
    await expect(tools.getByTestId('wf-edit-panel')).toBeVisible();
    await expect(tools.getByTestId('wf-narrative')).toHaveCount(0);
  });

  test('picking a machine in the Browser list changes what the Tools tabs show', async ({ page }) => {
    await open(page, 'Pair.ts');
    const tools = page.getByRole('complementary', { name: 'Tools' });
    await expect(page.getByTestId('wf-machine')).toHaveCount(2);
    await expect(page.getByTestId('wf-machine-list').getByRole('button')).toHaveCount(2);
    await expect(tools.getByTestId('wf-narrative-summary')).toContainText('alpha');
    await page.getByTestId('wf-pick-machine-1').click();
    await expect(tools.getByTestId('wf-narrative-summary')).toContainText('beta');
    await tools.getByRole('tab', { name: 'Edit' }).click();
    await expect(tools.getByLabel('State to rename or remove').locator('option')).toHaveText(['x', 'y']);
    // Interacting with a diagram makes that machine the active one.
    await page.getByTestId('wf-machine').first().locator('.react-flow__pane').click({ position: { x: 5, y: 5 } });
    await expect(tools.getByLabel('State to rename or remove').locator('option')).toHaveText(['one', 'two']);
  });

  for (const theme of ['dark', 'light']) {
    test(`diagram is readable in the ${theme} theme (nodes, edges, labels, arrowheads)`, async ({ page }) => {
      await open(page, 'RefundWorkflow.tsx');
      if (theme === 'light') await page.getByTestId('theme-toggle').click();
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);

      const style = await page.evaluate(() => {
        const rgb = (s) => (s.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
        const lum = ([r, g, b]) => {
          const f = (c) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
          return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
        };
        const ratio = (a, b) => {
          const [hi, lo] = [lum(rgb(a)), lum(rgb(b))].sort((x, y) => y - x);
          return (hi + 0.05) / (lo + 0.05);
        };
        const cs = (el) => getComputedStyle(el);
        const vp = document.querySelector('.wf-viewport');
        const node = document.querySelector('.wf-state');
        const label = document.querySelector('.react-flow__edge-text');
        const labelBg = document.querySelector('.react-flow__edge-textbg');
        const edge = document.querySelector('.react-flow__edge-path');
        const arrow = document.querySelector('.react-flow__arrowhead polyline, .react-flow__arrowhead path, marker polyline, marker path');
        const canvas = cs(vp).backgroundColor;
        return {
          canvas,
          nodeBg: cs(node).backgroundColor,
          nodeText: cs(node.querySelector('.wf-state-name')).color,
          labelFill: cs(label).fill,
          labelBgFill: cs(labelBg).fill,
          edge: cs(edge).stroke,
          arrow: arrow ? cs(arrow).fill : null,
          nodeTextRatio: ratio(cs(node.querySelector('.wf-state-name')).color, cs(node).backgroundColor),
          labelRatio: ratio(cs(label).fill, cs(labelBg).fill),
          edgeRatio: ratio(cs(edge).stroke, canvas),
          nodeVsCanvas: ratio(cs(node).backgroundColor, canvas),
        };
      });
      expect(style.nodeTextRatio).toBeGreaterThan(7);
      expect(style.labelRatio).toBeGreaterThan(7);
      expect(style.edgeRatio).toBeGreaterThan(3); // non-text graphics: 3:1
      // The arrowhead is drawn in the edge colour, not React Flow's fixed grey.
      expect(style.arrow).toBe(style.edge);
      if (theme === 'dark') expect(style.canvas).toBe('rgb(11, 13, 17)');
      else expect(style.canvas).toBe('rgb(223, 227, 234)');

      // No two edge labels overlap in this theme.
      const boxes = await page.getByTestId('wf-machine').first().locator('.react-flow__edge-textbg').evaluateAll((els) =>
        els.map((el) => {
          const r = el.getBoundingClientRect();
          return { text: el.nextElementSibling?.textContent, x: r.x, y: r.y, w: r.width, h: r.height };
        }),
      );
      expect(boxes.length).toBeGreaterThan(2);
      const bad = [];
      for (let i = 0; i < boxes.length; i++)
        for (let j = i + 1; j < boxes.length; j++) {
          const a = boxes[i];
          const c = boxes[j];
          if (a.x < c.x + c.w && c.x < a.x + a.w && a.y < c.y + c.h && c.y < a.y + a.h) bad.push(`${a.text} x ${c.text}`);
        }
      expect(bad).toEqual([]);

      await page.screenshot({ path: path.join(SHOTS, `workflows-shell--${theme}.png`) });
    });
  }
});
