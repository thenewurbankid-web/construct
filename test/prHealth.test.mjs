// PR health engine (#314 / #316, epic #285): every indicator over throwaway git repos, the no-plan
// absence, the removed-path flow diff, mechanical vs conversation, refused refs, and — the part the
// feature stands on — the read-only guarantee, including when the run fails or the process dies.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawnSync, spawn } from 'node:child_process';
import Ajv from 'ajv';
import { prHealth, renderPrHealthMarkdown, MECHANICAL_RULES } from '../packages/engine/prHealth.mjs';
import { withTrees, liveTreeCount, reclaimTreesOf } from '../packages/engine/gitTrees.mjs';
import { makeTempDir } from '../test-utils/tmpdir.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(REPO, 'bin', 'construct.mjs');
const SHARED = path.join(REPO, 'fixtures', 'impact-shared');
const schema = JSON.parse(fs.readFileSync(path.join(REPO, 'schemas', 'pr-health.v1.json'), 'utf8'));
const validateSchema = new Ajv({ allErrors: true }).compile(schema);
const assertSchema = (v, label = '') => assert.ok(validateSchema(v), `${label} schema errors: ${JSON.stringify(validateSchema.errors)}`);

const run = (cwd, args) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', shell: false });
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout;
};
const write = (dir, rel, text) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };
const commit = (dir, msg) => { run(dir, ['add', '-A']); run(dir, ['commit', '-q', '-m', msg]); };

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
const FLOW_HEAD = FLOW_BASE.replace("rejected: { on: { OVERRIDE: 'success' } },", "rejected: { type: 'final' },");

/** A throwaway repo: the impact-shared fixture on `main` plus a workflow; branch `change` edits it. */
function makeRepo() {
  const dir = makeTempDir('prhealth-');
  fs.cpSync(SHARED, dir, { recursive: true });
  write(dir, 'features/billing/workflows/SignupFlow.ts', FLOW_BASE);
  run(dir, ['init', '-q', '-b', 'main']);
  run(dir, ['config', 'user.email', 't@example.com']);
  run(dir, ['config', 'user.name', 'T']);
  run(dir, ['config', 'commit.gpgsign', 'false']);
  commit(dir, 'base');
  run(dir, ['checkout', '-q', '-b', 'change']);
  // billing: a domain edit AND the service that uses it (a connected change)
  write(dir, 'features/billing/domain/billingRules.ts', '// Pure billing rules: no I/O, no framework.\nexport function totalBilling(lines: number[]): number {\n  return lines.reduce((a, b) => a + b, 0) + 0;\n}\n');
  write(dir, 'features/billing/services/billingService.ts', fs.readFileSync(path.join(dir, 'features/billing/services/billingService.ts'), 'utf8') + '// touched\n');
  // checkout: a domain edit nothing else in the change relates to
  write(dir, 'features/checkout/domain/checkoutRules.ts', fs.readFileSync(path.join(dir, 'features/checkout/domain/checkoutRules.ts'), 'utf8') + '// isolated\n');
  // a shared component edit that looks feature-local
  write(dir, 'features/shared/components/CurrencyLabel.tsx', fs.readFileSync(path.join(dir, 'features/shared/components/CurrencyLabel.tsx'), 'utf8') + '// shared edit\n');
  // public surface: billing stops exporting its hook
  write(dir, 'features/billing/index.ts', fs.readFileSync(path.join(dir, 'features/billing/index.ts'), 'utf8').replace("/** State and actions for the billing screen. */\nexport * from './hooks/useBilling';\n", ''));
  // flow: the rejected -> success path disappears
  write(dir, 'features/billing/workflows/SignupFlow.ts', FLOW_HEAD);
  // a rule regression that is mechanical (a misnamed component) and one that needs a conversation (page that imports a service)
  write(dir, 'features/billing/components/badname.tsx', 'export function BadName() { return <span />; }\n');
  write(dir, 'features/billing/pages/Leaky.tsx', "import { fetchBilling } from '../services/billingService';\nexport function Leaky() { fetchBilling(); return <div />; }\n");
  commit(dir, 'change');
  run(dir, ['checkout', '-q', 'main']);
  return dir;
}

