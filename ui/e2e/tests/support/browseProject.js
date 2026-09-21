import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// A REAL throwaway git project for the Features / Pages / Components screen specs (#431): the impact-shared fixture
// (three features across all seven layers, a shared feature, routes), plus components that exercise the props reader
// (documented props, none, a syntax error), a workflow machine and a test file. Nothing is mocked; the Cockpit server
// reads it like any project.
const FIXTURE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../fixtures/impact-shared');

export const SUMMARY_PATH = 'features/billing/components/BillingSummary.tsx';
export const PLAIN_PATH = 'features/billing/components/Plain.tsx';
export const BROKEN_PATH = 'features/billing/components/Broken.tsx';

const SUMMARY = `type BillingSummaryProps = {
  /** Amount to show, in whole units. */
  total: number;
  /** Heading above the amount. */
  label?: string;
  onStart: () => void;
};

/** A one-line summary of a bill. */
export function BillingSummary({ total, label = 'Total', onStart }: BillingSummaryProps) {
  return (
    <p>
      {label}: {total} <button onClick={onStart}>Start</button>
    </p>
  );
}
`;

const FLOW = `import { setup } from 'xstate';

export const SignupFlow = setup({}).createMachine({
  id: 'signupFlow',
  initial: 'idle',
  states: {
    idle: { on: { SUBMIT: 'pending' } },
    pending: { on: { OK: 'success', FAIL: 'rejected' } },
    rejected: { on: { OVERRIDE: 'success' } },
    success: { type: 'final' },
  },
});
`;

export function makeBrowseProject(prefix = 'og431-') {
  const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  fs.cpSync(FIXTURE, repo, { recursive: true });
  const write = (rel, text) => {
    fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true });
    fs.writeFileSync(path.join(repo, rel), text);
  };
  write(SUMMARY_PATH, SUMMARY);
  write(PLAIN_PATH, 'export function Plain() {\n  return <i />;\n}\n');
  write(BROKEN_PATH, 'export function Broken( {\n  return <b />;\n\nconst = ;\n');
  write('features/billing/workflows/SignupFlow.ts', FLOW);
  write('features/billing/tests/billing.spec.ts', "import { test } from '@playwright/test';\ntest('billing shows a total', async () => {});\n");
  const git = (...args) => execFileSync('git', ['-c', 'user.name=e2e', '-c', 'user.email=e2e@example.invalid', '-c', 'commit.gpgsign=false', ...args], { cwd: repo, encoding: 'utf8' });
  git('init', '-q', '-b', 'main');
  git('add', '-A');
  git('commit', '-q', '-m', 'base');
  return { repo, git, read: (rel) => fs.readFileSync(path.join(repo, rel), 'utf8'), remove: () => fs.rmSync(repo, { recursive: true, force: true }) };
}

/** Opens `repo` as the Cockpit's project (through the same API a person's choice takes) and returns a restore function.
 * Plain fetch, not Playwright's `request` fixture: a beforeAll fixture cannot be reused from afterAll. */
export async function openProject(apiBase, repo) {
  const post = (projectDir) => fetch(`${apiBase}/api/settings`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectDir }) });
  const original = (await (await fetch(`${apiBase}/api/settings`)).json()).projectDir;
  await post(repo);
  return async () => {
    if (original) await post(original);
  };
}
