import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gotoCockpit } from './support/cockpit.js';
import { openProject } from './support/browseProject.js';

// cu3 on the real server: every /api/line route resolves from Line's one tool registry. GET /api/line/tools lists it
// (each tool read or write, what a write changes, its controlId); a direct project-write route only adds a plan step
// that waits in the Plan panel (nothing written); a route the registry does not know is a 404 sentence.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SAMPLE = path.resolve(__dirname, '../../../examples/line-sample');
const API = process.env.E2E_API_BASE || 'http://localhost:4000';

test.describe.serial('Line: one tool registry (real server)', () => {
  let base;
  let restore;
  test.beforeAll(async () => {
    base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'line-tools-')));
    fs.cpSync(SAMPLE, base, { recursive: true });
    restore = await openProject(API, base);
  });
  test.afterAll(async () => {
    await restore?.();
    if (base) fs.rmSync(base, { recursive: true, force: true });
  });

  test('the registry lists every tool, read or write; a project write through a route waits in the Plan panel and writes nothing', async ({ page, request }) => {
    const tools = await (await request.get(`${API}/api/line/tools`)).json();
    expect(tools.ok).toBe(true);
    const byId = Object.fromEntries(tools.tools.map((t) => [t.id, t]));
    expect(byId['line.baseOn']).toMatchObject({ kind: 'write', writes: 'project', controlId: 'base-on' });
    expect(byId['line.project']).toMatchObject({ kind: 'read', writes: null });
    expect(byId['plan.approve']).toMatchObject({ personOnly: true });

    const res = await request.post(`${API}/api/line/base-on`, { data: { libraryId: 'components/Badge', feature: 'orders', name: 'StatusBadge' } });
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.sentence).toBe('Waiting for your approval: Creates StatusBadge in feature orders, based on the library Badge.');
    expect(fs.existsSync(path.join(base, 'features/orders/components/StatusBadge.tsx'))).toBe(false);

    await gotoCockpit(page, '/components');
    const step = page.getByTestId('line-plan').getByTestId('plan-step').first();
    await expect(step).toHaveAttribute('data-state', 'waiting', { timeout: 30_000 });

    const unknown = await request.post(`${API}/api/line/delete-everything`, { data: {} });
    expect(unknown.status()).toBe(404);
    expect((await unknown.json()).sentence).toBe('Line has no tool at POST /api/line/delete-everything.');
  });
});