const snapshot = (dir) => {
  const hashTree = (d, rel = '') => fs.readdirSync(d, { withFileTypes: true }).filter((e) => e.name !== '.git').sort((a, b) => a.name.localeCompare(b.name)).flatMap((e) => {
    const p = path.join(d, e.name);
    return e.isDirectory() ? hashTree(p, `${rel}${e.name}/`) : [`${rel}${e.name}:${crypto.createHash('sha1').update(fs.readFileSync(p)).digest('hex')}`];
  });
  return {
    head: run(dir, ['rev-parse', 'HEAD']),
    branch: run(dir, ['symbolic-ref', '-q', 'HEAD']),
    branches: run(dir, ['for-each-ref', '--format=%(refname) %(objectname)']),
    worktrees: run(dir, ['worktree', 'list', '--porcelain']),
    status: run(dir, ['status', '--porcelain=v2', '--untracked-files=all']),
    stash: run(dir, ['stash', 'list']),
    index: crypto.createHash('sha1').update(fs.readFileSync(path.join(dir, '.git', 'index'))).digest('hex'),
    files: hashTree(dir),
    gitdirWorktrees: fs.existsSync(path.join(dir, '.git', 'worktrees')) ? fs.readdirSync(path.join(dir, '.git', 'worktrees')) : [],
  };
};

const ind = (r, id) => r.indicators.find((i) => i.id === id);
const REPO_DIR = makeRepo();

test('the report is schema-valid, deterministic, and every indicator is tagged with evidence and a source', () => {
  const a = prHealth(REPO_DIR, { base: 'main', head: 'change' });
  assert.equal(a.ok, true, JSON.stringify(a.error));
  assertSchema(a);
  assert.deepEqual(a.indicators.map((i) => i.id), ['blast-radius', 'unexplained', 'rule-regressions', 'public-surface', 'flow-diff']);
  for (const i of a.indicators) {
    assert.equal(i.deterministic, true);
    assert.ok(i.headline && i.source && i.evidence, i.id);
  }
  assert.equal(JSON.stringify(a), JSON.stringify(prHealth(REPO_DIR, { base: 'main', head: 'change' })));
  assert.match(renderPrHealthMarkdown(a), /Where this comes from/);
});

test('no plan: blast radius is absent (measured:false), neutral, and never an error or a finding', () => {
  const r = prHealth(REPO_DIR, { base: 'main', head: 'change' });
  const b = ind(r, 'blast-radius');
  assert.equal(b.measured, false);
  assert.equal(b.status, 'not-measured');
  assert.deepEqual(b.findings, []);
  assert.match(b.reason, /normal for hand-written work/);
  assert.doesNotMatch(b.reason + b.headline, /fail|wrong|missing|should have|error/i);
  assert.equal(r.request.expected, 'none');
  for (const empty of [null, undefined, [], { features: [], files: [] }, { steps: [] }]) {
    assert.equal(ind(prHealth(REPO_DIR, { base: 'main', head: 'change', expected: empty }), 'blast-radius').measured, false);
  }
});

test('declared vs actual: extra features, and the delta goes both ways', () => {
  const r = prHealth(REPO_DIR, { base: 'main', head: 'change', expected: ['billing', 'reporting'] });
  const b = ind(r, 'blast-radius');
  assert.equal(b.measured, true);
  assert.equal(b.status, 'attention');
  assert.deepEqual(b.evidence.declared.features, ['billing', 'reporting']);
  assert.deepEqual(b.evidence.touched.features, ['billing', 'checkout', 'shared']);
  assert.deepEqual(b.evidence.extraFeatures, ['checkout', 'shared']);
  assert.deepEqual(b.evidence.unreachedFeatures, ['reporting']);
  assert.match(b.headline, /declared 2 features \(billing, reporting\); this change touches 3/);
  assert.ok(b.findings.every((f) => f.resolution === 'conversation'));
  assertSchema(r);
});

test('declared vs actual accepts a plan and lists the extra files', () => {
  const plan = { steps: [{ id: 's1', touches: { features: ['billing'], files: [{ path: 'features/billing/domain/billingRules.ts' }] } }] };
  const r = prHealth(REPO_DIR, { base: 'main', head: 'change', expected: plan });
  const b = ind(r, 'blast-radius');
  assert.equal(r.request.expected, 'plan');
  assert.ok(b.evidence.extraFiles.items.includes('features/checkout/domain/checkoutRules.ts'));
  assert.deepEqual(b.evidence.missingFiles.items, []);
  const exact = prHealth(REPO_DIR, { base: 'main', head: 'change', expected: ['billing', 'checkout', 'shared'] });
  assert.equal(ind(exact, 'blast-radius').status, 'clear');
});

