// Run: node --test .claude/hooks/orchestration.test.mjs
// Pipes sample PreToolUse JSON into the hook script, exactly as Claude Code does.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HOOK = path.join(HERE, 'orchestration.mjs');
const ROOT = path.resolve(HERE, '..', '..');
const MEMORY = path.join(os.homedir(), '.claude/projects/-Users-shashank-Repositories-construct/memory/x.md');
const OTHER = path.resolve(ROOT, '..', 'studio-export', 'src', 'server.mjs');
const SCRATCH = '/private/tmp/claude-501/-Users-shashank-Repositories-construct-line-matcher/s/scratchpad';

const cleanEnv = () => { const e = { ...process.env }; delete e.LM_ORCH_OFF; return e; };

function run(stdin, { hook = HOOK, env = cleanEnv() } = {}) {
  const r = spawnSync(process.execPath, [hook], { input: stdin, env, encoding: 'utf8' });
  assert.equal(r.status, 0, `hook must exit 0, got ${r.status}: ${r.stderr}`);
  return r.stdout.trim() ? JSON.parse(r.stdout) : null;
}
const base = (tool_name, tool_input, extra = {}) => JSON.stringify({
  session_id: 's1', transcript_path: '/Users/x/.claude/projects/p/s1.jsonl', cwd: ROOT,
  hook_event_name: 'PreToolUse', tool_name, tool_input, tool_use_id: 't1', ...extra,
});
const denied = (out) => out?.hookSpecificOutput?.permissionDecision === 'deny';
const bash = (command, extra, opts) => run(base('Bash', { command }, extra), opts);

