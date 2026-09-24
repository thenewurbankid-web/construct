// #445 (part of #562) -- "New project": one name in, an initialised project in the caller's workspace out.
// The same deterministic `construct init` the "Initialize Construct here" button runs; no model is called
// anywhere on this path.
//
// Mount AFTER `app.use('/api', auth.requireSession)` and the per-user workspace middleware (index.mjs does), and
// NOT behind `requireProject` (there is no project yet by definition). Security, in one place:
//   * a foreign browser Origin is refused (403), and the route refuses to run when the session gate did not
//     (`req.session === undefined` -> 401), like the clone routes;
//   * the client sends a NAME (and optionally a framework) only. The path is derived here: the name is a
//     single validated segment (the clone folder-name rule, gitUrl.validateSlug: no separators, no `..`, no
//     absolute path, no leading dot) joined onto `workspaceRoot()` and passed through `contain()`, and the result
//     must be a DIRECT child of that root;
//   * nothing is created on a refusal. An existing name (a folder, a file or a symlink, dangling or not) is a plain
//     409; the folder is made with a non-recursive mkdir, so a race for the same name has exactly one winner;
//   * when init itself fails the folder this request just made is removed again, so a failure leaves nothing behind.
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { validateSlug, CloneInputError } from './gitUrl.mjs';
import { contain, WorkspaceError, workspaceRoot } from './workspace.mjs';

export const NEW_PROJECT_FRAMEWORKS = Object.freeze(['nextjs', 'react-spa']);

const fail = (status, code, error) => ({ status, body: { ok: false, code, error } });

/**
 * Validate the request and return the folder to create, or a refusal. Pure of side effects: nothing is written.
 * @param {unknown} body
 * @returns {{ok:true, name:string, framework:string, dir:string} | {ok:false, status:number, body:object}}
 */
export function planNewProject(body) {
  const { name, framework } = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  if (typeof name !== 'string') return { ok: false, ...fail(400, 'BAD_NAME', 'A project name is required.') };
  if (framework !== undefined && framework !== null && !NEW_PROJECT_FRAMEWORKS.includes(framework)) {
    return { ok: false, ...fail(400, 'BAD_FRAMEWORK', `The framework must be one of: ${NEW_PROJECT_FRAMEWORKS.join(', ')}.`) };
  }
  let slug;
  try {
    slug = validateSlug(name);
  } catch (e) {
    if (e instanceof CloneInputError) return { ok: false, ...fail(400, e.code, e.message.replace('A folder name', 'A project name').replace('That folder name', 'That project name')) };
    throw e;
  }
  const root = workspaceRoot();
  // Taken is judged on the NAME (lstat: a symlink, dangling or leading out, is "something there"), before
  // containment, so a taken name always answers the same plain 409 and never a confusing "outside the workspace".
  if (fs.lstatSync(path.join(root, slug), { throwIfNoEntry: false }) !== undefined) {
    return { ok: false, ...fail(409, 'EXISTS', `There is already something called "${slug}" in your workspace. Choose another name.`) };
  }
  let dir;
  try {
    dir = contain(root, slug, { mustExist: false });
  } catch (e) {
    if (e instanceof WorkspaceError) return { ok: false, ...fail(e.status, e.code, e.message) };
    throw e;
  }
  // Belt and braces: a valid slug is one segment, but the answer must also BE one segment of the workspace root.
  if (path.dirname(dir) !== root || path.basename(dir) !== slug) {
    return { ok: false, ...fail(403, 'OUTSIDE_WORKSPACE', 'That name is not allowed.') };
  }
  return { ok: true, name: slug, framework: framework ?? 'nextjs', dir };
}

/**
 * @param {{
 *   clientOrigin?: string,
 *   runInit: (dir: string, framework: string) => Promise<{ok:boolean, error?:string, output?:string[]}>,
 *   openProject: (dir: string) => object,
 * }} deps
 *   `runInit` is the in-process `construct init` (captured); `openProject` makes `dir` the current project and returns
 *   the settings body the client renders (index.mjs passes the same closure `POST /api/settings` uses).
 */
export function createNewProjectRouter({ clientOrigin, runInit, openProject }) {
  const router = express.Router();
  router.use((req, res, next) => {
    const origin = req.get('origin');
    if (clientOrigin && origin && origin !== clientOrigin) return res.status(403).json({ ok: false, error: 'This request came from a page that is not the Cockpit.' });
    if (req.session === undefined) return res.status(401).json({ ok: false, error: 'Authentication required.' });
    return next();
  });

  router.post('/', async (req, res) => {
    const plan = planNewProject(req.body);
    if (!plan.ok) return res.status(plan.status).json(plan.body);
    // Non-recursive: EEXIST for anything already at that name (folder, file, symlink), so nothing is ever overwritten.
    try {
      fs.mkdirSync(plan.dir);
    } catch (e) {
      if (e.code === 'EEXIST') return res.status(409).json({ ok: false, code: 'EXISTS', error: `There is already something called "${plan.name}" in your workspace. Choose another name.` }); // lost a race
      return res.status(500).json({ ok: false, code: 'CREATE_FAILED', error: 'The project folder could not be created.' });
    }
    let result;
    try {
      result = await runInit(plan.dir, plan.framework);
    } catch (e) {
      result = { ok: false, error: e?.message ?? 'Initialising the project failed.' };
    }
    if (!result.ok) {
      fs.rmSync(plan.dir, { recursive: true, force: true });
      return res.status(500).json({ ok: false, code: 'INIT_FAILED', error: `The project could not be set up, and nothing was kept: ${result.error ?? 'unknown error'}` });
    }
    try {
      return res.status(201).json({ ok: true, name: plan.name, framework: plan.framework, ...openProject(plan.dir) });
    } catch (e) {
      return res.status(500).json({ ok: false, code: 'OPEN_FAILED', error: `The project "${plan.name}" was created but could not be opened: ${e?.message ?? 'unknown error'}` });
    }
  });

  router.use((req, res) => res.status(404).json({ ok: false, error: 'Not found.' }));
  return router;
}