test('unexplained changes: an isolated domain edit and a shared component edited feature-locally', () => {
  const u = ind(prHealth(REPO_DIR, { base: 'main', head: 'change' }), 'unexplained');
  assert.equal(u.measured, true);
  assert.equal(u.evidence.anchor, 'largest-cluster');
  const isolated = u.findings.find((f) => f.id === 'unexplained:isolated:features/checkout/domain/checkoutRules.ts');
  assert.ok(isolated, JSON.stringify(u.findings.map((f) => f.id)));
  assert.match(isolated.message, /no import path/);
  assert.ok(isolated.expectedConsumers.includes('service'));
  const shared = u.findings.find((f) => f.id.startsWith('unexplained:shared:'));
  assert.ok(shared);
  assert.deepEqual(shared.untouchedConsumers, ['reporting']);
  // the connected billing domain + service pair is NOT flagged
  assert.ok(!u.findings.some((f) => f.files.includes('features/billing/domain/billingRules.ts')));
  assert.ok(u.findings.every((f) => f.resolution === 'conversation'));
});

test('with a plan, changes unconnected to what it declared are unexplained', () => {
  const u = ind(prHealth(REPO_DIR, { base: 'main', head: 'change', expected: ['billing'] }), 'unexplained');
  assert.equal(u.evidence.anchor, 'plan');
  assert.ok(u.findings.some((f) => f.id === 'unexplained:isolated:features/checkout/domain/checkoutRules.ts'));
  assert.ok(!u.findings.some((f) => f.files.includes('features/billing/services/billingService.ts')));
});

test('rule regressions: only NEW violations, with the rule id and the layer constraint', () => {
  const r = ind(prHealth(REPO_DIR, { base: 'main', head: 'change' }), 'rule-regressions');
  assert.equal(r.measured, true);
  assert.ok(r.evidence.preExisting >= 1, 'the fixture ships a pre-existing SLICE-001 finding, which must not be counted');
  assert.equal(r.evidence.new, r.findings.length);
  const domain = r.findings.find((f) => f.rule === 'PAGE-003');
  assert.ok(domain, JSON.stringify(r.findings.map((f) => f.rule)));
  assert.equal(domain.layer, 'page');
  assert.ok(Array.isArray(domain.constraint.canImport));
  assert.ok(!r.findings.some((f) => f.rule === 'SLICE-001'));
  const clean = ind(prHealth(REPO_DIR, { base: 'main', head: 'main' }), 'rule-regressions');
  assert.equal(clean.evidence.new, 0);
  assert.equal(clean.status, 'clear');
});

test('findings are classified: a rename-only READ-001 is mechanical, a page that imports a service is a conversation', () => {
  const r = prHealth(REPO_DIR, { base: 'main', head: 'change' });
  const all = r.findings;
  const read = all.find((f) => f.rule === 'READ-001');
  assert.ok(read, JSON.stringify(all.map((f) => f.id)));
  assert.equal(read.resolution, 'mechanical');
  assert.equal(read.fix.via, 'construct refactor rename');
  assert.equal(all.find((f) => f.rule === 'PAGE-003').resolution, 'conversation');
  assert.ok(all.filter((f) => f.indicator !== 'rule-regressions').every((f) => f.resolution === 'conversation'));
  assert.deepEqual(r.counts, { mechanical: all.filter((f) => f.resolution === 'mechanical').length, conversation: all.filter((f) => f.resolution === 'conversation').length });
  assert.ok(r.counts.mechanical >= 1 && r.counts.conversation >= 1);
  assert.equal(MECHANICAL_RULES['SLICE-002'].available, false);
});

test('public surface: the export that went away, and who could be affected', () => {
  const p = ind(prHealth(REPO_DIR, { base: 'main', head: 'change' }), 'public-surface');
  assert.equal(p.status, 'attention');
  const billing = p.evidence.features.find((f) => f.feature === 'billing');
  assert.ok(billing.removed.some((x) => x.file === 'features/billing/index.ts'));
  assert.ok(p.findings.some((f) => f.id === 'public-surface:removed:billing'));
  const none = ind(prHealth(REPO_DIR, { base: 'main', head: 'main' }), 'public-surface');
  assert.equal(none.headline, 'No public exports changed.');
  assert.equal(none.status, 'clear');
});

