// #337 — the approval gate. These tests ARE the security evidence: the gate is
// the only place a bot's output (maybe a local model's) reaches the user's tree.
// Every refusal is proven on a real git repository, and "approved equals
// applied" is proven byte for byte.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeTempDir } from '../test-utils/tmpdir.mjs';
import { createProcess, recordArtifact } from '../packages/engine/processModel.mjs';
import { openProcessStore } from '../packages/engine/processStore.mjs';
import { createProcessEngine } from '../packages/engine/processEngine.mjs';
import { createBotRunner, botBranch } from '../packages/engine/botRunner.mjs';
import { createApprovalGate, pathProblem, GATE_CODES } from '../packages/engine/approvalGate.mjs';

const FAKE_BIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'test-utils', 'fakeConstructBin.mjs');
const ID = ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false'];
const git = (cwd, ...args) => spawnSync('git', [...ID, ...args], { cwd, encoding: 'utf8' }).stdout.trim();
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const codes = (result) => result.refusals.map((r) => r.code);

/** sha256 of every file except .git — "byte-identical" made checkable. */
function snapshot(root) {
  const out = {};
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === '.git') continue;
      const full = path.join(dir, e.name);
      if (e.isSymbolicLink()) out[path.relative(root, full)] = `link:${fs.readlinkSync(full)}`;
      else if (e.isDirectory()) walk(full);
      else out[path.relative(root, full)] = sha(fs.readFileSync(full));
    }
  };
  walk(root);
  return out;
}

const touch = (files) => ({ features: [], files });
const planWith = (files, { executor = 'deterministic' } = {}) => ({
  version: 1,
  ticket: { source: 'text', title: 'T' },
  steps: [{ id: 's1', title: 'Scaffold', flow: 'create.unit', args: { layer: 'domain', name: 'X', feature: 'f', ...(executor === 'local-model' ? { llm: 'ollama' } : {}) }, executor, touches: touch(files) }],
});

/**
 * A project with a committed base, a bot branch holding `bot` (path -> string
 * content, null = delete), a process record with one artifact per bot file.
 * `declared` is the plan's touches (default: every bot file with its change).
 * `realValidate` (#546): every other test here stubs `validate` to isolate the gate's own logic
 * from the real enforcers; passing true instead lets createApprovalGate use its own real default
 * (aggregateValidation(DEFAULT_ENFORCERS)), for the one test that exists to prove that default.
 */
function scenario({ base = {}, bot = {}, declared, executor, state = 'done', extraProject = () => {}, afterCommit = () => {}, id = 'p1', realValidate = false } = {}) {
  const projectRoot = fs.realpathSync(makeTempDir('construct-gate-project-'));
  const stateDir = makeTempDir('construct-gate-state-');
  git(projectRoot, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(projectRoot, 'README.md'), 'user work\n');
  for (const [p, c] of Object.entries(base)) {
    fs.mkdirSync(path.dirname(path.join(projectRoot, p)), { recursive: true });
    fs.writeFileSync(path.join(projectRoot, p), c);
  }
  extraProject(projectRoot);
  git(projectRoot, 'add', '-A');
  git(projectRoot, 'commit', '-q', '-m', 'base');

  // The bot's branch, built the way the runner builds it: a worktree, a commit.
  const wt = path.join(makeTempDir('construct-gate-wt-'), 'wt');
  git(projectRoot, 'worktree', 'add', '-q', '-b', botBranch(id), wt, 'HEAD');
  const changes = [];
  for (const [p, c] of Object.entries(bot)) {
    const abs = path.join(wt, p);
    const before = p in base ? base[p] : null;
    if (c === null) { fs.rmSync(abs); changes.push({ path: p, change: 'delete', before, after: null }); continue; }
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, c);
    changes.push({ path: p, change: before === null ? 'create' : 'modify', before, after: c });
  }
  git(wt, 'add', '-A');
  git(wt, 'commit', '-q', '-m', 's1: Scaffold');
  git(projectRoot, 'worktree', 'remove', '--force', wt);
  afterCommit(projectRoot);

  const files = declared ?? changes.map((c) => ({ path: c.path, change: c.change }));
  let rec = createProcess(planWith(files, { executor }), { id, projectRoot });
  for (const c of changes) rec = recordArtifact(rec, { ...c, stepId: 's1' });
  rec = {
    ...rec,
    state,
    steps: rec.steps.map((s) => ({ ...s, status: 'done', llm: executor === 'local-model' ? { provider: 'ollama', calls: 1 } : null })),
  };
  const store = openProcessStore(projectRoot, { stateDir });
  store.save(rec);
  let tick = 0;
  const gate = createApprovalGate({
    store,
    now: () => new Date(Date.UTC(2026, 8, 20, 12, 0, tick++)).toISOString(),
    ...(realValidate ? {} : { validate: () => ({ violations: [] }) }),
  });
  return { projectRoot, stateDir, store, gate, id, changes };
}

