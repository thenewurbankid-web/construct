// cu7 (Line Cockpit, contract.mjs LINE_API): POST /api/line/new-project -- start a new Line project and open it.
// Needs no open project, so it is mounted at /api/line/new-project BEFORE the other /api/line routers (which all take
// the open project) and below the session gate. Security, in one place:
//   * a foreign browser Origin is refused (403); the route refuses to run when the session gate did not (401);
//   * `parentDir` is contained in the caller's workspace (workspace.mjs contain: real path, must exist, must be a
//     folder, symlinks resolved), so the new folder is always inside the allowed workspace root;
//   * the name and the first feature are checked by the engine (newProject.mjs) before anything is made; the folder
//     is made non-recursively and the starter files land only through Construct's writer (applyChange), gated by
//     the Line validate profile; a refusal leaves nothing behind.
import express from 'express';
import { LineOpError } from '../../../packages/engine/line/contract.mjs';
import { createLineProject } from '../../../packages/engine/line/newProject.mjs';
import { contain, WorkspaceError } from './workspace.mjs';

const plain = (body) => (body && typeof body === 'object' && !Array.isArray(body) ? body : {});

/** Plain sentences for the workspace refusals of the parent folder. */
const PARENT_SENTENCE = {
  OUTSIDE_WORKSPACE: 'That folder is outside your workspace; pick a folder inside it.',
  NOT_FOUND: 'That folder does not exist in your workspace; pick another folder.',
  NOT_DIRECTORY: 'That is a file, not a folder; pick a folder.',
};

/**
 * @param {{
 *   clientOrigin?: string,
 *   getWorkspaceRoot: () => string,
 *   openProject: (dir: string) => object,
 *   ops?: {createLineProject: typeof createLineProject},
 * }} deps `openProject` makes the new folder the open project and returns the settings body (index.mjs passes the
 *   same closure `POST /api/settings` uses); `ops` lets tests pass the contract's mock.
 * @returns {import('express').Router}
 */
export function createLineNewProjectRouter({ clientOrigin, getWorkspaceRoot, openProject, ops = { createLineProject } }) {
  const router = express.Router();
  router.post('/', (req, res) => {
    const origin = req.get('origin');
    if (clientOrigin && origin && origin !== clientOrigin) return res.status(403).json({ ok: false, sentence: 'This request came from a page that is not the Cockpit.', code: 'FOREIGN_ORIGIN' });
    if (req.session === undefined) return res.status(401).json({ ok: false, sentence: 'Sign in to the Cockpit first.', code: 'NO_SESSION' });
    if (!req.is('application/json')) return res.status(415).json({ ok: false, sentence: 'Send the new project as JSON.', code: 'NOT_JSON' });
    const body = plain(req.body);
    const root = getWorkspaceRoot();
    const parentDir = typeof body.parentDir === 'string' ? body.parentDir.trim() : '';
    let parent;
    try {
      parent = contain(root, parentDir === '' ? '.' : parentDir, { mustExist: true, mustBeDir: true });
    } catch (e) {
      if (e instanceof WorkspaceError) return res.status(400).json({ ok: false, sentence: PARENT_SENTENCE[e.code] ?? 'That folder cannot hold a new project; pick another folder.', code: 'BAD_PARENT', detail: e.message });
      if (/** @type {any} */ (e)?.code === 'ENOENT') return res.status(400).json({ ok: false, sentence: PARENT_SENTENCE.NOT_FOUND, code: 'BAD_PARENT' });
      throw e;
    }
    let result;
    try {
      result = ops.createLineProject(parent, { parentDir, name: body.name, firstFeature: body.firstFeature });
    } catch (e) {
      if (e instanceof LineOpError || /** @type {any} */ (e)?.name === 'LineOpError') {
        const { sentence, code } = /** @type {any} */ (e);
        return res.status(code === 'NAME_TAKEN' ? 409 : 400).json({ ok: false, sentence, code });
      }
      return res.status(500).json({ ok: false, sentence: 'Cockpit could not create the project; nothing was kept.', code: 'INTERNAL' });
    }
    if (!result.ok) return res.json(result);
    try {
      return res.json({ ...result, project: openProject(/** @type {string} */ (result.dir)) });
    } catch {
      return res.status(500).json({ ok: false, sentence: 'The project was created but could not be opened; open it from the project list.', code: 'OPEN_FAILED', dir: result.dir });
    }
  });
  return router;
}
