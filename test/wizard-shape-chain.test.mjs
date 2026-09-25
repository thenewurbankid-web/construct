// #628 -- the whole Requirement chain for the WIZARD shape, run for real: the sentence "A user wants a step by step signup" goes through
// parseRequirement, placeCard (a flow worded as steps is offered wizard | scaffold; the rules provider suggests wizard), planFromBlocks, and the
// plan's own commands (planToCommand, run through the CLI) in a fresh `construct init` project with the typed-contracts phase 1 rules ON (and
// WORKFLOW-004, which every state of the machine satisfies). Then: `construct validate` reports no error and no warning, `tsc --noEmit` passes,
// the proof RUNS green (`construct test proof`: every transition path of the XState machine walked without a browser, the page showing the step of
// the state, the service), and a deliberately broken guard, machine and step make it FAIL with a message that names the transition and the state.
// A second run in a fresh project writes the same bytes. Same guard as test/list-shape-chain.test.mjs: a lane without react-dom or xstate skips
// with the reason. The data source is `endpoint` here (the first test), `local` and `openapi` follow.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { proofStatus } from '../packages/core/proof.mjs';
import { planTouches } from '../packages/core/plan.mjs';
import { NEEDS_WIZARD_RUNTIME as NEEDS_RUNTIME, execute, featureFiles, initProject, planFor, projectFiles, run, typeCheck, validateJson } from '../test-utils/shapeChain.mjs';

const SENTENCE = 'A user wants a step by step signup';
const FEATURE = 'features/signup';
const FIELDS = 'id:string,name:string';
const plan = (dir, source = 'endpoint') => planFor(dir, SENTENCE, 'signup', 'wizard', source);
const TITLES = ['Create feature signup', 'Create domain Signup', 'Create service Signup', 'Create workflow Signup', 'Create hook Signup', 'Create component Signup', 'Create page Signup', 'Create controller Signup', 'Add @line/construct-core to package.json', "Export the signup feature's public API (sync)", 'Wire the Signup screen into the route entry (/signup)', 'Prove the Signup screen', 'Run the proof of Signup'];
const PROOF_TITLES = ['machine: it starts at the first step with nothing typed', 'machine: its states are the steps of the domain unit, then submitting and submitted', 'machine: NEXT is blocked while the step is invalid, and goes on once it is valid', 'machine: the whole flow with everything typed reaches the last step, and BACK goes to the step before with what was typed kept', 'machine: SUBMIT is decided only by the last step, and only when every step is valid', 'machine: a submit that succeeds is done, one that fails goes back to the last step with its message', 'machine: RESET starts again from every state, with nothing typed', 'machine: CHANGE keeps what is typed and clears an old error', 'machine: every state decides every event (the transition table)', 'domain: a step is valid when its own fields are filled, and the typed input is trimmed and numeric', 'screen: each step shows itself, its progress, its fields and nothing of the others', 'screen: Back, Next and Submit follow the step', 'screen: the sending screen, the complete screen and a failed submit', 'controller: renders the first step first', 'service: the stubbed submit is called with the typed values', 'service: a 500 is an error result', 'service: a network failure is an error result', "service: the caller's AbortSignal reaches fetch"];

