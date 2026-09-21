// #330 slice A -- REST surface for cloning a public repository into the workspace, and for connecting a local
// project to a remote ("origin").
//
// Mount BOTH routers AFTER `app.use('/api', auth.requireSession)` (index.mjs does). Every route:
//   * refuses a foreign browser Origin (403), like the other mutating routes;
//   * a mutating route also refuses to run when the session gate did not (`req.session === undefined` -> 401),
//     so it can never be the route that was mounted above the gate by mistake;
//   * takes ONLY a URL (and optionally a folder name / depth) from the client. Paths, git flags and the
//     environment are built on the server (cloneJobs.mjs), never from client strings.
import express from 'express';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { parseCloneUrl, CloneInputError } from './gitUrl.mjs';

function guard(clientOrigin, mutating) {
  return (req, res, next) => {
    const origin = req.get('origin');
    if (clientOrigin && origin && origin !== clientOrigin) return res.status(403).json({ ok: false, error: 'This request came from a page that is not the Cockpit.' });
    if (mutating && req.session === undefined) return res.status(401).json({ ok: false, error: 'Authentication required.' });
    return next();
  };
}

const bodyOf = (req) => (req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {});

/** @param {{jobs: ReturnType<typeof import('./cloneJobs.mjs').createCloneJobs>, clientOrigin?: string}} deps */
export function createCloneRouter({ jobs, clientOrigin }) {
  const router = express.Router();
  router.use((req, res, next) => guard(clientOrigin, req.method !== 'GET')(req, res, next));

  router.get('/', (req, res) => res.json({ ok: true, jobs: jobs.list() }));
  router.get('/:id', (req, res) => {
    const job = jobs.get(req.params.id);
    return job ? res.json({ ok: true, job }) : res.status(404).json({ ok: false, error: 'No such clone.' });
  });

  router.post('/', async (req, res) => {
    const body = bodyOf(req);
    const { url, name, depth, branch } = body;
    // The one-time access token (#330 slice B) is taken out of the parsed body at once: from here on it lives only
    // in cloneJobs' Buffer, never in `req.body`, a log line, a job record or a response.
    const token = body.token;
    if (req.body && typeof req.body === 'object') delete req.body.token;
    if (typeof url !== 'string' || (name !== undefined && name !== null && typeof name !== 'string') || (branch !== undefined && branch !== null && typeof branch !== 'string')) {
      return res.status(400).json({ ok: false, code: 'BAD_URL', error: 'A repository URL (a string) is required.' });
    }
    const started = await jobs.start({ url, name, branch, token, depth: depth === undefined || depth === null ? null : Number(depth) });
    if (!started.ok) return res.status(started.status).json({ ok: false, code: started.code, error: started.error });
    return res.status(202).json({ ok: true, job: started.job });
  });

  // "Pull latest" for a clone this Cockpit made. Registered before the /:id routes.
  router.post('/pull', async (req, res) => {
    const body = bodyOf(req);
    const token = body.token;
    if (req.body && typeof req.body === 'object') delete req.body.token;
    if (typeof body.name !== 'string') return res.status(400).json({ ok: false, code: 'BAD_NAME', error: 'A folder name (a string) is required.' });
    const result = await jobs.pull({ name: body.name, token });
    if (!result.ok) return res.status(result.status).json({ ok: false, code: result.code, error: result.error });
    return res.json(result);
  });

  router.post('/:id/cancel', (req, res) => {
    const { status, body } = jobs.cancel(req.params.id);
    return res.status(status).json(body);
  });

  router.use((req, res) => res.status(404).json({ ok: false, error: 'Not found.' }));
  return router;
}

/** git for the connect-a-remote routes. Argv only, a scrubbed environment, no hooks or prompts. */
function runGit(cwd, args) {
  const res = spawnSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], {
    cwd, encoding: 'utf8', timeout: 10_000,
    env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: '/nonexistent', LANG: 'C', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0' },
  });
  return { ok: res.status === 0, out: (res.stdout ?? '').trim(), err: (res.stderr || res.error?.message || '').trim() };
}

/** What "connected" means for the open project: a git repo that has an `origin`. */
export function remoteStatus(root) {
  // The project must BE the repository's top level: a project folder inside some larger repo is not "connected"
  // by that repo's remote, and adding one here would edit the parent's configuration.
  const top = runGit(root, ['rev-parse', '--show-toplevel']);
  let same = false;
  try { same = top.ok && fs.realpathSync.native(top.out) === fs.realpathSync.native(root); } catch { /* not a repo */ }
  if (!same) return { repo: false, connected: false, url: null };
  const url = runGit(root, ['remote', 'get-url', 'origin']);
  return { repo: true, connected: url.ok, url: url.ok ? url.out.replace(/\/\/[^/@]*@/, '//') : null };
}

/**
 * @param {{getRoot: () => {ok:true, root:string}|{ok:false, error:string}, clientOrigin?: string, hosts?: readonly string[]}} deps
 *   `getRoot` is the current project's contained root (index.mjs passes the same closure Review/Tests use).
 */
export function createRemoteRouter({ getRoot, clientOrigin, hosts }) {
  const router = express.Router();
  router.use((req, res, next) => guard(clientOrigin, req.method !== 'GET')(req, res, next));

  router.get('/', (req, res) => {
    const r = getRoot();
    if (!r.ok) return res.status(409).json({ ok: false, code: 'NO_PROJECT', error: r.error });
    return res.json({ ok: true, ...remoteStatus(r.root) });
  });

  // Connect: add `origin` to a project that has none. A remote that is already there is never overwritten.
  router.post('/', (req, res) => {
    const r = getRoot();
    if (!r.ok) return res.status(409).json({ ok: false, code: 'NO_PROJECT', error: r.error });
    const { url } = bodyOf(req);
    let parsed;
    try {
      parsed = parseCloneUrl(url, { hosts });
    } catch (e) {
      if (e instanceof CloneInputError) return res.status(e.status).json({ ok: false, code: e.code, error: e.message });
      throw e;
    }
    const before = remoteStatus(r.root);
    if (!before.repo) return res.status(409).json({ ok: false, code: 'NOT_A_REPO', error: 'This project is not a git repository yet. Run "git init" in it first.' });
    if (before.connected) return res.status(409).json({ ok: false, code: 'ALREADY_CONNECTED', error: `This project already has a remote (origin: ${before.url}). It was not changed.` });
    const added = runGit(r.root, ['remote', 'add', 'origin', parsed.url]);
    if (!added.ok) return res.status(500).json({ ok: false, code: 'REMOTE_FAILED', error: 'git could not add the remote.' });
    return res.json({ ok: true, ...remoteStatus(r.root) });
  });

  router.use((req, res) => res.status(404).json({ ok: false, error: 'Not found.' }));
  return router;
}
