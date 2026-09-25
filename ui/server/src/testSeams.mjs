// #650 -- the CONSTRUCT_E2E_* test seams: environment variables that exist only so the e2e suite can start the Cockpit with
// a project already open, clone from a local directory, or point the GitHub connection at a mock. Each one weakens a
// guarantee production relies on, so each is refused (AuthConfigError: index.mjs prints it and exits 1) when
//   - NODE_ENV=production (any case, like CONSTRUCT_AUTH_TEST_USER in auth.mjs), or
//   - the server is bound beyond loopback.
// One registry, one helper: a seam read anywhere under ui/server/src must be listed here and go through `refuseTestSeam`
// (testSeams.test.mjs greps the sources for CONSTRUCT_E2E_ reads and fails on one that is not listed).
import path from 'node:path';
import { AuthConfigError, isLoopbackHost } from './auth.mjs';

const trimmed = (v) => (typeof v === 'string' ? v.trim() : '');

/** Case-insensitive on purpose, exactly as CONSTRUCT_AUTH_TEST_USER: `NODE_ENV=Production` is production. */
export const isProduction = (env) => trimmed(env?.NODE_ENV).toLowerCase() === 'production';

/** key -> the variables of one seam and what it would let through. */
export const TEST_SEAMS = {
  projectDir: {
    vars: ['CONSTRUCT_E2E_PROJECT_DIR'],
    why: 'It opens a project at start-up without anyone choosing it, which the Cockpit otherwise never does.',
  },
  cloneLocalRoot: {
    vars: ['CONSTRUCT_E2E_CLONE_LOCAL_ROOT'],
    why: 'It lets file:// URLs under a directory be cloned; the production clone path is https-only.',
  },
  githubRepoBases: {
    vars: ['CONSTRUCT_E2E_GITHUB_REPO_OAUTH_BASE', 'CONSTRUCT_E2E_GITHUB_REPO_API_BASE'],
    why: 'They point the GitHub connection at a stand-in for github.com and api.github.com, so a login would go somewhere that is not GitHub.',
  },
};

/** Every variable named by a seam. */
export const TEST_SEAM_VARS = Object.values(TEST_SEAMS).flatMap((s) => s.vars);

const list = (vars) => vars.join(' / ');

/**
 * Throw AuthConfigError when `key`'s seam is set in `env` and the process is a production one or is exposed beyond loopback.
 * -> the seam's non-empty variables (name -> raw value) for the caller to use when it is allowed.
 * @param {Record<string,string|undefined>} env
 * @param {string} host  the address the server binds
 * @param {keyof typeof TEST_SEAMS} key
 */
export function refuseTestSeam(env, host, key) {
  const seam = TEST_SEAMS[key];
  if (!seam) throw new Error(`unknown test seam "${String(key)}"`);
  const set = Object.fromEntries(seam.vars.filter((v) => trimmed(env?.[v]) !== '').map((v) => [v, env[v]]));
  if (Object.keys(set).length === 0) return set;
  const many = seam.vars.length > 1;
  if (isProduction(env)) {
    throw new AuthConfigError(`${list(seam.vars)} ${many ? 'are' : 'is'} set while NODE_ENV=production. ${seam.why} ${many ? 'They exist' : 'It exists'} only for the e2e suite — refusing to start rather than run with a test seam in production. Unset ${many ? 'them' : 'it'}.`);
  }
  if (!isLoopbackHost(host)) {
    throw new AuthConfigError(`${list(seam.vars)} ${many ? 'are test-harness settings and are' : 'is a test-harness setting and is'} refused when the server is exposed beyond loopback.`);
  }
  return set;
}

/**
 * The seams index.mjs itself consumes, checked as one: any CONSTRUCT_E2E_* variable at all in a production environment is
 * refused (so a seam added later without a registry entry is still stopped), then each registered seam is checked for
 * production and loopback.
 * -> { projectDir: string|null, cloneLocalRoot: string|null }
 */
export function resolveHarnessSeams(env = process.env, { host = '127.0.0.1' } = {}) {
  if (isProduction(env)) {
    const stray = Object.keys(env).filter((k) => k.startsWith('CONSTRUCT_E2E_') && trimmed(env[k]) !== '' && !TEST_SEAM_VARS.includes(k));
    if (stray.length > 0) {
      throw new AuthConfigError(`${list(stray)} ${stray.length > 1 ? 'are' : 'is'} set while NODE_ENV=production. CONSTRUCT_E2E_* variables are test seams that exist only for the e2e suite — refusing to start rather than run with one in production. Unset ${stray.length > 1 ? 'them' : 'it'}.`);
    }
  }
  const project = refuseTestSeam(env, host, 'projectDir').CONSTRUCT_E2E_PROJECT_DIR;
  const clone = refuseTestSeam(env, host, 'cloneLocalRoot').CONSTRUCT_E2E_CLONE_LOCAL_ROOT;
  return { projectDir: project ?? null, cloneLocalRoot: clone === undefined ? null : path.resolve(clone) };
}
