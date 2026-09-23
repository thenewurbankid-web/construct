// #525 -- the CLI's real version, for `construct --version`/`-v`.
//
// Unbundled (this file run directly via `node`, e.g. from a repo checkout,
// or under `npm test`): reads packages/cli/package.json next to this file,
// so the value is always the real, current package version -- never
// hardcoded, never drifts from what a `git clone` + `npm ci` actually
// installs.
//
// Bundled (packages/cli/dist/construct.mjs, built by build.mjs): the built
// file has no package.json sitting next to it (that's the point -- a single
// self-contained file with zero dependency on the workspace's relative
// layout), so build.mjs bakes the version in at build time via esbuild's
// `define`, replacing `process.env.CONSTRUCT_CLI_VERSION` with a literal
// string. `process.env.CONSTRUCT_CLI_VERSION` is otherwise just an
// ordinary (normally unset) environment variable, so this same code path
// behaves correctly whether or not the define ran.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

/** The real `construct` CLI version: `packages/cli/package.json`'s `version` field (or the build-time-baked value in the built bundle). */
export function getVersion() {
  if (process.env.CONSTRUCT_CLI_VERSION) return process.env.CONSTRUCT_CLI_VERSION;
  const pkgPath = fileURLToPath(new URL('./package.json', import.meta.url));
  return JSON.parse(fs.readFileSync(pkgPath, 'utf8')).version;
}
