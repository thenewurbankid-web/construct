// #423 -- which git is installed, asked once per process, and what that version can do.
//
// Why it exists: git ignores configuration keys it does not know, silently. The clone job pins the resolved
// addresses into git with `-c http.curloptResolve=<host>:443:<addrs>` (the anti-rebinding half of its SSRF
// defence); on a git older than the one that introduced that key the pin is a no-op and nothing says so.
//
// The minimum is taken from git's own release notes, not from memory: the 2.37.0 notes
// (Documentation/RelNotes/2.37.0.txt, shipped as /usr/share/doc/git/RelNotes/2.37.0.adoc on Debian) say
// "With the new http.curloptResolve configuration, the CURLOPT_RESOLVE mechanism that allows cURL based
// applications to use pre-resolved IP addresses for the requests is exposed to the scripts." No 2.36.x note
// mentions it.
//
// JSON in, JSON out, never a throw: `{ok:true, version, major, minor, patch, raw}` or `{ok:false, error}`.
import { spawnSync } from 'node:child_process';

export const MIN_GIT_FOR_CURLOPT_RESOLVE = Object.freeze({ major: 2, minor: 37, patch: 0 });
export const GIT_VERSION_TIMEOUT_MS = 30_000;

/** `{major, minor, patch, version}` from any `git --version` line (`2.39.2 (Apple Git-143)`, `2.53.0.windows.1`), or null. */
export function parseGitVersion(raw) {
  const m = String(raw ?? '').match(/(\d+)\.(\d+)(?:\.(\d+))?/);
  if (!m) return null;
  const major = Number(m[1]);
  const minor = Number(m[2]);
  const patch = m[3] === undefined ? 0 : Number(m[3]);
  return { major, minor, patch, version: `${major}.${minor}.${patch}` };
}

export const formatVersion = (v) => `${v.major}.${v.minor}.${v.patch ?? 0}`;

/** True when `v` is `min` or newer. */
export function atLeast(v, min) {
  if (!v || !Number.isInteger(v.major) || !Number.isInteger(v.minor)) return false;
  const a = [v.major, v.minor, v.patch ?? 0];
  const b = [min.major, min.minor, min.patch ?? 0];
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return true;
}

/** Whether this git honours `http.curloptResolve` (see the header for the source of the number). */
export const supportsCurloptResolve = (v) => Boolean(v?.ok !== false) && atLeast(v, MIN_GIT_FOR_CURLOPT_RESOLVE);

let cached = null;

/**
 * Ask `git --version` once (a success is cached for the life of the process; a failure is re-asked, so
 * installing git does not need a restart). argv only, a scrubbed environment, a bounded wait (#413).
 * @param {{spawn?: typeof spawnSync, cache?: boolean}} [opts] test seams
 */
export function gitVersion({ spawn = spawnSync, cache = true } = {}) {
  if (cache && cached) return cached;
  const r = spawn('git', ['--version'], {
    encoding: 'utf8',
    timeout: GIT_VERSION_TIMEOUT_MS,
    killSignal: 'SIGKILL',
    env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: '/nonexistent', LANG: 'C', LC_ALL: 'C', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0' },
  });
  let result;
  const errCode = /** @type {any} */ (r.error)?.code;
  if (errCode === 'ETIMEDOUT') {
    result = { ok: false, error: `git --version did not answer within ${Math.round(GIT_VERSION_TIMEOUT_MS / 1000)} seconds.` };
  } else if (r.error) {
    result = { ok: false, error: `git could not be started (${errCode || r.error.message}). Is git installed and on PATH?` };
  } else if (r.status !== 0) {
    result = { ok: false, error: `git --version exited with status ${r.status}${r.stderr ? `: ${String(r.stderr).trim().slice(0, 200)}` : ''}.` };
  } else {
    const parsed = parseGitVersion(r.stdout);
    result = parsed
      ? { ok: true, ...parsed, raw: String(r.stdout).trim() }
      : { ok: false, error: `Could not read a version from "${String(r.stdout).trim().slice(0, 100)}".` };
  }
  if (cache && result.ok) cached = result;
  return result;
}

/** Forget the cached answer (tests). */
export function resetGitVersionCache() {
  cached = null;
}
