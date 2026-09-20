/**
 * Side-effect import for ui/server tests (#365). The Cockpit server confines every project to ONE workspace root
 * (`CONSTRUCT_WORKSPACE_ROOT`, default `$HOME/workspace`). Tests build their fixtures in the OS temp directory, so
 * they run with that as the workspace root, and with a private state directory so nothing is written under the
 * developer's real `~/.local/state/construct`. Import it FIRST in any test that loads `settings.mjs`/`index.mjs`:
 *
 *   import '../../../test-utils/workspaceRoot.mjs';
 *
 * The containment logic itself is tested against a real, narrow workspace in ui/server/src/workspace.test.mjs and
 * by the workspace Playwright config; this only gives the OTHER tests somewhere legal to put their projects.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.CONSTRUCT_WORKSPACE_ROOT ||= fs.realpathSync(os.tmpdir());
if (!process.env.CONSTRUCT_STATE_DIR) {
  process.env.CONSTRUCT_STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-test-state-'));
  process.on('exit', () => fs.rmSync(process.env.CONSTRUCT_STATE_DIR, { recursive: true, force: true }));
}
