// #620, #626 -- what the full-path tests of the screen shapes share (test/detail-shape-chain.test.mjs, test/form-shape-chain.test.mjs, test/dashboard-shape-chain.test.mjs, test/wizard-shape-chain.test.mjs; the list
// shape's own test, test/list-shape-chain.test.mjs, predates it and keeps its copy): a fresh `construct init` project with the typed-contracts
// phase 1 rules ON and its imports linked offline, the plan of a sentence with the shape offer answered by the rules provider, and the plan run
// command by command through the CLI, exactly as the plan runner would.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseRequirement } from '../packages/core/requirement-card.mjs';
import { placeCard, planFromBlocks } from '../packages/core/placement.mjs';
import { planToCommand, validatePlan } from '../packages/core/plan.mjs';
import { suggest } from '../packages/core/decision-provider.mjs';
import { makeTempDir } from './tmpdir.mjs';

/** The repository root. */
export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bin = path.join(REPO, 'packages', 'cli', 'construct.mjs');

/** Runs the `construct` CLI in `cwd`: `{ status, stdout, stderr }`. */
export const run = (args, cwd) => spawnSync(process.execPath, [bin, ...args], { encoding: 'utf8', cwd });

const firstExisting = (...candidates) => candidates.find((p) => fs.existsSync(p));

/** Whether react, react-dom, esbuild and typescript are installed here (a CI lane with only the root install has no react-dom: it lives in ui/client). */
export const HAVE_RUNTIME = ['react', 'react-dom'].every((n) => firstExisting(path.join(REPO, 'node_modules', n), path.join(REPO, 'ui', 'client', 'node_modules', n)))
  && ['typescript', 'esbuild', '@esbuild', '@types'].every((n) => fs.existsSync(path.join(REPO, 'node_modules', n)));

/** Whether xstate is installed here too (the wizard shape's workflow, hook and proof import it). */
export const HAVE_XSTATE = HAVE_RUNTIME && fs.existsSync(path.join(REPO, 'node_modules', 'xstate'));

/** The `node:test` options that skip the full-path test of the wizard shape, with the reason, in a lane without react, react-dom, esbuild, typescript and xstate. */
export const NEEDS_WIZARD_RUNTIME = { skip: HAVE_XSTATE ? false : 'react, react-dom, esbuild, typescript and xstate are not installed here (a lane with only the root install); the full checkout runs this' };

/** The `node:test` options that skip a full-path test, with the reason, in a lane without the runtime. */
export const NEEDS_RUNTIME = { skip: HAVE_RUNTIME ? false : 'react, react-dom, esbuild and typescript are not installed here (a lane with only the root install); the full checkout runs this' };

const PHASE_1_ON = ['DOMAIN-002', 'READ-004', 'SERVICE-003', 'STATE-001'];

/** A fresh init project (`react-spa` or `nextjs`) whose architecture.yml has the typed-contracts phase 1 rules on, and whose imports resolve offline. */
export function initProject(framework, label = 'shape') {
  const dir = makeTempDir(`construct-${label}-${framework}-`);
  assert.equal(run(['init', '--framework', framework], dir).status, 0);
  const yml = path.join(dir, 'architecture.yml');
  let text = fs.readFileSync(yml, 'utf8');
  for (const rule of PHASE_1_ON) {
    assert.match(text, new RegExp(`^  ${rule}: off$`, 'm'), `${rule} is off by default`);
    text = text.replace(new RegExp(`^  ${rule}: off$`, 'm'), `  ${rule}: error`);
  }
  fs.writeFileSync(yml, text);
  const modules = path.join(dir, 'node_modules');
  fs.mkdirSync(path.join(modules, '@line'), { recursive: true });
  const link = (name, target) => fs.symlinkSync(target, path.join(modules, name));
  link('react', firstExisting(path.join(REPO, 'node_modules', 'react'), path.join(REPO, 'ui', 'client', 'node_modules', 'react')));
  link('react-dom', firstExisting(path.join(REPO, 'node_modules', 'react-dom'), path.join(REPO, 'ui', 'client', 'node_modules', 'react-dom')));
  link('typescript', path.join(REPO, 'node_modules', 'typescript'));
  link('esbuild', path.join(REPO, 'node_modules', 'esbuild'));
  link('@esbuild', path.join(REPO, 'node_modules', '@esbuild'));
  link('@types', path.join(REPO, 'node_modules', '@types'));
  if (HAVE_XSTATE) link('xstate', path.join(REPO, 'node_modules', 'xstate'));
  if (HAVE_XSTATE && fs.existsSync(path.join(REPO, 'node_modules', '@xstate', 'graph'))) link('@xstate', path.join(REPO, 'node_modules', '@xstate'));
  link('@line/construct-core', path.join(REPO, 'packages', 'core'));
  return dir;
}

/**
 * The plan for a sentence, with the shape offer answered by the built-in rules provider (the default), as a person would confirm it.
 *
 * @param {string} dir The init project.
 * @param {string} sentence The requirement sentence.
 * @param {string} feature The feature the plan creates.
 * @param {string} shape The shape the rules-only default must be.
 * @param {string | null} [source] The answer to `q-source` (#621), `endpoint` by default (what these chain tests were written against); `null` leaves it unanswered, so the rules-only default (openapi with a matching spec, else local) applies.
 * @param {{ card?: boolean, answers?: Record<string, unknown> }} [extra] `card: true` hands the requirement card to `planFromBlocks` (it raises the questions that read it: `q-access`, `q-state`, `q-env`) and `answers` are more answers to the plan's questions.
 * @returns {Promise<{ placed: object, planned: object, offer: object }>} The placement, the plan and the offer as made.
 */
