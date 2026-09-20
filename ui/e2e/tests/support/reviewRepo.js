import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// A REAL throwaway git repository for the Review specs (#351): the impact-shared fixture on `main`, a
// `feat/billing-totals` branch that touches two features across four layers, and a README-only
// `docs/readme` branch. Nothing is mocked; the Cockpit server reads it like any project.
const FIXTURE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../fixtures/impact-shared');

const FLOW_BASE = `import { setup } from 'xstate';

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

export function makeReviewRepo(prefix = 'og351-review-') {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  fs.cpSync(FIXTURE, repo, { recursive: true });
  const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' });
  const write = (rel, text) => {
    fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true });
    fs.writeFileSync(path.join(repo, rel), text);
  };
  const commit = (msg) => { git('add', '-A'); git('commit', '-q', '-m', msg); };
  write('features/billing/workflows/SignupFlow.ts', FLOW_BASE);
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'e2e@example.com');
  git('config', 'user.name', 'E2E');
  git('config', 'commit.gpgsign', 'false');
  commit('base');
  git('checkout', '-q', '-b', 'feat/billing-totals');
  write('features/billing/domain/billingRules.ts', '// Pure billing rules: no I/O, no framework.\nexport function totalBilling(lines: number[]): number {\n  return lines.reduce((a, b) => a + b, 0) + 0;\n}\n');
  write('features/billing/services/billingService.ts', `${fs.readFileSync(path.join(repo, 'features/billing/services/billingService.ts'), 'utf8')}// touched\n`);
  write('features/checkout/domain/checkoutRules.ts', `${fs.readFileSync(path.join(repo, 'features/checkout/domain/checkoutRules.ts'), 'utf8')}// isolated\n`);
  write('features/billing/workflows/SignupFlow.ts', FLOW_BASE.replace("rejected: { on: { OVERRIDE: 'success' } },", "rejected: { type: 'final' },"));
  write('features/billing/pages/Leaky.tsx', "import { fetchBilling } from '../services/billingService';\nexport function Leaky() { fetchBilling(); return <div />; }\n");
  commit('Billing totals, checkout rules and a signup flow change');
  git('checkout', '-q', 'main');
  git('checkout', '-q', '-b', 'docs/readme');
  write('README.md', '# Shop\n\nA few more words about the shop.\n');
  commit('Explain the shop in the README');
  git('checkout', '-q', 'main');
  /** Everything a read-only feature must leave byte-identical. */
  const snapshot = () => ({
    status: git('status', '--porcelain=v2', '--untracked-files=all'),
    worktrees: git('worktree', 'list', '--porcelain'),
    refs: git('for-each-ref', '--format=%(refname) %(objectname)'),
    stash: git('stash', 'list'),
  });
  return { repo, git, snapshot };
}