test('flow diff names the removed path in the narrator\'s vocabulary', () => {
  const f = ind(prHealth(REPO_DIR, { base: 'main', head: 'change' }), 'flow-diff');
  assert.equal(f.status, 'attention');
  const flow = f.evidence.flows.find((x) => x.machine === 'SignupFlow');
  assert.equal(flow.status, 'changed');
  assert.ok(flow.removed.some((s) => s.route === 'idle → pending → rejected → success'), JSON.stringify(flow.removed));
  assert.match(flow.removed[0].sentence, /This change removes the path idle → pending → rejected → success/);
  assert.ok(flow.added.some((s) => s.route === 'idle → pending → rejected'));
  assert.equal(flow.unchanged, 1);
  assert.ok(flow.removed[0].text[0].startsWith('Given the flow starts in'), 'uses the narrator\'s own Given/When/Then text');
  assert.match(f.headline, /removes the path idle → pending → rejected → success/);
  assert.ok(f.findings.some((x) => x.id === 'flow-diff:removed:billing/SignupFlow' && x.resolution === 'conversation'));
  const quiet = ind(prHealth(REPO_DIR, { base: 'main', head: 'main' }), 'flow-diff');
  assert.equal(quiet.status, 'clear');
});

test('an identical range and a docs-only change are positive results, not empty ones', () => {
  const same = prHealth(REPO_DIR, { base: 'main', head: 'main' });
  assert.equal(same.ok, true);
  assert.equal(same.change.counts.files, 0);
  assertSchema(same);
  for (const i of same.indicators.filter((x) => x.id !== 'blast-radius')) assert.ok(i.headline.length > 0, i.id);
});

test('a bad ref is refused and nothing is executed or written', () => {
  const before = snapshot(REPO_DIR);
  const marker = path.join(os.tmpdir(), `prhealth-pwned-${process.pid}`);
  for (const bad of ['--upload-pack=touch ' + marker, '-x', '', 'no-such-branch', 'main\nchange', `main; touch ${marker}`, '$(touch ' + marker + ')', 'a'.repeat(400)]) {
    const r = prHealth(REPO_DIR, { base: bad, head: 'change' });
    assert.equal(r.ok, false, JSON.stringify(bad));
    assert.match(r.error.code, /INVALID_ARGUMENT|REF_NOT_FOUND/);
    const r2 = prHealth(REPO_DIR, { base: 'main', head: bad });
    assert.equal(r2.ok, false);
  }
  assert.equal(fs.existsSync(marker), false);
  assert.deepEqual(snapshot(REPO_DIR), before);
  assert.equal(prHealth(REPO_DIR, { base: 'main', head: 'change', expected: 42 }).error.code, 'INVALID_ARGUMENT');
  assert.equal(prHealth(os.tmpdir() + '/definitely-missing-dir', { base: 'a', head: 'b' }).error.code, 'ROOT_NOT_FOUND');
  const notRepo = makeTempDir('prhealth-norepo-');
  assert.equal(prHealth(notRepo, { base: 'main', head: 'change' }).ok, false);
});

test('read-only: working tree, index, branches, stash and worktree list are byte-identical, dirty state included', () => {
  write(REPO_DIR, 'features/billing/domain/billingRules.ts', '// uncommitted local edit\nexport const x = 1;\n');
  write(REPO_DIR, 'scratch-untracked.txt', 'untracked\n');
  run(REPO_DIR, ['add', 'scratch-untracked.txt']);
  write(REPO_DIR, 'scratch-unstaged.txt', 'unstaged\n');
  const before = snapshot(REPO_DIR);
  const r = prHealth(REPO_DIR, { base: 'main', head: 'change' });
  assert.equal(r.ok, true);
  assert.ok(!r.change.files.some((f) => f.path.startsWith('scratch-')), 'local, uncommitted state is never part of a ref comparison');
  assert.deepEqual(snapshot(REPO_DIR), before);
  assert.equal(liveTreeCount(), 0);
  run(REPO_DIR, ['checkout', '-q', '--', 'features/billing/domain/billingRules.ts']);
  run(REPO_DIR, ['reset', '-q', '--', 'scratch-untracked.txt']);
  fs.rmSync(path.join(REPO_DIR, 'scratch-untracked.txt'));
  fs.rmSync(path.join(REPO_DIR, 'scratch-unstaged.txt'));
});