test('the sentence becomes a plan of 13 steps, runs, and gives a wizard that validates, type-checks, runs a real state machine and is PROVEN', NEEDS_RUNTIME, async (t) => {
  const dir = initProject('react-spa', 'wizard');
  const { placed, planned, offer } = await plan(dir);
  assert.deepEqual(offer.options.map((o) => o.id), ['wizard', 'scaffold'], 'a flow worded as steps is offered wizard | scaffold');
  assert.deepEqual([offer.shape, offer.default, offer.unit, offer.entity, offer.fields, offer.steps], ['wizard', 'wizard', 'Signup', 'Signup', FIELDS, 'details,review,done']);
  assert.deepEqual(placed.decisions, [{ question: 'q-shape', option: 'wizard', by: 'decision-model', provider: 'rules' }], 'who decided is recorded');
  assert.deepEqual(planned.plan.steps.map((s) => s.title), TITLES);
  assert.deepEqual(planned.plan.steps.slice(1, 8).map((s) => [s.args.layer, s.args.shape, s.args.entity, s.args.fields, s.args.steps]), ['domain', 'service', 'workflow', 'hook', 'component', 'page', 'controller'].map((l) => [l, 'wizard', 'Signup', FIELDS, 'details,review,done']), 'every unit carries the shape and its steps, the workflow layer included');
  assert.deepEqual(planned.wiring, { dependency: 's9', sync: 's10', routes: [{ name: 'Signup', route: '/signup', step: 's11', file: 'src/App.tsx' }] }, 'the wiring step applies to a wizard plan too');
  assert.deepEqual(planned.proof.steps, [{ name: 'Signup', kind: 'render', proofStep: 's12', verifiedBy: 's13' }]);
  assert.match(planned.plan.steps[12 - 1].args.steps, /details,review,done/, 'the proof step carries the steps');

  const before = projectFiles(dir);
  execute(dir, planned.plan);
  const written = featureFiles(dir);
  const declared = planTouches(planned.plan).files.map((f) => f.path).sort();
  const after = projectFiles(dir);
  assert.deepEqual(Object.keys(after).filter((f) => after[f] !== before[f]).sort(), declared, 'every file the commands created or changed is a file the plan declared: nothing was done by hand');
  assert.equal(declared.length, 23, 'index.ts, the seventeen files of the shape (types.ts among them), the proof, architecture.yml, package.json, .dependency-cruiser.cjs and src/App.tsx');

  await t.test('the files it wrote', () => {
    const files = Object.keys(written).filter((f) => f.startsWith(`${FEATURE}/`)).map((f) => f.slice(FEATURE.length + 1));
    assert.deepEqual(files.filter((f) => f !== 'index.ts').sort(), ['components/SignupAgain.component.tsx', 'components/SignupDetailsStep.component.tsx', 'components/SignupDoneStep.component.tsx', 'components/SignupField.component.tsx', 'components/SignupFrame.component.tsx', 'components/SignupNotice.component.tsx', 'components/SignupReviewStep.component.tsx', 'controllers/SignupController.controller.tsx', 'domain/Signup.domain.ts', 'domain/SignupScreen.domain.ts', 'domain/SignupValidity.domain.ts', 'expressions/SignupByStep.expression.tsx', 'hooks/useSignup.state.ts', 'pages/SignupPage.page.tsx', 'services/Signup.service.ts', 'tests/generated/SignupScreen.proof.test.ts', 'types.ts', 'workflows/Signup.workflow.ts']);
    assert.ok(Object.values(written).every((c) => !/\bTODO\b/.test(c)), 'no stub is left to fill');
    const at = (f) => written[`${FEATURE}/${f}`];
    assert.match(at('workflows/Signup.workflow.ts'), /export const signupMachine = setup\(\{/);
    assert.match(at('workflows/Signup.workflow.ts'), /defineWorkflow<Record<string, never>>\('SignupWorkflow'/);
    assert.match(at('workflows/Signup.workflow.ts'), /NEXT: \{ guard: \{ type: 'stepIsValid', params: \{ step: 'details' \} \}, target: 'review' \}/);
    assert.match(at('workflows/Signup.workflow.ts'), /SUBMIT: \{ guard: 'everyStepIsValid', target: 'submitting' \}/);
    assert.doesNotMatch(at('workflows/Signup.workflow.ts'), /from 'react/, 'a workflow imports no React');
    assert.match(at('hooks/useSignup.state.ts'), /useTrackedState\('signup', INITIAL\)/);
    assert.match(at('hooks/useSignup.state.ts'), /getNextSnapshot\(signupMachine, current, event\)/);
    assert.match(at('domain/SignupValidity.domain.ts'), /name: values\.name\.trim\(\) !== ''/);
    assert.match(at('services/Signup.service.ts'), /method: 'POST'.*body: JSON\.stringify\(input\), signal/);
    assert.match(at('components/SignupDetailsStep.component.tsx'), /<input id="signup-name" name="name" type="text"/);
    assert.match(at('components/SignupReviewStep.component.tsx'), /<dt>Name<\/dt>/);
    assert.match(at('pages/SignupPage.page.tsx'), /definePage</);
    assert.match(at('expressions/SignupByStep.expression.tsx'), /defineExpression</);
    assert.match(at('controllers/SignupController.controller.tsx'), /defineController</);
    assert.match(at('types.ts'), /export type SignupStep = 'details' \| 'review' \| 'done';/);
    assert.match(at('types.ts'), /export interface SignupValues \{\n {2}name: string;\n\}/);
  });

  await t.test('the route entry and the barrel were wired by the plan', () => {
    assert.match(fs.readFileSync(path.join(dir, 'src', 'App.tsx'), 'utf8'), /<Route path="\/signup" element=\{<SignupController \/>\} \/>/);
    assert.match(fs.readFileSync(path.join(dir, 'features', 'signup', 'index.ts'), 'utf8'), /SignupController/);
  });

  await t.test('construct validate: no error and no warning, with the phase 1 rules on', () => {
    const report = validateJson(dir);
    assert.deepEqual(report.violations.map((v) => `${v.severity} ${v.rule} ${v.file}`), []);
    assert.equal(report.status, 'passed');
  });

  await t.test('WORKFLOW-004 too: every state of the machine decides every event it handles', () => {
    const yml = path.join(dir, 'architecture.yml');
    const text = fs.readFileSync(yml, 'utf8');
    assert.match(text, /^  WORKFLOW-004: off$/m, 'off by default');
    fs.writeFileSync(yml, text.replace(/^  WORKFLOW-004: off$/m, '  WORKFLOW-004: error'));
    try {
      assert.deepEqual(validateJson(dir).violations.map((v) => `${v.severity} ${v.rule} ${v.file}`), []);
    } finally {
      fs.writeFileSync(yml, text);
    }
  });

  await t.test('tsc --noEmit passes on the features (the proof included) and the route entry', () => {
    const tsc = typeCheck(dir, ['src/App.tsx']);
    assert.equal(tsc.status, 0, tsc.output);
  });

  const proofRun = (name) => run(['test', 'proof', 'signup', '--format', 'json', ...(name ? ['--name', name] : [])], dir);

  await t.test('the proof passes: node --test on the machine and the screen, no browser, and the chain is complete', () => {
    const res = proofRun();
    assert.equal(res.status, 0, `${res.stdout}${res.stderr}`);
    const result = JSON.parse(res.stdout);
    assert.deepEqual(result.counts, { total: PROOF_TITLES.length, passed: PROOF_TITLES.length, failed: 0, notRun: 0 });
    assert.deepEqual(result.tests.map((x) => x.title.replace(/^Signup /, '')), PROOF_TITLES);
    assert.deepEqual(result.chain, proofStatus([{ id: 'proof', result: { ok: true, counts: result.counts } }]));
    assert.equal(result.chain.complete, true);
  });

  await t.test('the proof file: locked, named Name.layer.ext, from the steps and fields, and a person can read it', () => {
    const file = path.join(dir, 'features', 'signup', 'tests', 'generated', 'SignupScreen.proof.test.ts');
    const text = fs.readFileSync(file, 'utf8');
    assert.ok(text.startsWith('// @construct-generated tests v1 - LOCKED, do not edit (#348)\n'));
    for (const want of ['const STEPS: SignupStep[] = ["details", "review", "done"];', '["details", "NEXT", "empty", "details"]', '["details", "NEXT", "valid", "review"]', '["done", "SUBMIT", "valid", "submitting"]', '["submitting", "FAILED", "valid", "done"]', 'every state decides every event', "getNextSnapshot(signupMachine, snapshot, event)", '--steps details,review,done']) assert.ok(text.includes(want), want);
    const gen = run(['create', 'proof', 'Signup', '--feature', 'signup', '--shape', 'wizard', '--entity', 'Signup', '--fields', FIELDS, '--steps', 'details,review,done'], dir);
    assert.equal(gen.status, 0, `${gen.stdout}${gen.stderr}`);
    assert.equal(fs.readFileSync(file, 'utf8'), text, 'regenerating writes the same bytes');
  });

  await t.test('a broken guard, machine or screen FAILS the proof, and the message names the transition and the state that is wrong', () => {
    const feature = path.join(dir, 'features', 'signup');
    const validity = path.join(feature, 'domain', 'SignupValidity.domain.ts');
    const workflow = path.join(feature, 'workflows', 'Signup.workflow.ts');
    const expression = path.join(feature, 'expressions', 'SignupByStep.expression.tsx');
    const frame = path.join(feature, 'components', 'SignupFrame.component.tsx');
    const cases = [
      // The guard lets an unfilled step through: NEXT goes on with nothing typed.
      { file: validity, from: '.every((field) => filled[field])', to: '.every(() => true)', titles: ['Signup machine: NEXT is blocked while the step is invalid, and goes on once it is valid', 'Signup machine: every state decides every event (the transition table)'], state: ['details', 'review'], summary: 'The transition NEXT from "details" with nothing typed: the "details" state is wrong, the machine reaches "review".' },
      // SUBMIT is decided by the first step too.
      { file: workflow, from: "        SUBMIT: {},\n        RESET: { actions: 'reset' },", to: "        SUBMIT: 'submitting',\n        RESET: { actions: 'reset' },", titles: ['Signup machine: SUBMIT is decided only by the last step, and only when every step is valid'], state: ['details', 'submitting'], summary: 'The transition SUBMIT from "details" (not the last step): the "details" state is wrong, the machine reaches "submitting".' },
      // A failed submit no longer goes back to the last step.
      { file: workflow, from: "FAILED: { target: 'done', actions: 'fail' }", to: "FAILED: { target: 'review', actions: 'fail' }", titles: ['Signup machine: a submit that succeeds is done, one that fails goes back to the last step with its message'], state: ['done', 'review'], summary: 'The transition FAILED from "submitting": the "done" state is wrong, the machine reaches "review".' },
      // The page shows the wrong step for the first state.
      { file: expression, from: "if (state.step === 'details')", to: "if (state.step === 'review')", titles: ['Signup screen: each step shows itself, its progress, its fields and nothing of the others'], state: ['<legend>Details</legend>', 'not shown'], summary: 'The step "details" does not show <legend>Details</legend>.' },
      // Back is shown on the first step.
      { file: frame, from: 'hidden={isFirst}', to: 'hidden={false}', titles: ['Signup screen: Back, Next and Submit follow the step'], state: ["<button type='button' hidden=''>Back</button>", 'not shown'], summary: `Back on the step "details" does not show <button type='button' hidden=''>Back</button>.` },
    ];
    for (const c of cases) {
      const good = fs.readFileSync(c.file, 'utf8');
      const broken = good.replace(c.from, c.to);
      assert.notEqual(broken, good, `the branch was there: ${c.from}`);
      fs.writeFileSync(c.file, broken);
      try {
        const res = proofRun();
        assert.equal(res.status, 1, 'exit 1: the proof ran and failed');
        const result = JSON.parse(res.stdout);
        const failed = result.tests.filter((x) => x.status === 'failed');
        assert.ok(c.titles.every((title) => failed.some((x) => x.title === title)), `${c.titles} failed: ${failed.map((x) => x.title)}`);
        const own = failed.find((x) => x.title === c.titles[0]);
        assert.equal(own.failure.kind, 'app', `the app behaved differently: not a harness problem (${c.summary}): ${own.failure.message}`);
        assert.deepEqual([own.failure.expected, own.failure.reached].slice(0, c.state.length), c.state);
        assert.equal(own.failure.summary, c.summary);
        assert.equal(result.chain.complete, false);
      } finally {
        fs.writeFileSync(c.file, good);
      }
    }
    assert.equal(proofRun().status, 0, 'and the proof is green again once the wizard is');
  });

  await t.test("the repo's own every-path generator (construct generate tests --unit, on @xstate/graph) accepts the machine too, and its test passes", { skip: fs.existsSync(path.join(dir, 'node_modules', '@xstate', 'graph')) ? false : '@xstate/graph is not installed here' }, async () => {
    const gen = run(['generate', 'tests', 'signup', '--unit'], dir);
    assert.equal(gen.status, 0, `${gen.stdout}${gen.stderr}`);
    assert.match(gen.stdout, /1 every-path test\(s\) for feature "signup" \(1 written, 0 unchanged; \d+ transition\(s\) checked\)/);
    const generated = path.join(dir, 'features', 'signup', 'tests', 'generated', 'signup--every-path.test.ts');
    const { build } = await import('esbuild');
    const bundle = path.join(dir, 'every-path.cjs');
    await build({ entryPoints: [generated], outfile: bundle, bundle: true, platform: 'node', format: 'cjs', absWorkingDir: dir, logLevel: 'silent' });
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== 'NODE_TEST_CONTEXT'));
    const res = spawnSync(process.execPath, ['--test', '--test-reporter=tap', bundle], { encoding: 'utf8', cwd: dir, env });
    assert.equal(res.status, 0, `${res.stdout}${res.stderr}`);
    assert.match(res.stdout, /every reachable state/);
    assert.match(res.stdout, /every transition/);
    fs.rmSync(generated);
    fs.rmSync(bundle);
  });

  await t.test('a file the proof binds to gone is a CONVENTION failure, not a product bug', () => {
    const machine = path.join(dir, 'features', 'signup', 'workflows', 'Signup.workflow.ts');
    fs.renameSync(machine, `${machine}.off`);
    try {
      const result = JSON.parse(proofRun().stdout);
      assert.equal(result.tests[0].failure.kind, 'convention');
      assert.match(result.tests[0].failure.selector, /Signup\.workflow/);
    } finally {
      fs.renameSync(`${machine}.off`, machine);
    }
    assert.equal(proofRun().status, 0);
  });

  await t.test('the screen renders: the first step, the last step and the complete screen', async () => {
    const { build } = await import('esbuild');
    fs.mkdirSync(path.join(dir, 'smoke'));
    fs.writeFileSync(path.join(dir, 'smoke', 'entry.tsx'), [
      "import { renderToString } from 'react-dom/server';",
      "import { SignupPage } from '../features/signup/pages/SignupPage.page';",
      "import type { SignupState } from '../features/signup/types';",
      'const noop = () => {};',
      'export const page = (state: SignupState) => renderToString(<SignupPage state={state} onChange={noop} onBack={noop} onNext={noop} onSubmit={noop} onReset={noop} />);',
    ].join('\n'));
    const reactDir = fs.realpathSync(path.join(dir, 'node_modules', 'react'));
    await build({ entryPoints: [path.join(dir, 'smoke', 'entry.tsx')], outfile: path.join(dir, 'smoke', 'entry.cjs'), bundle: true, platform: 'node', format: 'cjs', jsx: 'automatic', alias: { react: reactDir }, absWorkingDir: dir, logLevel: 'silent' });
    const screen = createRequire(import.meta.url)(path.join(dir, 'smoke', 'entry.cjs'));
    const values = { name: 'Ada' };
    const step = (name, index, extra) => ({ status: 'step', step: name, progress: `Step ${index + 1} of 3: ${name[0].toUpperCase()}${name.slice(1)}`, values, isFirst: index === 0, isLast: index === 2, valid: true, error: null, ...extra });
    const buttons = (first, last) => `<button type="button"${first ? ' hidden=""' : ''}>Back</button><button type="button"${last ? ' hidden=""' : ''}>Next</button><button type="button"${last ? '' : ' hidden=""'}>Submit</button>`;
    const frame = (progress, body, first, last) => `<main><h1>Signup</h1><form noValidate=""><p aria-live="polite">${progress}</p>${body}${buttons(first, last)}</form></main>`;
    assert.equal(screen.page(step('details', 0)), frame('Step 1 of 3: Details', '<fieldset><legend>Details</legend><div><label for="signup-name">Name</label><input id="signup-name" type="text" name="name" value="Ada"/></div></fieldset>', true, false));
    assert.equal(screen.page(step('done', 2)), frame('Step 3 of 3: Done', '<fieldset><legend>Done</legend><dl aria-label="Done: what you entered"><div><dt>Name</dt><dd>Ada</dd></div></dl></fieldset>', false, true));
    assert.equal(screen.page({ status: 'submitting', values }), '<main><h1>Signup</h1><p role="status">Sending...</p></main>');
    assert.equal(screen.page({ status: 'submitted' }), '<main><h1>Signup</h1><p role="status">Signup complete.</p><button type="button">Start again</button></main>');
  });

  await t.test('a second run in a fresh project writes the same bytes', async () => {
    const other = initProject('react-spa', 'wizard');
    const again = await plan(other);
    assert.deepEqual(again.planned.plan, planned.plan, 'the same plan');
    execute(other, again.planned.plan);
    assert.deepEqual(featureFiles(other), written, 'the proof included');
    for (const f of ['src/App.tsx', '.dependency-cruiser.cjs', 'architecture.yml']) assert.equal(fs.readFileSync(path.join(other, f), 'utf8'), fs.readFileSync(path.join(dir, f), 'utf8'), `${f} too`);
  });
});

test('the same wizard plan on a Next.js project validates too, and its hook and controller are client files', NEEDS_RUNTIME, async () => {
  const dir = initProject('nextjs', 'wizard');
  const { planned } = await plan(dir);
  assert.deepEqual(planned.wiring.routes, [{ name: 'Signup', route: '/signup', step: 's11', file: 'app/signup/page.tsx' }]);
  const before = projectFiles(dir);
  execute(dir, planned.plan);
  const after = projectFiles(dir);
  assert.deepEqual([...Object.keys(after), ...Object.keys(before)].filter((f, i, all) => all.indexOf(f) === i && after[f] !== before[f]).sort(), planTouches(planned.plan).files.map((f) => f.path).sort(), 'no file changed that the plan did not declare');
  assert.equal(after['app/signup/page.tsx'], "import { SignupController } from '../../features/signup/controllers/SignupController.controller';\n\nexport default function Page() {\n  return <SignupController />;\n}\n", 'the route entry renders the controller and nothing else');
  assert.deepEqual(validateJson(dir).violations.map((v) => `${v.severity} ${v.rule} ${v.file}`), []);
  const files = featureFiles(dir);
  assert.ok(files['features/signup/controllers/SignupController.controller.tsx'].startsWith("'use client';"));
  assert.ok(files['features/signup/hooks/useSignup.state.ts'].startsWith("'use client';"));
  assert.ok(!files['features/signup/workflows/Signup.workflow.ts'].startsWith("'use client';"), 'the machine is pure: no client directive');
  const proof = run(['test', 'proof', 'signup', '--format', 'json'], dir);
  assert.equal(proof.status, 0, 'the proof of the same screen passes on a Next.js project');
  assert.equal(JSON.parse(proof.stdout).counts.failed, 0);
  const tsc = typeCheck(dir, ['app/signup/page.tsx']);
  assert.equal(tsc.status, 0, tsc.output);
});

test('the local source (the rules default without an OpenAPI file): the wizard works with no backend, and its proof is green', NEEDS_RUNTIME, async () => {
  const dir = initProject('react-spa', 'wizard-local');
  const { planned } = await plan(dir, null);
  assert.ok(planned.plan.steps.slice(1, 8).every((s) => s.args.source === 'local'), 'no OpenAPI file: the rules default is the local store');
  execute(dir, planned.plan);
  const files = featureFiles(dir);
  assert.ok(files['features/signup/domain/SignupStore.domain.ts'].includes('export const saveSignup = defineDomain<'));
  assert.ok(!files['features/signup/services/Signup.service.ts'].includes('fetch('), 'the service makes no request');
  assert.deepEqual(validateJson(dir).violations.map((v) => `${v.severity} ${v.rule} ${v.file}`), []);
  const tsc = typeCheck(dir, ['src/App.tsx']);
  assert.equal(tsc.status, 0, tsc.output);
  const proof = run(['test', 'proof', 'signup', '--format', 'json'], dir);
  assert.equal(proof.status, 0, `${proof.stdout}${proof.stderr}`);
  const result = JSON.parse(proof.stdout);
  assert.equal(result.counts.failed, 0);
  assert.ok(result.tests.some((x) => x.title === 'Signup service: a submit is saved into the local store, with no network'));
});

test('the openapi source: the service POSTs to the path of POST /signups, and the proof says so', NEEDS_RUNTIME, async () => {
  const dir = initProject('react-spa', 'wizard-openapi');
  fs.writeFileSync(path.join(dir, 'openapi.yaml'), ['openapi: 3.0.3', 'info: { title: Shop, version: 1.0.0 }', 'servers:', '  - url: /api/v1', 'paths:', '  /signups:', '    post:', '      operationId: createSignup', '      responses: { "201": { description: created } }', ''].join('\n'));
  const { planned } = await plan(dir, null);
  assert.ok(planned.plan.steps.slice(1, 8).every((s) => s.args.source === 'openapi'), 'a matching operation makes openapi the rules default');
  execute(dir, planned.plan);
  const files = featureFiles(dir);
  assert.match(files['features/signup/services/Signup.service.ts'], /\/\/ Data source: POST \/signups \(createSignup\) of openapi\.yaml\./);
  assert.match(files['features/signup/services/Signup.service.ts'], /fetch\('\/api\/v1\/signups', \{ method: 'POST'/);
  const proof = run(['test', 'proof', 'signup', '--format', 'json'], dir);
  assert.equal(proof.status, 0, `${proof.stdout}${proof.stderr}`);
  assert.ok(JSON.parse(proof.stdout).tests.some((x) => x.title === 'Signup service: asks the path of the OpenAPI operation'));
});
