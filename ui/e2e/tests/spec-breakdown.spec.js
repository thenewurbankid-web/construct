import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { gotoCockpit } from './support/cockpit.js';
import { makeBrowseProject, openProject } from './support/browseProject.js';

// #748 (R6) -- the Cockpit's "Break down into functions" screen, end to end against a real server and a real
// throwaway git project: an accepted machine-spec.v1 file renders as a table next to its read-back (#672), and
// the golden path (approve a spec, see it generate, #593) writes real files through the real generator. Nothing
// is mocked: /api/research's new `spec` action (researchApi.mjs) runs the real CLI path in-process.
const API = process.env.E2E_API_BASE || 'http://localhost:4000';
const SPEC_FILE = 'specs/sign-in.machine-spec.json';

// The R1 worked example (packages/core/research/examples/machine-spec.v1.example.json), copied inline so this
// spec has no path dependency on that file's location and stays readable end to end.
const SPEC = {
  version: 1,
  name: 'sign-in with retry',
  feature: 'auth',
  requirement: [
    { id: 's1', text: 'A visitor signs in with an email and a password.' },
    { id: 's3', text: 'If the credentials are valid, the visitor is signed in and taken to their dashboard.' },
    { id: 's6', text: 'The sign-in page must load in under two seconds.' },
  ],
  outOfScope: [{ req: 's6', reason: 'A performance budget, not machine behaviour.' }],
  states: [
    { id: 'idle', initial: true, description: 'The form is shown and editable.', req: ['s1'] },
    { id: 'signedIn', final: true, description: 'The visitor has a session and is on the dashboard.', req: ['s3'] },
  ],
  events: [{ id: 'SUBMIT', payload: '{ email: string; password: string }', req: ['s1'] }],
  transitions: [{ id: 't1', from: 'idle', to: 'signedIn', event: 'SUBMIT', req: ['s1', 's3'] }],
  functions: [
    {
      name: 'verifyCredentials',
      input: '{ email: string; password: string }',
      output: 'Promise<{ ok: boolean }>',
      precondition: 'email and password are both non-empty strings.',
      postcondition: 'Resolves { ok: true } when the pair matches an account.',
      req: ['s1', 's3'],
    },
  ],
  types: [],
};

test.describe.serial('Spec breakdown screen (#748)', () => {
  let project;
  let restore;

  test.beforeAll(async () => {
    project = makeBrowseProject('og748-spec-');
    fs.mkdirSync(path.join(project.repo, 'specs'), { recursive: true });
    fs.writeFileSync(path.join(project.repo, SPEC_FILE), JSON.stringify(SPEC, null, 2));
    restore = await openProject(API, project.repo);
  });
  test.afterAll(async () => {
    await restore?.();
    project?.remove();
  });

  test('an accepted spec renders as a table next to the read-back, with a per-sentence account of the original requirement', async ({ page }) => {
    await gotoCockpit(page, `/spec-breakdown?file=${encodeURIComponent(SPEC_FILE)}`);
    await expect(page.getByTestId('sb-violations')).toHaveCount(0);

    await expect(page.locator('[data-testid="sb-row"][data-row-id="idle"]')).toBeVisible();
    await expect(page.locator('[data-testid="sb-row"][data-row-id="SUBMIT"]')).toBeVisible();
    await expect(page.locator('[data-testid="sb-row"][data-row-id="t1"]')).toBeVisible();
    const fnRow = page.locator('[data-testid="sb-row"][data-row-id="verifyCredentials"]');
    await expect(fnRow).toBeVisible();
    await expect(fnRow.getByTestId('sb-view-code')).toBeDisabled(); // nothing generated yet
    await expect(fnRow.getByTestId('sb-fill-ai')).toBeEnabled();

    await expect(page.getByTestId('sb-readback-summary')).not.toHaveText('');
    const sentences = page.getByTestId('sb-sentence');
    await expect(sentences).toHaveCount(3);
    await expect(page.locator('[data-testid="sb-sentence"][data-status="out-of-scope"]')).toContainText('load in under two seconds');
    await expect(page.getByTestId('sb-coverage')).toContainText('2 covered, 1 out of scope');
  });

  test('golden path: approve a spec, see it generate real files', async ({ page }) => {
    await gotoCockpit(page, `/spec-breakdown?file=${encodeURIComponent(SPEC_FILE)}`);
    await page.getByTestId('sb-generate').click();
    await expect(page.getByTestId('sb-generate-result')).toContainText('file(s) written');

    const serviceFile = path.join(project.repo, 'features/auth/services/verifyCredentials.ts');
    await expect.poll(() => fs.existsSync(serviceFile)).toBe(true);
    expect(fs.readFileSync(serviceFile, 'utf8')).toContain('verifyCredentials');

    // View/edit code is now enabled for the generated function and shows the real file.
    const fnRow = page.locator('[data-testid="sb-row"][data-row-id="verifyCredentials"]');
    await expect(fnRow.getByTestId('sb-view-code')).toBeEnabled();
    await fnRow.getByTestId('sb-view-code').click();
    await expect(page.getByTestId('sb-code-view-source')).toContainText('verifyCredentials');
    await page.getByTestId('sb-code-view-close').click();
    await expect(page.getByTestId('sb-code-view')).toHaveCount(0);
  });
});
