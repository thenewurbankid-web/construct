/**
 * A REAL `construct init` project for the proof of a screen (#653), shared by the Requirement proof route test (ui/server) and its
 * Playwright spec (ui/e2e). Nothing is mocked: `applyPlan` runs each step of a plan through its own command (`planToCommand`, run
 * with the real CLI), exactly what the process runner does once a person has approved the files, so the project then holds the
 * generated screen and its locked proof.
 *
 * Offline: the project has no node_modules of its own, so it links this checkout's (react, react-dom, typescript, esbuild for the
 * proof runner, and `@line/construct-core` for the factories the generated units import).
 */
import { spawnSync, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { planToCommand } from '../packages/core/plan.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(REPO, 'packages', 'cli', 'construct.mjs');
const PHASE_1_ON = ['DOMAIN-002', 'READ-004', 'SERVICE-003', 'STATE-001'];
const firstExisting = (...candidates) => candidates.find((p) => fs.existsSync(p));
const cli = (args, cwd) => spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8', cwd });

/** The branch of the generated expression that draws the empty state. Removing it is "a deliberately broken page". */
export const EMPTY_BRANCH = "  if (state.items.length === 0) return <>{children}</>;\n";
export const EXPRESSION_PATH = 'features/products/expressions/ProductsByStatus.expression.tsx';

/**
 * A fresh project: `construct init`, the typed-contracts phase 1 rules on, the modules linked, and (with `git`) a first commit.
 *
 * @param {{ prefix?: string, git?: boolean }} [options] Folder name prefix; `git: true` makes it a git repository with one commit (the Cockpit opens repositories).
 * @returns {{ root: string, applyPlan: (plan: object) => void, editExpression: (from: string, to: string) => void, breakEmptyState: () => void, fixEmptyState: () => void, read: (rel: string) => string, remove: () => void }} The project and what to do with it.
 */
export function makeProofProject({ prefix = 'og653-', git = false } = {}) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  const init = cli(['init', '--framework', 'react-spa'], root);
  if (init.status !== 0) throw new Error(`construct init failed: ${init.stdout}${init.stderr}`);
  const yml = path.join(root, 'architecture.yml');
  let text = fs.readFileSync(yml, 'utf8');
  for (const rule of PHASE_1_ON) text = text.replace(new RegExp(`^  ${rule}: off$`, 'm'), `  ${rule}: error`);
  fs.writeFileSync(yml, text);
  const modules = path.join(root, 'node_modules');
  fs.mkdirSync(path.join(modules, '@line'), { recursive: true });
  const link = (name, target) => fs.symlinkSync(target, path.join(modules, name));
  link('react', firstExisting(path.join(REPO, 'node_modules', 'react'), path.join(REPO, 'ui', 'client', 'node_modules', 'react')));
  link('react-dom', firstExisting(path.join(REPO, 'node_modules', 'react-dom'), path.join(REPO, 'ui', 'client', 'node_modules', 'react-dom')));
  link('typescript', path.join(REPO, 'node_modules', 'typescript'));
  link('esbuild', path.join(REPO, 'node_modules', 'esbuild'));
  link('@esbuild', path.join(REPO, 'node_modules', '@esbuild'));
  link('@types', path.join(REPO, 'node_modules', '@types'));
  link('@line/construct-core', path.join(REPO, 'packages', 'core'));
  if (git) {
    fs.writeFileSync(path.join(root, '.gitignore'), 'node_modules\n');
    const run = (...args) => execFileSync('git', ['-c', 'user.name=e2e', '-c', 'user.email=e2e@example.invalid', '-c', 'commit.gpgsign=false', ...args], { cwd: root, encoding: 'utf8' });
    run('init', '-q', '-b', 'main');
    run('add', '-A');
    run('commit', '-q', '-m', 'base');
  }
  const editExpression = (from, to) => {
    const file = path.join(root, EXPRESSION_PATH);
    const source = fs.readFileSync(file, 'utf8');
    if (!source.includes(from)) throw new Error(`${EXPRESSION_PATH} does not contain the text to replace`);
    fs.writeFileSync(file, source.replace(from, to));
  };
  let whole = null;
  return {
    root,
    /** Every step of the plan through its own command, in order. */
    applyPlan(plan) {
      for (const step of plan.steps) {
        const { argv } = planToCommand(step);
        const res = cli(argv, root);
        if (res.status !== 0) throw new Error(`${step.id} ${argv.join(' ')}\n${res.stdout}\n${res.stderr}`);
      }
    },
    editExpression,
    breakEmptyState() {
      whole = fs.readFileSync(path.join(root, EXPRESSION_PATH), 'utf8');
      editExpression(EMPTY_BRANCH, '');
    },
    fixEmptyState() {
      if (whole !== null) fs.writeFileSync(path.join(root, EXPRESSION_PATH), whole);
    },
    read: (rel) => fs.readFileSync(path.join(root, rel), 'utf8'),
    remove: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

/**
 * Whether this checkout has what a proof needs to RUN (react, react-dom, typescript, esbuild). A CI lane with only the root
 * install has no react-dom (it lives in ui/client), so the tests that build a real project skip there with a reason.
 *
 * @returns {boolean} `true` when a proof project can be built and run here.
 *
 * @example
 * if (!proofRuntimeAvailable()) console.log(PROOF_RUNTIME_MISSING);
 */
export function proofRuntimeAvailable() {
  const at = (n) => firstExisting(path.join(REPO, 'node_modules', n), path.join(REPO, 'ui', 'client', 'node_modules', n));
  return ['react', 'react-dom', 'esbuild', '@esbuild', 'typescript', '@types'].every((n) => at(n));
}

/** Why a proof test skipped: the words the skip carries. */
export const PROOF_RUNTIME_MISSING = 'react, react-dom, esbuild and typescript are not installed here (a lane with only the root install); the full checkout runs this';

