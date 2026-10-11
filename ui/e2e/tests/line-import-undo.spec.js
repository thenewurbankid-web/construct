import { test, expect } from '@playwright/test';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gotoCockpit } from './support/cockpit.js';
import { openProject } from './support/browseProject.js';
import { runAxe, isBlocking, format } from './support/axe.js';

// iv2-bugs: Import's Apply is all or nothing through the plan. On a temp copy of test/fixtures/line-import-clash, the
// folder src/opp-frozen freezes library/pages/**, so the import's first steps land and a later one (a page into the
// library) is refused. Apply first saved the folder (line.import.save); the screen offers "Undo the import" (recommended)
// or "Leave it"; one click on Undo runs line.leaveAsIs + line.import.undo through the plan, and every file of the project
// is byte-identical to before (only Line's own state folders, line/, stay).
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(__dirname, '../../../test/fixtures/line-import-clash');
const API = process.env.E2E_API_BASE || `http://localhost:${process.env.E2E_SERVER_PORT || 4000}`;
const FOLDER = 'src/opp-frozen';

/** Every file under `dir` (relative path -> sha256), Line's own state folders left out. */
function hashes(dir) {
  const out = {};
  const visit = (abs, rel) => {
    for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) { if (e.name !== 'line') visit(path.join(abs, e.name), r); continue; }
      out[r] = crypto.createHash('sha256').update(fs.readFileSync(path.join(abs, e.name))).digest('hex');
    }
  };
  visit(dir, '');
  return out;
}

test.describe.serial('Line: Import undoes a refused Apply (all or nothing)', () => {
  let base;
  let restore;

  test.beforeAll(async () => {
    base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'import-undo-')));
    fs.cpSync(FIXTURE, base, { recursive: true });
    fs.writeFileSync(path.join(base, 'architecture.yml'), 'version: 1\n');
    restore = await openProject(API, base);
  });
  test.afterAll(async () => {
    await restore?.();
    if (base) fs.rmSync(base, { recursive: true, force: true });
  });

  test('a late step is refused; one click on Undo puts every file back, byte for byte, through the plan', async ({ page, request }) => {
    const before = hashes(base);
    await gotoCockpit(page, '/import');
    const screen = page.getByTestId('line-import');
    await screen.getByLabel('Folder to bring into Line').fill(FOLDER);
    await screen.getByRole('button', { name: 'Read folder' }).click();
    // The name clash is caught at plan time: DetailV2 is recommended and picked.
    const question = screen.getByTestId('li-question');
    await expect(question.getByRole('button').first()).toHaveText('Call it DetailV2, after its file Detail-v2.tsx. (recommended)');
    await screen.getByRole('button', { name: 'Show the plan' }).click();
    await expect(screen.getByTestId('li-step').nth(2)).toContainText('Moves Detail from Detail-v2.tsx into the library as DetailV2');

    await screen.getByRole('button', { name: 'Apply' }).click();
    const choice = screen.getByTestId('li-undo-choice');
    await expect(choice).toBeVisible({ timeout: 60_000 });
    await expect(choice).toContainText('2 steps landed before this one was refused. What should Line do?');
    await expect(screen.getByTestId('li-error')).toContainText('frozen');
    await expect(screen.getByRole('button', { name: 'Apply' })).toHaveCount(0);
    expect(fs.existsSync(path.join(base, FOLDER, 'library/components/Badge.tsx')), 'half applied until the person decides').toBe(true);
    const found = await runAxe(page, { include: '[data-testid="line-import"]' });
    expect(found.filter(isBlocking), format(found.filter(isBlocking))).toEqual([]);

    await choice.getByRole('button', { name: 'Undo the import (recommended)' }).click();
    await expect(screen.getByTestId('li-undone')).toContainText(`Undone: ${FOLDER} is back as it was before the import; nothing of it stayed.`, { timeout: 60_000 });
    await expect(screen.getByTestId('li-undo-choice')).toHaveCount(0);
    await expect(screen.getByTestId('li-error')).toHaveCount(0);
    expect(hashes(base)).toEqual(before);
    expect(fs.existsSync(path.join(base, FOLDER, 'library'))).toBe(false);

    // Every write went through the plan: save, the steps that landed, the refused one (left), and the undo, all done.
    const plan = await (await request.get(`${API}/api/line/plan`)).json();
    const tools = plan.steps.map((st) => st.tool);
    expect(tools[0]).toBe('line.import.save');
    expect(tools.slice(-2)).toEqual(['line.leaveAsIs', 'line.import.undo']);
    expect(plan.steps.every((st) => st.state === 'done')).toBe(true);
  });
});
