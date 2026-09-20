// "Is there a project, and is its root inside the workspace?" (#365). One place answers it for every route
// that needs a project, so the answer is the same 409 body everywhere and no route can fall back to
// `process.cwd()` or to the directory the server was started in.
import fs from 'node:fs';
import { findProjectRoot } from '../../../src/config.mjs';
import { getProjectDir } from './settings.mjs';
import { isInside, workspaceRoot } from './workspace.mjs';

export const NO_PROJECT_BODY = Object.freeze({
  ok: false,
  code: 'NO_PROJECT',
  error: 'No project is open. Open a project from the workspace first.',
});

export const OUTSIDE_ROOT_BODY = Object.freeze({
  ok: false,
  code: 'PROJECT_ROOT_OUTSIDE_WORKSPACE',
  error: 'The nearest architecture.yml above this folder is outside the workspace, so it is not used. Initialize a project inside the workspace instead.',
});

/** The Construct project root for `projectDir` (nearest architecture.yml, searching upward), or null when there
 * is none INSIDE the workspace. The upward search is the CLI's own; this only refuses a root it climbed out to. */
export function containedProjectRoot(projectDir) {
  if (!projectDir) return null;
  const up = findProjectRoot(projectDir);
  if (up === null) return null;
  try {
    return isInside(workspaceRoot(), fs.realpathSync.native(up)) ? up : null;
  } catch {
    return null;
  }
}

/** True when an architecture.yml exists above `projectDir` but only outside the workspace. */
export function rootEscapesWorkspace(projectDir) {
  return Boolean(projectDir) && findProjectRoot(projectDir) !== null && containedProjectRoot(projectDir) === null;
}

/** Express middleware: 409 NO_PROJECT when nothing is open. `allowEscapingRoot` (used by init) skips the
 * outside-root check, since init creates a new project at the open folder. */
export function requireProject({ allowEscapingRoot = false } = {}) {
  return (req, res, next) => {
    const dir = getProjectDir();
    if (dir === null) return res.status(409).json(NO_PROJECT_BODY);
    if (!allowEscapingRoot && rootEscapesWorkspace(dir)) return res.status(409).json(OUTSIDE_ROOT_BODY);
    return next();
  };
}
