// #365 e2e harness: where the Cockpit server's workspace is, and (harness only) which project is preloaded.
//
// The product starts with NO project and confines every path to one workspace root. The ordinary specs create
// their fixture projects with mkdtemp in the OS temp directory, so the ordinary configs run the server with
// THAT as the workspace root. The containment rules themselves are proven against a real, narrow workspace by
// tests/workspace.spec.js under playwright.workspace.config.js.
//
// `CONSTRUCT_E2E_PROJECT_DIR` is the only way to start with a project open. It exists only for these configs;
// the server passes it through the same containment as any client choice and refuses it on a non-loopback host.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.resolve(HERE, '../../../bin/construct.mjs');

/** The OS temp dir as a real path: the workspace root the ordinary configs use. */
export const tmpWorkspaceRoot = () => fs.realpathSync(os.tmpdir());

/** A freshly `construct init`-ed project inside the tmp workspace, created once per Playwright run (the
 * config is evaluated in the runner and again in each worker, so the path is shared through the environment). */
export function defaultProject() {
  if (process.env.E2E_DEFAULT_PROJECT && fs.existsSync(process.env.E2E_DEFAULT_PROJECT)) return process.env.E2E_DEFAULT_PROJECT;
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'construct-e2e-default-project-')));
  execFileSync(process.execPath, [BIN, 'init', dir], { stdio: 'ignore' });
  process.env.E2E_DEFAULT_PROJECT = dir;
  return dir;
}

/** Server env: workspace = tmp dir, project preloaded (what every pre-#365 spec implicitly relied on). */
export function workspaceEnv({ preload = true } = {}) {
  return {
    CONSTRUCT_WORKSPACE_ROOT: tmpWorkspaceRoot(),
    ...(preload ? { CONSTRUCT_E2E_PROJECT_DIR: defaultProject() } : {}),
  };
}
