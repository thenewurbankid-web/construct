// The narrowest possible git interface the Cockpit needs (#283).
//
// WHY THIS IS NOT A LIBRARY YET. #283's body says to reuse whatever git library #277's source-
// control UI (#296) adopts. #296 has not adopted one — nothing git-shaped is installed today — and
// picking `simple-git` vs `isomorphic-git` for that ticket as a side effect of this one would be
// the wrong way round. So this module is deliberately small and deliberately boring: seven
// functions over `execFileSync`, with argument ARRAYS and never a shell string, so there is no
// quoting or injection surface. When #296 picks a library, this file's body is replaced and
// nothing that imports it moves.
//
// Everything here is scoped to a caller-supplied project root and refuses paths that escape it.
// Nothing here decides *whether* to commit — that is autoCommit.mjs — and nothing here builds a
// message; that is core's src/engine/commitMessage.mjs.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export class GitError extends Error {
  constructor(message, { status = 500, code = 'GIT_ERROR', stderr = '' } = {}) {
    super(message);
    this.name = 'GitError';
    this.status = status;
    this.code = code;
    this.stderr = stderr;
  }
}

/** A branch name git itself would accept, plus our own tightening (no leading dash, no spaces). */
const BRANCH_OK = /^(?!-)(?!.*\.\.)(?!.*[~^:?*[\\\s])[A-Za-z0-9][A-Za-z0-9._/-]*$/;

/** Run one git command. Never a shell: `args` is an argv array. */
export function git(root, args, { input, allowFail = false } = {}) {
  try {
    const stdout = execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      input,
      maxBuffer: 16 * 1024 * 1024,
      // A Cockpit save must not hang on a pager, a credential prompt or an editor.
      env: { ...process.env, GIT_PAGER: 'cat', GIT_TERMINAL_PROMPT: '0', GIT_EDITOR: 'true' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { ok: true, stdout: stdout || '' };
  } catch (e) {
    const stderr = String(e?.stderr || e?.message || '');
    if (allowFail) return { ok: false, stdout: String(e?.stdout || ''), stderr };
    throw new GitError(`git ${args[0]} failed: ${stderr.split('\n')[0] || 'unknown error'}`, { stderr });
  }
}

/** True when `root` is inside a git work tree (and is its own root, not a subdirectory of one). */
export function isRepo(root) {
  if (!root || !fs.existsSync(root)) return false;
  const r = git(root, ['rev-parse', '--show-toplevel'], { allowFail: true });
  if (!r.ok) return false;
  return path.resolve(r.stdout.trim()) === path.resolve(root);
}

/** The checked-out branch, or null on a detached HEAD / an unborn branch with no commits yet. */
export function currentBranch(root) {
  const r = git(root, ['rev-parse', '--abbrev-ref', 'HEAD'], { allowFail: true });
  const name = r.ok ? r.stdout.trim() : '';
  return !name || name === 'HEAD' ? null : name;
}

export function headSha(root) {
  const r = git(root, ['rev-parse', 'HEAD'], { allowFail: true });
  return r.ok ? r.stdout.trim() : null;
}

export function branchExists(root, name) {
  return git(root, ['rev-parse', '--verify', '--quiet', `refs/heads/${name}`], { allowFail: true }).ok;
}

/** Create `name` from the current HEAD and check it out. Uncommitted work comes along, which is
 * exactly what the "carry" answer to the dirty-tree prompt wants. */
export function createBranch(root, name) {
  if (!BRANCH_OK.test(name)) throw new GitError(`Refusing to create an unsafe branch name: ${name}`, { status: 400, code: 'BAD_BRANCH' });
  if (branchExists(root, name)) throw new GitError(`Branch already exists: ${name}`, { status: 409, code: 'BRANCH_EXISTS' });
  git(root, ['checkout', '-b', name]);
  return name;
}

const KIND_BY_CODE = { A: 'add', M: 'update', R: 'update', C: 'update', D: 'delete', '?': 'add', U: 'update', T: 'update' };

/**
 * The working tree's changes, as `{path, kind, staged, untracked}`. Uses `-z` so paths containing
 * spaces or quotes come back verbatim rather than C-quoted.
 */
export function status(root) {
  const { stdout } = git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all']);
  const out = [];
  const parts = stdout.split('\0');
  for (let i = 0; i < parts.length; i += 1) {
    const entry = parts[i];
    if (!entry) continue;
    const x = entry[0];
    const y = entry[1];
    let file = entry.slice(3);
    if (x === 'R' || x === 'C') { i += 1; file = parts[i] ?? file; } // rename: "XY old\0new"
    const code = x === ' ' || x === '?' ? y : x;
    out.push({
      path: file,
      kind: KIND_BY_CODE[code === '?' ? '?' : code] || 'update',
      staged: x !== ' ' && x !== '?',
      untracked: x === '?',
    });
  }
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

const insideRoot = (root, rel) => {
  const abs = path.resolve(root, rel);
  const base = path.resolve(root);
  return abs === base || abs.startsWith(base + path.sep);
};

/** Stage exactly these project-relative paths — never `git add -A`, so a Cockpit save can never
 * sweep up unrelated work the user had open. */
export function stage(root, paths) {
  const list = [...new Set(paths)].filter((p) => typeof p === 'string' && p && !p.includes('\0'));
  for (const p of list) {
    if (!insideRoot(root, p)) throw new GitError(`Refusing to stage a path outside the project: ${p}`, { status: 400, code: 'PATH_ESCAPE' });
  }
  if (!list.length) return [];
  git(root, ['add', '--', ...list]);
  return list;
}

/** Are there staged changes to commit? */
export function hasStagedChanges(root) {
  return !git(root, ['diff', '--cached', '--quiet'], { allowFail: true }).ok;
}

/**
 * Commit whatever is staged, with `message` passed on **stdin** (`-F -`) so a multi-line body with
 * arbitrary punctuation never touches an argument list.
 * @returns {{sha: string, subject: string}}
 */
export function commit(root, message, { author } = {}) {
  if (typeof message !== 'string' || !message.trim()) throw new GitError('A commit message is required.', { status: 400, code: 'EMPTY_MESSAGE' });
  const identity = [];
  // Only supply an identity when the repo/global config has none — a user's own git config wins.
  if (!git(root, ['config', 'user.email'], { allowFail: true }).stdout.trim()) {
    identity.push('-c', `user.email=${author?.email || 'cockpit@construct.local'}`, '-c', `user.name=${author?.name || 'Construct Cockpit'}`);
  }
  git(root, [...identity, 'commit', '--no-verify', '-F', '-'], { input: message });
  const sha = headSha(root);
  const subject = git(root, ['log', '-1', '--format=%s'], { allowFail: true }).stdout.trim();
  return { sha, subject };
}

/** Commit subjects on the current branch, newest first — the input `nextSerialFrom` reads. */
export function subjectsOn(root, { limit = 500, branch = 'HEAD' } = {}) {
  const r = git(root, ['log', `-${limit}`, '--format=%s', branch], { allowFail: true });
  return r.ok ? r.stdout.split('\n').filter(Boolean) : [];
}

/**
 * Stash exactly these paths (the dirty-tree "stash" answer), including untracked ones, with a label
 * the user can find again. Scoped to the given paths so a stash never swallows the session's own
 * work. Returns the stash ref, so the UI can say plainly where it went.
 */
export function stashPaths(root, paths, label) {
  const list = [...new Set(paths)].filter(Boolean);
  if (!list.length) return null;
  for (const p of list) {
    if (!insideRoot(root, p)) throw new GitError(`Refusing to stash a path outside the project: ${p}`, { status: 400, code: 'PATH_ESCAPE' });
  }
  git(root, ['stash', 'push', '--include-untracked', '-m', label, '--', ...list]);
  const ref = git(root, ['stash', 'list', '--format=%gd %gs', '-1'], { allowFail: true }).stdout.trim();
  return ref || 'stash@{0}';
}
