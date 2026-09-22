import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { compileWorkflow } from '../../../packages/engine/workflowGenerator.mjs';

// #217 — dense flows must lay out without edge labels colliding, and the same
// source must always give the same picture. Bounding boxes are read from the
// rendered DOM, so this checks what a person actually sees.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../../..');
const SHOTS = path.resolve(__dirname, '../screenshots/workflows-layout');
fs.mkdirSync(SHOTS, { recursive: true });
const SUFFIX = process.env.LAYOUT_SHOT_SUFFIX || 'after';
const API_BASE = process.env.E2E_API_BASE || 'http://localhost:4000';
const CHECKOUT = JSON.parse(fs.readFileSync(path.join(REPO, 'fixtures/workflow-graphs/checkout.json'), 'utf8'));
const DESCRIPTOR = path.join(REPO, 'docs/demos/workflow-flagship/refund.json');
const CLI = path.join(REPO, 'packages/cli/construct.mjs');

const NESTED = `import { setup } from 'xstate';
export const Player = setup({}).createMachine({
  id: 'player', initial: 'stopped',
  states: {
    stopped: { on: { PLAY: 'playing' } },
    playing: {
      initial: 'normal',
      states: { normal: { on: { SEEK: 'seeking' } }, seeking: { after: { 500: 'normal' } } },
      on: { STOP: 'stopped', TICK: { actions: 'advance' } },
    },
  },
});
`;

test.describe('Workflows layout: no overlapping edge labels (#217)', () => {
  test.use({ viewport: { width: 1500, height: 1250 } });
  let projectDir;

  test.beforeAll(async ({ request }) => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-wf-layout-'));
    execFileSync('node', [CLI, 'init', projectDir]);
    execFileSync('node', [CLI, 'create', 'workflow', 'refund', '--feature', 'refunds', '--from', DESCRIPTOR, '--dir', projectDir]);
    const dir = path.join(projectDir, 'features/refunds/workflows');
    fs.writeFileSync(path.join(dir, 'RefundRequest.ts'), fs.readFileSync(path.join(REPO, 'fixtures/workflow-graphs/refund-request.ts'), 'utf8'));
    fs.writeFileSync(path.join(dir, 'Checkout.tsx'), compileWorkflow(CHECKOUT, { name: 'Checkout' }).source);
    fs.writeFileSync(path.join(dir, 'Nested.ts'), NESTED);
    const res = await request.post(`${API_BASE}/api/settings`, { data: { projectDir } });
    expect(res.ok()).toBeTruthy();
  });

  test.afterAll(async ({ request }) => {
    await request.post(`${API_BASE}/api/settings`, { data: { projectDir: REPO } });
    fs.rmSync(projectDir, { recursive: true, force: true });
  });

  async function open(page, file) {
    await page.goto('/workflows');
    await page.getByRole('combobox').first().selectOption('refunds');
    await page.getByRole('button', { name: file, exact: true }).click();
    await expect(page.getByTestId('wf-machine').first()).toBeVisible();
    await page.locator('.react-flow__edge-text').first().waitFor();
    await page.waitForTimeout(1200); // fitView settle
  }

  async function labelBoxes(machine) {
    // The padded background rect is what a viewer sees as the label's footprint.
    return machine.locator('.react-flow__edge-textbg').evaluateAll((els) =>
      els.map((el) => {
        const r = el.getBoundingClientRect();
        return { text: el.nextElementSibling?.textContent, x: r.x, y: r.y, w: r.width, h: r.height };
      }),
    );
  }

  function overlaps(boxes) {
    const bad = [];
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i];
        const b = boxes[j];
        if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) bad.push(`${a.text} x ${b.text}`);
      }
    }
    return bad;
  }

  for (const [file, shot] of [
    ['RefundWorkflow.tsx', 'refund-flow'],
    ['RefundRequest.ts', 'refund-request'],
    ['Checkout.tsx', 'checkout-flow'],
    ['Nested.ts', 'nested'],
  ]) {
    test(`${file}: no two edge labels overlap`, async ({ page }) => {
      await open(page, file);
      const machine = page.getByTestId('wf-machine').first();
      const boxes = await labelBoxes(machine);
      expect(boxes.length).toBeGreaterThan(2);
      await machine.locator('.wf-viewport').screenshot({ path: path.join(SHOTS, `${shot}-${SUFFIX}.png`) });
      expect(overlaps(boxes)).toEqual([]);
    });
  }

  test('layout is deterministic: two loads give identical node and label positions', async ({ page }) => {
    const grab = async () => {
      await open(page, 'RefundWorkflow.tsx');
      const m = page.getByTestId('wf-machine').first();
      const nodes = await m.locator('.react-flow__node').evaluateAll((els) => els.map((e) => [e.getAttribute('data-id'), e.style.transform]));
      const labels = await m.locator('.react-flow__edge-text').evaluateAll((els) => els.map((e) => [e.textContent, e.getAttribute('x'), e.getAttribute('y'), e.getAttribute('transform')]));
      return JSON.stringify({ nodes, labels });
    };
    const a = await grab();
    const b = await grab();
    expect(a).toBe(b);
  });
});