test('cleanup after failure: a throw inside the run, and a broken project on head, leave nothing behind', () => {
  const before = snapshot(REPO_DIR);
  const sha = run(REPO_DIR, ['rev-parse', 'change']).trim();
  let seen;
  assert.throws(() => withTrees(REPO_DIR, [sha], ([dir]) => { seen = dir; assert.ok(fs.existsSync(dir)); throw new Error('boom'); }), /boom/);
  assert.equal(fs.existsSync(seen), false);
  assert.equal(liveTreeCount(), 0);
  assert.deepEqual(snapshot(REPO_DIR), before);

  // a head whose architecture.yml is unparseable makes the analysis fail; the failure is structured, and clean
  const bad = makeRepo();
  run(bad, ['checkout', '-q', 'change']);
  write(bad, 'architecture.yml', 'version: [unclosed\n  nonsense: : :\n');
  commit(bad, 'break config');
  run(bad, ['checkout', '-q', 'main']);
  const b2 = snapshot(bad);
  const r = prHealth(bad, { base: 'main', head: 'change' });
  assert.equal(r.ok, false);
  assert.match(r.error.code, /INTERNAL_ERROR|PROJECT/);
  assert.deepEqual(snapshot(bad), b2);
  assert.equal(liveTreeCount(), 0);
});

function childProgram(mode) {
  return `import { withTrees } from ${JSON.stringify(path.join(REPO, 'packages/engine/gitTrees.mjs'))};
const sha = process.argv[2];
withTrees(process.argv[3], [sha], ([dir]) => {
  process.stdout.write('ready ' + dir + '\\n');
  ${mode === 'exit' ? 'process.exit(3);' : 'Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 30000);'}
});`;
}

test('cleanup when the process dies mid-run: process.exit and SIGTERM both remove the worktree registration and directory', async () => {
  const sha = run(REPO_DIR, ['rev-parse', 'change']).trim();
  const before = snapshot(REPO_DIR);
  for (const mode of ['exit', 'term']) {
    const script = path.join(makeTempDir('prhealth-child-'), 'child.mjs');
    fs.writeFileSync(script, childProgram(mode));
    const child = spawn(process.execPath, [script, sha, REPO_DIR], { stdio: ['ignore', 'pipe', 'inherit'] });
    let out = '';
    const dir = await new Promise((resolve) => {
      child.stdout.on('data', (d) => { out += d; const m = out.match(/ready (.+)\n/); if (m) { resolve(m[1]); if (mode === 'term') child.kill('SIGTERM'); } });
    });
    await new Promise((resolve) => child.on('exit', resolve));
    assert.equal(fs.existsSync(dir), false, `${mode}: the temp checkout is gone`);
    assert.equal(fs.existsSync(path.dirname(dir)), false, `${mode}: the per-process root is gone`);
    assert.deepEqual(snapshot(REPO_DIR), before, `${mode}: the repo is unchanged`);
  }
});

test("#351 reclaimTreesOf removes exactly a killed process's checkouts and registrations, and refuses a live pid or our own", async () => {
  const sha = run(REPO_DIR, ['rev-parse', 'change']).trim();
  const before = snapshot(REPO_DIR);
  const script = path.join(makeTempDir('prhealth-child-'), 'child.mjs');
  fs.writeFileSync(script, childProgram('term')); // blocks synchronously: a SIGTERM handler could not run, so it is SIGKILLed
  const child = spawn(process.execPath, [script, sha, REPO_DIR], { stdio: ['ignore', 'pipe', 'inherit'] });
  let out = '';
  const dir = await new Promise((resolve) => { child.stdout.on('data', (d) => { out += d; const m = out.match(/ready (.+)\n/); if (m) resolve(m[1]); }); });
  assert.deepEqual(reclaimTreesOf(child.pid, REPO_DIR), [], "a live process's checkouts are never touched");
  assert.equal(fs.existsSync(dir), true);
  assert.deepEqual(reclaimTreesOf(process.pid, REPO_DIR), [], 'never our own');
  child.kill('SIGKILL');
  await new Promise((resolve) => child.on('exit', resolve));
  assert.equal(fs.existsSync(dir), true, 'SIGKILL left the debris this function exists for');
  assert.notDeepEqual(snapshot(REPO_DIR), before, 'and the repository still has the worktree registered');
  const removed = reclaimTreesOf(child.pid, REPO_DIR);
  assert.equal(removed.length, 1);
  assert.equal(fs.existsSync(dir), false);
  assert.equal(fs.existsSync(path.dirname(dir)), false);
  assert.deepEqual(snapshot(REPO_DIR), before, 'the repository is byte-identical again');
  assert.deepEqual(reclaimTreesOf(child.pid, REPO_DIR), [], 'idempotent');
});