export async function planFor(dir, sentence, feature, shape, source = 'endpoint', extra = {}) {
  const { card } = parseRequirement(sentence);
  const config = { framework: JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).dependencies?.next ? 'nextjs' : 'react-spa' };
  const first = placeCard(card, config);
  assert.equal(first.complete, true);
  const [offer] = first.offers;
  const suggestion = await suggest({ id: offer.id, question: offer.question, options: offer.options });
  assert.equal(suggestion.option, shape, `the rules-only default is the ${shape} shape`);
  const placed = placeCard(card, { ...config, answers: { [offer.id]: { option: suggestion.option, by: 'decision-model', provider: suggestion.provider } } });
  assert.deepEqual(placed.errors, []);
  const answers = { ...(source === null ? {} : { 'q-source': { option: source, by: 'person' } }), ...(extra.answers ?? {}) };
  const planned = planFromBlocks(placed.blocks, { feature, root: dir, title: sentence, decisions: placed.decisions, answers, ...(extra.card ? { card } : {}) });
  assert.equal(planned.ok, true, JSON.stringify(planned.errors));
  assert.deepEqual(validatePlan(planned.plan), { valid: true, errors: [] });
  return { placed, planned, offer };
}

/**
 * The verification steps (#632) answer with a CLASSIFIED result and an exit code of 1 when they found a problem: on these offline fixtures (no react-router-dom, no vite)
 * the type-check honestly finds missing imports, so the runner of the tests takes a classified failure as the step's answer, not as a crash.
 */
export const CHECK_FLOWS = Object.freeze(['check.types', 'check.build']);

/** What the plan runner does with a plan: each step's own command, through the CLI, in the project. */
export function execute(dir, plan) {
  for (const step of plan.steps) {
    const { argv } = planToCommand(step);
    const res = run(argv, dir);
    if (CHECK_FLOWS.includes(step.flow)) {
      assert.match(res.stdout, /^(Type-check|Build): /, `${step.id} ${argv.join(' ')}: a classified result, not a raw log\n${res.stdout}\n${res.stderr}`);
      continue;
    }
    assert.equal(res.status, 0, `${step.id} ${argv.join(' ')}\n${res.stdout}\n${res.stderr}`);
  }
}

/** The files under `features/` with their text, by project-relative path. */
export const featureFiles = (dir) => Object.fromEntries(fs.readdirSync(path.join(dir, 'features'), { recursive: true }).filter((f) => fs.statSync(path.join(dir, 'features', f)).isFile()).sort().map((f) => [`features/${f}`, fs.readFileSync(path.join(dir, 'features', f), 'utf8')]));

/** Every file of the project (not node_modules) with its text, to tell what a run changed. */
export const projectFiles = (dir) => Object.fromEntries(fs.readdirSync(dir, { recursive: true }).filter((f) => !/^node_modules(\/|$)/.test(f) && fs.statSync(path.join(dir, f)).isFile()).sort().map((f) => [f.split(path.sep).join('/'), fs.readFileSync(path.join(dir, f), 'utf8')]));

/** `construct validate --format json` in the project, parsed. */
export const validateJson = (dir) => JSON.parse(run(['validate', '--format', 'json'], dir).stdout);

/**
 * `tsc --noEmit` on the features, the route entry and the offline stand-ins for the two modules this fixture has not installed.
 *
 * @param {string} dir The init project.
 * @param {string[]} include Extra files to type-check besides `features` (the route entry).
 * @returns {{ status: number | null, output: string }} The exit status and everything tsc printed.
 */
export function typeCheck(dir, include) {
  fs.writeFileSync(path.join(dir, 'offline-types.d.ts'), "declare module 'react-dom/server';\ndeclare module 'react-router-dom';\n");
  fs.writeFileSync(path.join(dir, 'tsconfig.check.json'), JSON.stringify({ extends: './tsconfig.json', compilerOptions: { types: ['node'], plugins: [], incremental: false }, include: ['features', ...include, 'offline-types.d.ts'] }));
  const tsc = spawnSync(process.execPath, [path.join(dir, 'node_modules', 'typescript', 'bin', 'tsc'), '--noEmit', '-p', 'tsconfig.check.json'], { encoding: 'utf8', cwd: dir });
  return { status: tsc.status, output: `${tsc.stdout}${tsc.stderr}` };
}

/** A fresh `construct init` project (react-spa or nextjs) with one feature, `shop`, ready for a shape (nothing linked: for tests that only generate). */
export function shapeProject(framework = 'react-spa') {
  const dir = makeTempDir('construct-shape2-');
  assert.equal(run(['init', '--framework', framework], dir).status, 0);
  assert.equal(run(['create', 'feature', 'shop'], dir).status, 0);
  return dir;
}

/** The files under `features/` with their text, by project-relative path (to tell that nothing was written). */
export const featureTree = (dir) => Object.fromEntries(fs.readdirSync(dir, { recursive: true }).filter((f) => f.startsWith('features') && fs.statSync(path.join(dir, f)).isFile()).sort().map((f) => [f, fs.readFileSync(path.join(dir, f), 'utf8')]));

/** The card of a sentence. */
export const cardOf = (text) => parseRequirement(text).card;

/** `placeCard` for a sentence on a react-spa project, with the given options (answers and so on). */
export const placed = (text, options = {}) => placeCard(cardOf(text), { framework: 'react-spa', ...options });
