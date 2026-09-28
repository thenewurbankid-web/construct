import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI_BIN = path.resolve(__dirname, '../../../packages/cli/construct.mjs');
const API = process.env.E2E_API_BASE || 'http://localhost:4000';

// #541: the Cockpit's Tools > Project panel shows which mode the open project runs core
// activities in -- `engine` (in-process, the default) or `cli` (the real construct binary as a
// subprocess), read from `project.execution.mode` in the project's own architecture.yml. This is
// the "Cockpit indicator" the epic's README section names as an open item.
test.describe.serial('#541 Cockpit indicator: execution mode shown in the Project panel', () => {
  let projectDir;
  let original;

  test.beforeAll(async ({ request }) => {
    original = await (await request.get(`${API}/api/settings`)).json();
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-execmode-e2e-'));
    execFileSync('node', [CLI_BIN, 'init', projectDir, '--no-scaffold']);
  });

  test.afterAll(async ({ request }) => {
    await request.post(`${API}/api/settings`, { data: { projectDir: original.projectDir } });
    fs.rmSync(projectDir, { recursive: true, force: true });
  });

  test('default project shows "Engine (in-process)"; opting into cli mode in architecture.yml flips it', async ({ page, request }) => {
    const open = await request.post(`${API}/api/settings`, { data: { projectDir } });
    expect(open.ok()).toBeTruthy();

    await page.goto('/help');
    await page.getByTestId('toggle-right').click();
    const tools = page.getByRole('complementary', { name: 'Tools' });
    const panel = tools.getByRole('tabpanel', { name: 'Project' });
    await expect(panel).toBeVisible();
    await expect(panel.getByTestId('info-execution-mode')).toHaveText('Engine (in-process)');

    const archPath = path.join(projectDir, 'architecture.yml');
    const before = fs.readFileSync(archPath, 'utf8');
    // A second top-level `project:` mapping is a duplicate YAML key (js-yaml rejects it); add
    // `execution` as a sub-key of the one `project:` block `construct init` already wrote instead.
    expect(before).toContain('project:\n  framework:');
    fs.writeFileSync(archPath, before.replace('project:\n  framework:', 'project:\n  execution:\n    mode: cli\n  framework:'));

    await page.reload();
    await expect(panel.getByTestId('info-execution-mode')).toHaveText('CLI (subprocess)', { timeout: 10_000 });
  });
});