test('main session Edit inside project -> deny, message names the builder', () => {
  const out = run(base('Edit', { file_path: path.join(ROOT, 'src/cli.mjs'), old_string: 'a', new_string: 'b' }));
  assert.ok(denied(out));
  assert.match(out.hookSpecificOutput.permissionDecisionReason, /builder/);
});
test('main session Write and NotebookEdit inside project -> deny', () => {
  assert.ok(denied(run(base('Write', { file_path: path.join(ROOT, 'README.md'), content: 'x' }))));
  assert.ok(denied(run(base('NotebookEdit', { notebook_path: path.join(ROOT, 'n.ipynb'), new_source: 'x' }))));
});
test('main session Edit with a relative path resolves against cwd -> deny', () => {
  assert.ok(denied(run(base('Edit', { file_path: 'src/cli.mjs' }))));
});
test('subagent Edit inside project -> allow', () => {
  assert.equal(run(base('Edit', { file_path: path.join(ROOT, 'src/cli.mjs') }, { agent_id: 'a1', agent_type: 'builder' })), null);
});
test('subagent recognised by agent_id alone, or agent_type alone, or transcript path -> allow', () => {
  const f = { file_path: path.join(ROOT, 'src/cli.mjs') };
  assert.equal(run(base('Write', f, { agent_id: 'a1' })), null);
  assert.equal(run(base('Write', f, { agent_type: 'general-purpose' })), null);
  assert.equal(run(base('Write', f, { transcript_path: '/Users/x/.claude/projects/p/s1/subagents/agent-abc.jsonl' })), null);
});
test('subagent Bash sed -i -> allow', () => {
  assert.equal(bash('sed -i s/a/b/ src/cli.mjs', { agent_id: 'a1', agent_type: 'builder' }), null);
});
test('main session Edit of CLAUDE.md, .claude/**, memory dir -> allow', () => {
  assert.equal(run(base('Edit', { file_path: path.join(ROOT, 'CLAUDE.md') })), null);
  assert.equal(run(base('Write', { file_path: path.join(ROOT, '.claude/agents/builder.md') })), null);
  assert.equal(run(base('Write', { file_path: MEMORY })), null);
});
test('a CLAUDE.md in a subdirectory is not exempt', () => {
  assert.ok(denied(run(base('Write', { file_path: path.join(ROOT, 'src/CLAUDE.md') }))));
});
test('main session Edit outside the project -> allow', () => {
  assert.equal(run(base('Edit', { file_path: OTHER })), null);
  assert.equal(run(base('Write', { file_path: '/private/tmp/claude-501/x/scratchpad/a.txt' })), null);
  // sibling directory whose name merely starts with "line-matcher"
  assert.equal(run(base('Write', { file_path: ROOT + '-other/a.txt' })), null);
});
test('malformed or unexpected input -> allow (fail open)', () => {
  assert.equal(run('{not json'), null);
  assert.equal(run(''), null);
  assert.equal(run('null'), null);
  assert.equal(run('[]'), null);
  assert.equal(run('{}'), null);
  assert.equal(run(JSON.stringify({ tool_name: 'Edit', tool_input: { file_path: path.join(ROOT, 'src/cli.mjs') } })), null, 'no session_id: layout unknown');
  assert.equal(run(base('Edit', 'not an object')), null);
  assert.equal(run(base('Edit', { file_path: 42 })), null);
  assert.equal(run(base('Bash', { command: 42 })), null);
  assert.equal(run(base('Edit', { file_path: path.join(ROOT, 'src/x.mjs') }, { hook_event_name: 'SomethingElse' })), null);
});
test('override: LM_ORCH_OFF=1 -> allow', () => {
  const env = { ...cleanEnv(), LM_ORCH_OFF: '1' };
  assert.equal(run(base('Edit', { file_path: path.join(ROOT, 'src/cli.mjs') }), { env }), null);
  assert.equal(bash('sed -i s/a/b/ src/cli.mjs', undefined, { env }), null);
});
test('override: .claude/orchestration-off file -> allow (hermetic copy of the hook in a temp project)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lm-orch-'));
  try {
    fs.mkdirSync(path.join(tmp, '.claude/hooks'), { recursive: true });
    const copy = path.join(tmp, '.claude/hooks/orchestration.mjs');
    fs.copyFileSync(HOOK, copy);
    const tmpReal = fs.realpathSync(tmp);
    const input = JSON.stringify({
      session_id: 's', cwd: tmpReal, hook_event_name: 'PreToolUse', tool_name: 'Edit',
      tool_input: { file_path: path.join(tmpReal, 'src/a.mjs') },
    });
    assert.ok(denied(run(input, { hook: copy })), 'denied without override');
    fs.writeFileSync(path.join(tmpReal, '.claude/orchestration-off'), '');
    assert.equal(run(input, { hook: copy }), null, 'allowed with override');
    fs.rmSync(path.join(tmpReal, '.claude/orchestration-off'));
    assert.ok(denied(run(input, { hook: copy })), 'denied again once removed');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

// ---- Bash guard (best-effort) ----
test('Bash: sed -i by main -> deny', () => {
  assert.ok(denied(bash('sed -i "" s/a/b/ src/cli.mjs')));
  assert.ok(denied(bash("sed -i.bak 's/a/b/' src/cli.mjs")));
});
test('Bash: redirects, tee, cat > by main into the project -> deny', () => {
  assert.ok(denied(bash('echo hi > notes.txt')));
  assert.ok(denied(bash('echo hi >> src/a.mjs')));
  assert.ok(denied(bash("cat > src/new.mjs <<'EOF'\nline\nEOF")));
  assert.ok(denied(bash('echo hi | tee -a README.md')));
  assert.ok(denied(bash(`echo hi > ${ROOT}/x`, { cwd: '/' })));
});
test('Bash: cp/mv/rm/touch/mkdir inside the project -> deny', () => {
  assert.ok(denied(bash('rm -rf demo-app/src')));
  assert.ok(denied(bash('mv src/a.mjs src/b.mjs')));
  assert.ok(denied(bash('cp /etc/hosts src/hosts')));
  assert.ok(denied(bash('touch x && ls')));
  assert.ok(denied(bash(`cd ${ROOT}/src && rm a.mjs`, { cwd: '/' })));
  assert.ok(denied(bash('bash -c "echo hi > a.txt"')));
});
test('Bash: git commit/checkout/reset from the project -> deny', () => {
  assert.ok(denied(bash('git commit -am x')));
  assert.ok(denied(bash('git checkout main')));
  assert.ok(denied(bash('git reset --hard HEAD')));
  assert.ok(denied(bash('git status && git commit -m x')));
});
test('Bash: npm generators and installs -> deny', () => {
  assert.ok(denied(bash('npm run generate')));
  assert.ok(denied(bash('npm install left-pad')));
});
test('Bash: read-only and allowed commands by main -> allow', () => {
  for (const c of [
    'git status', 'git diff HEAD~1', 'git log --oneline -5', 'git worktree list',
    'git worktree add -b feat /Users/shashank/Repositories/construct-worktrees/x HEAD',
    'git diff > /dev/null', 'git status 2>&1', 'npm test', 'npm run test',
    'node --test src/foo.test.mjs', 'node scripts/x.mjs', 'curl -s http://localhost:8765/health',
    'ls -la src', 'cat README.md | grep ">" ', 'grep -rn "a > b" src', 'echo "x > y"', 'sed -n 1,5p src/cli.mjs',
    'find . -name "*.mjs"', 'rsync -a ./ /Users/shashank/Repositories/construct-worktrees/x/',
    `echo hi > ${SCRATCH}/out.txt`, `cp src/cli.mjs ${SCRATCH}/`, `tee ${SCRATCH}/o.txt < README.md`,
    'cat <<EOF\na > b\nrm -rf x\nEOF',
  ]) assert.equal(bash(c), null, `should allow: ${c}`);
});
test('Bash: git commit from another project directory -> allow', () => {
  assert.equal(bash('git commit -m x', { cwd: path.resolve(ROOT, '..', 'studio-export') }), null);
  assert.equal(bash('echo hi > a.txt', { cwd: path.resolve(ROOT, '..', 'studio-export') }), null);
});
test('Bash: override present -> everything allowed', () => {
  assert.equal(bash('git commit -am x', undefined, { env: { ...cleanEnv(), LM_ORCH_OFF: '1' } }), null);
});