const branchExists = (s) => spawnSync('git', ['rev-parse', '--verify', '--quiet', `refs/heads/${botBranch(s.id)}`], { cwd: s.projectRoot }).status === 0;
const approve = (s, p) => {
  const r = s.gate.review(s.id).artifacts.find((a) => a.path === p);
  return { path: p, verdict: 'approve', diffSha256: r.diffSha256 };
};

// ---------------------------------------------------------------------------
// The happy path and the byte-exact property.
// ---------------------------------------------------------------------------

test('review() is read-only: it shows the exact diff and writes nothing', () => {
  const s = scenario({ base: { 'a.ts': 'old\n' }, bot: { 'a.ts': 'new\n', 'b.ts': 'fresh\n' } });
  const before = snapshot(s.projectRoot);
  const r = s.gate.review(s.id);
  assert.equal(r.ok, true);
  assert.equal(r.artifacts.length, 2);
  const a = r.artifacts.find((x) => x.path === 'a.ts');
  assert.match(a.diff, /-old\n\+new/);
  assert.equal(a.diffSha256, sha(Buffer.from(a.diff)));
  assert.equal(a.applicable, true);
  assert.equal(a.verdict, null);
  assert.deepEqual(snapshot(s.projectRoot), before);
  assert.equal(git(s.projectRoot, 'status', '--porcelain'), '');
  assert.equal(s.store.load(s.id).artifacts.every((x) => x.approved === null), true);
});

