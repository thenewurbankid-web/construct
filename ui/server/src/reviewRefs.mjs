// #312/#313 -- the Review mode's list source: LOCAL BRANCHES, read with `git for-each-ref`.
//
// The list source is an adapter (`localBranches` below); a `GitHub pull requests` source is a later
// ticket and deliberately does not exist here. Whatever the source, the rest of Review only ever sees
// `{name, sha, subject, author, date, current, ahead}` rows and the two commit ids of a comparison.
//
// SECURITY: branch names arrive from the CLIENT. The only accepted refs are the exact names this
// module lists from the CURRENT PROJECT's own repository. `resolveListed` is an equality lookup in
// that list, so anything else -- an option (`--output=x`), a path, `..`, a sha, a name from another
// repository -- is refused before any git command sees it. Callers pass the *sha* downstream, never
// the client string. No repository path is ever accepted from a client: the root comes from Settings.
import { git, repoInfo } from '../../../src/engine/gitTrees.mjs';

const SEP = '\x1f';
const HEADS = 'refs/heads/';
const FORMAT = ['%(refname)', '%(objectname)', '%(committerdate:iso-strict)', '%(authorname)', '%(subject)'].join(SEP);
const HEX_ID = /^[0-9a-f]{40,64}$/;

/** Every local branch of the repository containing `cwd`. `{ok:true, branches, current, top}` or `{ok:false, code, message}`. */
export function listLocalBranches(cwd) {
  const info = repoInfo(cwd);
  if (!info.ok) return { ok: false, code: info.error.code, message: info.error.message };
  const r = git(info.top, ['for-each-ref', `--format=${FORMAT}`, '--sort=-committerdate', HEADS]);
  if (r.status !== 0) return { ok: false, code: 'GIT_FAILED', message: `git for-each-ref failed: ${r.stderr.trim() || 'unknown error'}` };
  const branches = r.stdout.split('\n').filter(Boolean).map((line) => {
    const [ref, sha, date, author, ...subject] = line.split(SEP);
    return { name: ref.slice(HEADS.length), sha, date, author, subject: subject.join(SEP) };
  }).filter((b) => b.name && HEX_ID.test(b.sha));
  const head = git(info.top, ['symbolic-ref', '--quiet', '--short', 'HEAD']);
  const current = head.status === 0 ? head.stdout.trim() : null;
  return { ok: true, top: info.top, branches: branches.map((b) => ({ ...b, current: b.name === current })), current };
}

/** The listed branch whose name is EXACTLY `name`, or null. The one place a client string becomes a ref. */
export function resolveListed(branches, name) {
  if (typeof name !== 'string' || name === '' || name.length > 256) return null;
  return branches.find((b) => b.name === name) || null;
}

/** The branch a change is reviewed against by default: main, then master, then the checked-out one. */
export function defaultBase(branches, current) {
  for (const n of ['main', 'master', 'develop', 'trunk']) if (branches.some((b) => b.name === n)) return n;
  return current && branches.some((b) => b.name === current) ? current : (branches[0]?.name ?? null);
}

/** Commits on `head` that `base` does not have. Both are commit ids taken from the validated list. */
export function commitsAhead(top, baseSha, headSha) {
  const r = git(top, ['rev-list', '--count', `${baseSha}..${headSha}`, '--']);
  const n = Number.parseInt(r.stdout.trim(), 10);
  return r.status === 0 && Number.isFinite(n) ? n : null;
}

/** The adapter: what Review needs from a list source. A GitHub-PR source would implement the same shape. */
export const localBranches = { id: 'local-branches', label: 'Local branches', list: listLocalBranches, resolve: resolveListed };