test('a change bigger than the impact cap degrades to a feature-level summary instead of failing', () => {
  const dir = makeRepo();
  run(dir, ['checkout', '-q', '-b', 'huge', 'main']);
  for (let i = 0; i < 230; i += 1) write(dir, `features/bulk/domain/rule${i}.ts`, `// Pure rule ${i}.\nexport const rule${i} = ${i};\n`);
  commit(dir, 'bulk');
  run(dir, ['checkout', '-q', 'main']);
  const r = prHealth(dir, { base: 'main', head: 'huge' });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  assertSchema(r);
  assert.equal(r.degraded.truncated, true);
  assert.equal(r.degraded.level, 'feature');
  assert.deepEqual(r.change.features, [{ name: 'bulk', files: 230 }]);
  assert.equal(ind(r, 'unexplained').measured, false);
  assert.match(r.summary, /230 files changed across 1 feature/);
});

test('deletions and non-source changes still produce a report', () => {
  const dir = makeRepo();
  run(dir, ['checkout', '-q', '-b', 'trim', 'main']);
  fs.rmSync(path.join(dir, 'features/billing/domain/billingRules.ts'));
  write(dir, 'NOTES.md', '# notes\n');
  commit(dir, 'delete + docs');
  run(dir, ['checkout', '-q', 'main']);
  const r = prHealth(dir, { base: 'main', head: 'trim' });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  assertSchema(r);
  assert.equal(r.change.counts.deleted, 1);
});

test('the merge base is used, so a moved base does not look like removed work', () => {
  const dir = makeRepo();
  run(dir, ['checkout', '-q', 'main']);
  write(dir, 'features/reporting/domain/reportingRules.ts', '// moved on main\nexport const moved = 1;\n');
  commit(dir, 'main moves');
  const r = prHealth(dir, { base: 'main', head: 'change' });
  assert.equal(r.request.comparedFrom, 'merge-base');
  assert.ok(!r.change.files.some((f) => f.path.includes('reporting')));
  const direct = prHealth(dir, { base: 'main', head: 'change', mergeBase: false });
  assert.ok(direct.change.files.some((f) => f.path.includes('reporting')));
});

test('CLI: construct review prints the JSON report, markdown, usage, and refuses a bad ref', () => {
  const ok = spawnSync(process.execPath, [CLI, 'review', 'main', 'change', '--features', 'billing', '--dir', REPO_DIR], { encoding: 'utf8' });
  assert.equal(ok.status, 0, ok.stderr);
  const json = JSON.parse(ok.stdout);
  assertSchema(json);
  assert.equal(json.request.expected, 'features');
  const md = spawnSync(process.execPath, [CLI, 'review', 'main', 'change', '--format', 'markdown', '--dir', REPO_DIR], { encoding: 'utf8' });
  assert.match(md.stdout, /# PR health/);
  const usage = spawnSync(process.execPath, [CLI, 'review', '--usage'], { encoding: 'utf8' });
  assert.equal(JSON.parse(usage.stdout).readOnly, true);
  const bad = spawnSync(process.execPath, [CLI, 'review', 'main', 'nope', '--dir', REPO_DIR], { encoding: 'utf8' });
  assert.notEqual(bad.status, 0);
  assert.equal(JSON.parse(bad.stdout).error.code, 'REF_NOT_FOUND');
  const flagLike = spawnSync(process.execPath, [CLI, 'review', 'main', '--upload-pack=x', '--dir', REPO_DIR], { encoding: 'utf8' });
  assert.notEqual(flagLike.status, 0);
});