test('approve applies exactly the approved diff, byte for byte (CRLF, no trailing newline, unicode)', () => {
  const tricky = 'line one\r\nlínea dos ✓\r\nno newline at end';
  const s = scenario({ base: { 'a.ts': 'old\n' }, bot: { 'a.ts': tricky, 'new/deep/b.ts': 'export const b = 1;\n' } });
  const out = s.gate.decide(s.id, { by: 'octocat', decisions: [approve(s, 'a.ts'), approve(s, 'new/deep/b.ts')] });
  assert.equal(out.ok, true);
  assert.equal(out.applied, 2);
  assert.equal(fs.readFileSync(path.join(s.projectRoot, 'a.ts')).equals(Buffer.from(tricky)), true);
  assert.equal(fs.readFileSync(path.join(s.projectRoot, 'new/deep/b.ts'), 'utf8'), 'export const b = 1;\n');
  // Left in the working tree, unstaged and uncommitted: the user commits it.
  assert.match(git(s.projectRoot, 'status', '--porcelain'), /^\s*M a\.ts\n\?\? new\//);
  assert.equal(git(s.projectRoot, 'diff', '--cached', '--name-only'), '');
});

test('the verdict records who, when, and the diff hash; the log says who approved', () => {
  const s = scenario({ bot: { 'b.ts': 'x\n' } });
  const hash = s.gate.review(s.id).artifacts[0].diffSha256;
  s.gate.decide(s.id, { by: 'octocat', decisions: [{ path: 'b.ts', verdict: 'approve', diffSha256: hash }] });
  const rec = s.store.load(s.id);
  const a = rec.artifacts[0];
  assert.equal(a.approved, true);
  assert.equal(a.verdict.decision, 'approved');
  assert.equal(a.verdict.by, 'octocat');
  assert.match(a.verdict.at, /^2026-09-20T12:00:\d\d\.000Z$/);
  assert.equal(a.verdict.diffSha256, hash);
  assert.equal(a.verdict.applied, true);
  assert.match(rec.log.find((e) => /^Approved b\.ts/.test(e.message)).message, /by octocat/);
});

// ---------------------------------------------------------------------------
// Rule 1 — explicit approval, nothing by default.
// ---------------------------------------------------------------------------

test('there is no approve-all: empty decisions, a missing/blank/odd `by`, and a missing or stale diff hash all write nothing', () => {
  const s = scenario({ bot: { 'b.ts': 'x\n' } });
  const before = snapshot(s.projectRoot);
  assert.equal(s.gate.decide(s.id, { by: 'octocat', decisions: [] }).error.code, GATE_CODES.BAD_REQUEST);
  assert.equal(s.gate.decide(s.id, { by: 'octocat' }).error.code, GATE_CODES.BAD_REQUEST);
  for (const by of [undefined, '', '   ', 'a\nb', 42, 'x'.repeat(201)]) {
    assert.equal(s.gate.decide(s.id, { by, decisions: [approve(s, 'b.ts')] }).error.code, GATE_CODES.BAD_REQUEST, `by=${JSON.stringify(by)}`);
  }
  const noHash = s.gate.decide(s.id, { by: 'o', decisions: [{ path: 'b.ts', verdict: 'approve' }] });
  assert.deepEqual(codes(noHash.results[0]), [GATE_CODES.DIFF_STALE]);
  const stale = s.gate.decide(s.id, { by: 'o', decisions: [{ path: 'b.ts', verdict: 'approve', diffSha256: 'f'.repeat(64) }] });
  assert.deepEqual(codes(stale.results[0]), [GATE_CODES.DIFF_STALE]);
  assert.equal(s.gate.decide(s.id, { by: 'o', decisions: [{ path: 'b.ts', verdict: 'yes' }] }).error.code, GATE_CODES.BAD_REQUEST);
  assert.equal(s.gate.decide(s.id, { by: 'o', decisions: [{ path: 'b.ts', verdict: 'reject' }, { path: 'b.ts', verdict: 'reject' }] }).error.code, GATE_CODES.BAD_REQUEST);
  assert.deepEqual(snapshot(s.projectRoot), before);
  assert.equal(s.store.load(s.id).artifacts[0].approved, null);
});

test('an artifact with no verdict is never applied: deciding one file leaves the others untouched and null', () => {
  const s = scenario({ bot: { 'a.ts': '1\n', 'b.ts': '2\n' } });
  s.gate.decide(s.id, { by: 'o', decisions: [approve(s, 'a.ts')] });
  assert.equal(fs.existsSync(path.join(s.projectRoot, 'a.ts')), true);
  assert.equal(fs.existsSync(path.join(s.projectRoot, 'b.ts')), false);
  const rec = s.store.load(s.id);
  assert.deepEqual(rec.artifacts.map((a) => a.approved), [true, null]);
});

test('verdicts are final: an approved or rejected artifact cannot be decided again', () => {
  const s = scenario({ bot: { 'a.ts': '1\n', 'b.ts': '2\n' } });
  s.gate.decide(s.id, { by: 'o', decisions: [{ path: 'a.ts', verdict: 'reject' }] });
  const again = s.gate.decide(s.id, { by: 'o', decisions: [approve(s, 'a.ts')] });
  assert.deepEqual(codes(again.results[0]), [GATE_CODES.ALREADY_DECIDED]);
  assert.equal(fs.existsSync(path.join(s.projectRoot, 'a.ts')), false);
  const unknown = s.gate.decide(s.id, { by: 'o', decisions: [{ path: 'nope.ts', verdict: 'reject' }] });
  assert.deepEqual(codes(unknown.results[0]), [GATE_CODES.UNKNOWN_ARTIFACT]);
});

test('a process that is still running cannot be decided (the gate never races the runner)', () => {
  const s = scenario({ bot: { 'a.ts': '1\n' }, state: 'running' });
  const out = s.gate.decide(s.id, { by: 'o', decisions: [{ path: 'a.ts', verdict: 'reject' }] });
  assert.equal(out.error.code, GATE_CODES.PROCESS_ACTIVE);
});

// ---------------------------------------------------------------------------
// Rule 2 — only what the plan declared.
// ---------------------------------------------------------------------------

test('an artifact outside the plan\'s touches is shown and refused, even when approved', () => {
  const s = scenario({ bot: { 'declared.ts': 'ok\n', 'sneaky.ts': 'not in the plan\n' }, declared: [{ path: 'declared.ts', change: 'create' }] });
  const r = s.gate.review(s.id).artifacts.find((a) => a.path === 'sneaky.ts');
  assert.equal(r.applicable, false);
  assert.deepEqual(codes(r), [GATE_CODES.OUTSIDE_TOUCHES]);
  assert.match(r.diff, /\+not in the plan/, 'shown, not hidden');
  const out = s.gate.decide(s.id, { by: 'o', decisions: [{ path: 'sneaky.ts', verdict: 'approve', diffSha256: r.diffSha256 }] });
  assert.deepEqual(codes(out.results[0]), [GATE_CODES.OUTSIDE_TOUCHES]);
  assert.equal(out.results[0].applied, false);
  assert.equal(fs.existsSync(path.join(s.projectRoot, 'sneaky.ts')), false);
  assert.equal(s.store.load(s.id).artifacts.find((a) => a.path === 'sneaky.ts').approved, null);
});

test('the change kind must be declared too: a delete where only a modify was declared is refused', () => {
  const s = scenario({ base: { 'a.ts': 'x\n' }, bot: { 'a.ts': null }, declared: [{ path: 'a.ts', change: 'modify' }] });
  const r = s.gate.review(s.id).artifacts[0];
  assert.deepEqual(codes(r), [GATE_CODES.OUTSIDE_TOUCHES]);
});

test('touches are matched exactly, not by prefix: declaring a directory-like path does not cover its children', () => {
  const s = scenario({ bot: { 'src/x.ts': 'x\n' }, declared: [{ path: 'src', change: 'create' }] });
  assert.deepEqual(codes(s.gate.review(s.id).artifacts[0]), [GATE_CODES.OUTSIDE_TOUCHES]);
});

// ---------------------------------------------------------------------------
// Rule 3 — protected paths.
// ---------------------------------------------------------------------------

test('a frozen path is refused even when approved', () => {
  const s = scenario({
    bot: { 'design/Button.tsx': 'export {};\n' },
    extraProject: (root) => fs.writeFileSync(path.join(root, 'architecture.yml'), 'frozen:\n  - design/**\n'),
  });
  const r = s.gate.review(s.id).artifacts[0];
  assert.deepEqual(codes(r), [GATE_CODES.FROZEN]);
  const out = s.gate.decide(s.id, { by: 'o', decisions: [{ path: 'design/Button.tsx', verdict: 'approve', diffSha256: r.diffSha256 }] });
  assert.deepEqual(codes(out.results[0]), [GATE_CODES.FROZEN]);
  assert.equal(fs.existsSync(path.join(s.projectRoot, 'design/Button.tsx')), false);
});

test('an architecture.yml that cannot be parsed fails closed: nothing is applied', () => {
  const s = scenario({
    bot: { 'a.ts': '1\n' },
    extraProject: (root) => fs.writeFileSync(path.join(root, 'architecture.yml'), 'frozen: [unclosed\n  - : :\n'),
  });
  assert.equal(codes(s.gate.review(s.id).artifacts[0]).includes(GATE_CODES.FROZEN_UNREADABLE), true);
});

test('a bot that rewrites architecture.yml to drop `frozen:` cannot unfreeze a later artifact in the same decision', () => {
  const s = scenario({
    base: { 'architecture.yml': 'frozen:\n  - design/**\n' },
    bot: { 'architecture.yml': 'layers: {}\n', 'design/x.ts': 'x\n' },
  });
  const out = s.gate.decide(s.id, { by: 'o', decisions: [approve(s, 'architecture.yml'), approve(s, 'design/x.ts')] });
  const frozen = out.results.find((r) => r.path === 'design/x.ts');
  assert.deepEqual(codes(frozen), [GATE_CODES.FROZEN]);
  assert.equal(fs.existsSync(path.join(s.projectRoot, 'design/x.ts')), false);
});

test('paths with .., an absolute path, .git, backslashes, empty segments and NULs are refused', () => {
  for (const bad of ['../escape.ts', 'a/../../escape.ts', '/etc/passwd', 'C:/x', '.git/hooks/pre-commit', 'a/.GIT/config', '.git ', 'GIT~1/x', 'a\\b.ts', 'a//b.ts', './a.ts', 'a/', 'a\0b']) {
    assert.notEqual(pathProblem(bad), null, JSON.stringify(bad));
  }
  for (const good of ['a.ts', 'features/checkout/domain/Total.ts', '.github/workflows/x.yml', '.gitignore', 'a/.gitkeep']) {
    assert.equal(pathProblem(good), null, good);
  }
});

test('a `..` artifact path in a stored process is refused end to end, and never written outside the root', () => {
  const s = scenario({ bot: { 'ok.ts': '1\n' } });
  const rec = s.store.load(s.id);
  const evil = { ...rec.artifacts[0], path: '../evil.ts' };
  const gitRec = { ...rec, artifacts: [evil, { ...rec.artifacts[0], path: '.git/config' }] };
  s.store.save(gitRec);
  const r = s.gate.review(s.id);
  assert.deepEqual(r.artifacts.map(codes).map((c) => c[0]), [GATE_CODES.PATH_INVALID, GATE_CODES.PATH_INVALID]);
  const out = s.gate.decide(s.id, { by: 'o', decisions: [{ path: '../evil.ts', verdict: 'approve', diffSha256: sha('') }] });
  assert.equal(out.results[0].applied, false);
  assert.equal(fs.existsSync(path.join(s.projectRoot, '..', 'evil.ts')), false);
});

test('a symlinked directory that resolves outside the root is refused; nothing is written through it', () => {
  const outside = fs.realpathSync(makeTempDir('construct-gate-outside-'));
  const s = scenario({
    bot: { 'linked/x.ts': 'pwned\n' },
    afterCommit: (root) => fs.symlinkSync(outside, path.join(root, 'linked')),
  });
  const r = s.gate.review(s.id).artifacts[0];
  assert.equal(codes(r).includes(GATE_CODES.SYMLINK), true, JSON.stringify(r.refusals));
  const out = s.gate.decide(s.id, { by: 'o', decisions: [{ path: 'linked/x.ts', verdict: 'approve', diffSha256: r.diffSha256 || sha('') }] });
  assert.equal(out.results[0].applied, false);
  assert.deepEqual(fs.readdirSync(outside), [], 'nothing landed outside the project');
});

test('a target that is itself a symlink (even one pointing inside the root) is refused', () => {
  const s = scenario({
    base: { 'real.ts': 'real\n', 'a.ts': 'old\n' },
    bot: { 'a.ts': 'new\n' },
  });
  fs.rmSync(path.join(s.projectRoot, 'a.ts'));
  fs.symlinkSync('real.ts', path.join(s.projectRoot, 'a.ts'));
  const r = s.gate.review(s.id).artifacts[0];
  assert.equal(codes(r).includes(GATE_CODES.SYMLINK), true);
  assert.equal(fs.readFileSync(path.join(s.projectRoot, 'real.ts'), 'utf8'), 'real\n');
});

test('a symlink in the bot\'s output is never applied (mode 120000)', () => {
  const s = scenario({ bot: { 'plain.ts': 'x\n' } });
  // Rebuild the branch tip so `link.ts` is a symlink to /etc/passwd.
  const wt = path.join(makeTempDir('construct-gate-wt2-'), 'wt');
  git(s.projectRoot, 'worktree', 'add', '-q', wt, botBranch(s.id));
  fs.symlinkSync('/etc/passwd', path.join(wt, 'link.ts'));
  git(wt, 'add', '-A');
  git(wt, 'commit', '-q', '-m', 'evil');
  git(s.projectRoot, 'worktree', 'remove', '--force', wt);
  const rec = s.store.load(s.id);
  const decl = planWith([{ path: 'plain.ts', change: 'create' }, { path: 'link.ts', change: 'create' }]);
  s.store.save({ ...rec, plan: decl, artifacts: [...rec.artifacts, { ...rec.artifacts[0], path: 'link.ts', after: { bytes: 11, sha256: sha('/etc/passwd') } }] });
  const r = s.gate.review(s.id).artifacts.find((a) => a.path === 'link.ts');
  assert.equal(codes(r).includes(GATE_CODES.MODE_UNSUPPORTED), true, JSON.stringify(r.refusals));
});

// ---------------------------------------------------------------------------
// Rule 4 — never clobber the user's work.
// ---------------------------------------------------------------------------

test('a file with uncommitted edits is refused and left byte-identical (never merged)', () => {
  const s = scenario({ base: { 'a.ts': 'old\n', 'c.ts': 'c\n' }, bot: { 'a.ts': 'bot version\n', 'c.ts': 'c2\n' } });
  fs.writeFileSync(path.join(s.projectRoot, 'a.ts'), 'my unsaved-to-git work\n');
  const before = snapshot(s.projectRoot);
  const r = s.gate.review(s.id).artifacts.find((a) => a.path === 'a.ts');
  assert.deepEqual(codes(r), [GATE_CODES.DIRTY]);
  assert.match(r.refusals[0].message, /uncommitted changes/);
  const out = s.gate.decide(s.id, { by: 'o', decisions: [approve(s, 'a.ts'), approve(s, 'c.ts')] });
  assert.deepEqual(codes(out.results[0]), [GATE_CODES.DIRTY]);
  assert.equal(out.results[1].applied, true, 'the clean file still lands: refusal is per file');
  assert.equal(fs.readFileSync(path.join(s.projectRoot, 'a.ts'), 'utf8'), 'my unsaved-to-git work\n');
  const after = snapshot(s.projectRoot);
  assert.equal(after['a.ts'], before['a.ts']);
  assert.equal(s.store.load(s.id).artifacts.find((a) => a.path === 'a.ts').approved, null);
});

test('staged-only changes and an untracked file where the bot creates one are also refused', () => {
  const s = scenario({ base: { 'a.ts': 'old\n' }, bot: { 'a.ts': 'new\n', 'n.ts': 'bot\n' } });
  fs.writeFileSync(path.join(s.projectRoot, 'a.ts'), 'staged\n');
  git(s.projectRoot, 'add', 'a.ts');
  fs.writeFileSync(path.join(s.projectRoot, 'n.ts'), 'mine\n');
  const r = s.gate.review(s.id).artifacts;
  assert.deepEqual(codes(r.find((a) => a.path === 'a.ts')), [GATE_CODES.DIRTY]);
  assert.equal(codes(r.find((a) => a.path === 'n.ts'))[0], GATE_CODES.DIRTY);
});

test('a file the user changed in a commit since the bot started is refused (diverged), not merged', () => {
  const s = scenario({ base: { 'a.ts': 'old\n' }, bot: { 'a.ts': 'bot\n' } });
  fs.writeFileSync(path.join(s.projectRoot, 'a.ts'), 'user committed this\n');
  git(s.projectRoot, 'commit', '-qam', 'user moved on');
  const r = s.gate.review(s.id).artifacts[0];
  assert.deepEqual(codes(r), [GATE_CODES.DIVERGED]);
  assert.equal(fs.readFileSync(path.join(s.projectRoot, 'a.ts'), 'utf8'), 'user committed this\n');
});

test('an ignored file already at the create path is not overwritten', () => {
  const s = scenario({ bot: { 'secret.env': 'from the bot\n' } });
  fs.writeFileSync(path.join(s.projectRoot, '.gitignore'), 'secret.env\n');
  fs.writeFileSync(path.join(s.projectRoot, 'secret.env'), 'API_KEY=1\n');
  const r = s.gate.review(s.id).artifacts[0];
  assert.equal(codes(r).includes(GATE_CODES.TARGET_EXISTS), true);
  assert.equal(fs.readFileSync(path.join(s.projectRoot, 'secret.env'), 'utf8'), 'API_KEY=1\n');
});

// ---------------------------------------------------------------------------
// Rule 5 — approved equals applied.
// ---------------------------------------------------------------------------

test('if the bot branch moves after the diff was shown, the approval is stale and nothing lands', () => {
  const s = scenario({ bot: { 'a.ts': 'v1\n' } });
  const shown = approve(s, 'a.ts');
  const wt = path.join(makeTempDir('construct-gate-wt3-'), 'wt');
  git(s.projectRoot, 'worktree', 'add', '-q', wt, botBranch(s.id));
  fs.writeFileSync(path.join(wt, 'a.ts'), 'v2 - changed after review\n');
  git(wt, 'commit', '-qam', 'late change');
  git(s.projectRoot, 'worktree', 'remove', '--force', wt);
  const out = s.gate.decide(s.id, { by: 'o', decisions: [shown] });
  // The recorded hash no longer matches the branch, so it is refused before it can be applied.
  assert.equal(out.results[0].applied, false);
  assert.equal(fs.existsSync(path.join(s.projectRoot, 'a.ts')), false);
});

test('a delete applies as a delete and only for the exact base content', () => {
  const s = scenario({ base: { 'gone.ts': 'bye\n' }, bot: { 'gone.ts': null } });
  const out = s.gate.decide(s.id, { by: 'o', decisions: [approve(s, 'gone.ts')] });
  assert.equal(out.results[0].applied, true);
  assert.equal(fs.existsSync(path.join(s.projectRoot, 'gone.ts')), false);
});

// ---------------------------------------------------------------------------
// Rejection, and rule 8 — cleanup is a consequence.
// ---------------------------------------------------------------------------

test('rejecting discards: nothing lands, the verdict says who, and the branch goes once all are decided', () => {
  const s = scenario({ base: { 'a.ts': 'old\n' }, bot: { 'a.ts': 'new\n', 'b.ts': 'fresh\n' } });
  const before = snapshot(s.projectRoot);
  const out = s.gate.decide(s.id, { by: 'reviewer', decisions: [{ path: 'a.ts', verdict: 'reject' }, { path: 'b.ts', verdict: 'reject' }] });
  assert.equal(out.applied, 0);
  assert.deepEqual(snapshot(s.projectRoot), before);
  const rec = s.store.load(s.id);
  assert.deepEqual(rec.artifacts.map((a) => [a.approved, a.verdict.decision, a.verdict.by]), [[false, 'rejected', 'reviewer'], [false, 'rejected', 'reviewer']]);
  assert.equal(out.cleanup.done, true);
  assert.equal(branchExists(s), false);
});

test('cleanup waits: the branch is kept while any artifact has no verdict, and the pending paths are named', () => {
  const s = scenario({ bot: { 'a.ts': '1\n', 'b.ts': '2\n' } });
  const out = s.gate.decide(s.id, { by: 'o', decisions: [approve(s, 'a.ts')] });
  assert.equal(out.cleanup.done, false);
  assert.deepEqual(out.cleanup.pending, ['b.ts']);
  assert.equal(branchExists(s), true);
  const last = s.gate.decide(s.id, { by: 'o', decisions: [{ path: 'b.ts', verdict: 'reject' }] });
  assert.equal(last.cleanup.done, true);
  assert.equal(branchExists(s), false);
  assert.equal(fs.existsSync(path.join(s.projectRoot, 'a.ts')), true, 'the approved file survives branch deletion');
});

test('a refused-but-approved artifact keeps its branch: it is unresolved', () => {
  const s = scenario({ bot: { 'a.ts': '1\n' }, declared: [] });
  const r = s.gate.review(s.id).artifacts[0];
  const out = s.gate.decide(s.id, { by: 'o', decisions: [{ path: 'a.ts', verdict: 'approve', diffSha256: r.diffSha256 }] });
  assert.equal(out.cleanup.done, false);
  assert.equal(branchExists(s), true);
  // ...and the person can still resolve it by rejecting.
  assert.equal(s.gate.decide(s.id, { by: 'o', decisions: [{ path: 'a.ts', verdict: 'reject' }] }).cleanup.done, true);
});

test('cleanup waits for the process to finish, even when every artifact has a verdict', () => {
  const s = scenario({ bot: { 'a.ts': '1\n' }, state: 'paused' });
  const out = s.gate.decide(s.id, { by: 'o', decisions: [{ path: 'a.ts', verdict: 'reject' }] });
  assert.equal(out.resolved, true);
  assert.equal(out.cleanup.done, false);
  assert.match(out.cleanup.reason, /paused/);
  assert.equal(branchExists(s), true);
});

test('the branch is never deleted while it holds a change that is not a decided artifact', () => {
  const s = scenario({ bot: { 'a.ts': '1\n' } });
  const wt = path.join(makeTempDir('construct-gate-wt4-'), 'wt');
  git(s.projectRoot, 'worktree', 'add', '-q', wt, botBranch(s.id));
  fs.writeFileSync(path.join(wt, 'unrecorded.ts'), 'a change no artifact describes\n');
  git(wt, 'add', '-A');
  git(wt, 'commit', '-q', '-m', 'stray');
  git(s.projectRoot, 'worktree', 'remove', '--force', wt);
  const review = s.gate.review(s.id);
  assert.deepEqual(review.unrecordedBranchChanges, ['unrecorded.ts']);
  const out = s.gate.decide(s.id, { by: 'o', decisions: [{ path: 'a.ts', verdict: 'reject' }] });
  assert.equal(out.cleanup.done, false);
  assert.deepEqual(out.cleanup.stray, ['unrecorded.ts']);
  assert.equal(branchExists(s), true);
});

// ---------------------------------------------------------------------------
// Rule 6 — validate after applying, report, never revert.
// ---------------------------------------------------------------------------

test('post-apply validation reports only NEW violations and does not revert', () => {
  const s = scenario({ bot: { 'a.ts': 'bad\n' } });
  const existing = { rule: 'old-rule', file: 'z.ts', message: 'pre-existing', severity: 'error' };
  const introduced = { rule: 'layering', file: 'a.ts', message: 'a.ts breaks a rule', severity: 'error' };
  let calls = 0;
  const gate = createApprovalGate({ store: s.store, validate: () => ({ violations: ++calls === 1 ? [existing] : [existing, introduced] }) });
  const out = gate.decide(s.id, { by: 'o', decisions: [approve(s, 'a.ts')] });
  assert.equal(out.applied, 1);
  assert.deepEqual(out.validation.newViolations.map((v) => v.file), ['a.ts']);
  assert.equal(out.validation.ok, false);
  assert.equal(out.validation.autoReverted, false);
  assert.equal(fs.readFileSync(path.join(s.projectRoot, 'a.ts'), 'utf8'), 'bad\n', 'not auto-reverted');
  // #546 -- was "new architecture violation(s)"; the wording no longer names one enforcer since
  // validate's default now runs all of them.
  assert.equal(s.store.load(s.id).log.some((e) => e.provenance === 'warn' && /new violation/.test(e.message)), true);
});

test('#546: with no validate override, the gate\'s real default catches a readability-only violation too, not just architecture', () => {
  // A component whose filename doesn't match its export: READ-001, not an architecture rule --
  // the old default (validateArchitecture alone) would have reported zero new violations here.
  const s = scenario({ bot: { 'features/checkout/components/CheckoutBadge.tsx': 'export function Badge(){ return null; }\n' }, realValidate: true });
  const out = s.gate.decide(s.id, { by: 'o', decisions: [approve(s, 'features/checkout/components/CheckoutBadge.tsx')] });
  assert.equal(out.applied, 1);
  assert.ok(out.validation.newViolations.some((v) => v.rule === 'READ-001'), JSON.stringify(out.validation.newViolations));
  assert.equal(out.validation.ok, false);
});

test('a validator that throws is reported, not fatal, and the applied file stays', () => {
  const s = scenario({ bot: { 'a.ts': 'x\n' } });
  const gate = createApprovalGate({ store: s.store, validate: () => { throw new Error('boom'); } });
  const out = gate.decide(s.id, { by: 'o', decisions: [approve(s, 'a.ts')] });
  assert.equal(out.validation.ran, false);
  assert.equal(fs.existsSync(path.join(s.projectRoot, 'a.ts')), true);
});

// ---------------------------------------------------------------------------
// Rule 7 — provenance stays honest.
// ---------------------------------------------------------------------------

test('a deterministic plan leaves no model provenance: step llm stays null and no log entry is `llm`', () => {
  const s = scenario({ bot: { 'a.ts': '1\n' } });
  const before = s.store.load(s.id);
  s.gate.decide(s.id, { by: 'o', decisions: [approve(s, 'a.ts')] });
  const after = s.store.load(s.id);
  assert.deepEqual(after.steps, before.steps);
  assert.equal(after.steps.every((st) => st.llm === null), true);
  assert.equal(after.log.filter((e) => e.provenance === 'llm').length, 0);
  assert.equal(after.log.at(-1).provenance, 'ok');
});

test('a local-model artifact landing in the tree is logged as `llm`, and the step record is untouched', () => {
  const s = scenario({ bot: { 'a.ts': '1\n' }, executor: 'local-model' });
  const before = s.store.load(s.id);
  const r = s.gate.review(s.id).artifacts[0];
  assert.deepEqual(r.llm, { provider: 'ollama', calls: 1 });
  s.gate.decide(s.id, { by: 'o', decisions: [approve(s, 'a.ts')] });
  const after = s.store.load(s.id);
  assert.deepEqual(after.steps, before.steps);
  assert.equal(after.log.filter((e) => e.provenance === 'llm').length, 1);
});

// ---------------------------------------------------------------------------
// End to end with the real runner and engine.
// ---------------------------------------------------------------------------

test('end to end: run a plan in a bot worktree, review, approve one and reject one; worktree and branch are cleaned only at the end', async () => {
  const projectRoot = fs.realpathSync(makeTempDir('construct-gate-e2e-'));
  const stateDir = makeTempDir('construct-gate-e2e-state-');
  git(projectRoot, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(projectRoot, 'README.md'), 'mine\n');
  git(projectRoot, 'add', '-A');
  git(projectRoot, 'commit', '-q', '-m', 'base');
  const p = {
    version: 1,
    ticket: { source: 'text', title: 'Checkout' },
    steps: [
      { id: 'feature', title: 'Create checkout', flow: 'create.feature', args: { name: 'checkout' }, executor: 'deterministic', touches: { features: ['checkout'], files: [{ path: 'features/checkout/index.ts', change: 'create' }] } },
      { id: 'domain', title: 'Scaffold Total', flow: 'create.unit', args: { layer: 'domain', name: 'Total', feature: 'checkout' }, executor: 'deterministic', dependsOn: ['feature'], touches: { features: ['checkout'], files: [{ path: 'features/checkout/domain/Total.ts', change: 'create' }] } },
    ],
  };
  const store = openProcessStore(projectRoot, { stateDir });
  store.save(createProcess(p, { id: 'e2e', projectRoot }));
  const runner = createBotRunner({ stateDir, bin: FAKE_BIN, env: { ...process.env } });
  const engine = createProcessEngine({ store, executeStep: runner.executeStep, maxConcurrent: 1, validate: () => ({ violations: [], ok: true }) });
  engine.start('e2e');
  const done = await engine.settled('e2e');
  assert.equal(done.state, 'done');
  const gate = createApprovalGate({ store, runner, validate: () => ({ violations: [] }) });

  const before = snapshot(projectRoot);
  const review = gate.review('e2e');
  assert.equal(review.artifacts.every((a) => a.applicable), true);
  assert.deepEqual(snapshot(projectRoot), before);

  const first = gate.decide('e2e', { by: 'octocat', decisions: [{ path: 'features/checkout/index.ts', verdict: 'approve', diffSha256: review.artifacts.find((a) => a.path === 'features/checkout/index.ts').diffSha256 }] });
  assert.equal(first.applied, 1);
  assert.equal(first.cleanup.done, false);
  assert.ok(runner.worktreeOf('e2e'), 'the bot worktree survives until every verdict is in');
  assert.equal(fs.readFileSync(path.join(projectRoot, 'features/checkout/index.ts'), 'utf8'), 'export const checkout = true;\n');

  const wtDir = runner.worktreeOf('e2e');
  const last = gate.decide('e2e', { by: 'octocat', decisions: [{ path: 'features/checkout/domain/Total.ts', verdict: 'reject' }] });
  assert.equal(last.cleanup.done, true);
  assert.equal(runner.worktreeOf('e2e'), null);
  assert.equal(fs.existsSync(wtDir), false);
  assert.equal(branchExists({ projectRoot, id: 'e2e' }), false);
  assert.equal(fs.existsSync(path.join(projectRoot, 'features/checkout/domain/Total.ts')), false);
});

void os;
