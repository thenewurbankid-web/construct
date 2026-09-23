#!/usr/bin/env node
// #525 -- bundles packages/cli/construct.mjs into a single self-contained
// packages/cli/dist/construct.mjs: inlines its own relative-import graph
// (packages/core, packages/ast, packages/engine) so the built CLI has zero
// runtime dependency on this repo's package-workspace folder layout. Real
// npm dependencies (js-yaml, diff, minimatch, react-docgen, typescript, ...)
// stay ordinary node_modules imports -- esbuild's `packages: 'external'`
// leaves every bare specifier alone and bundles only relative/absolute
// imports, so a plain `npm ci` at the repo root (which hoists every
// workspace's deps into one node_modules) still satisfies them. Reuses
// esbuild (MIT), the same bundler and general shape as
// ui/server/scripts/build.mjs (#485) -- no new bundler introduced.
//
// Known, documented limitation (not fixed by this build -- tracked in
// #525's follow-up): a handful of packages/core and packages/engine modules
// compute a sibling-file or repo-root path from their OWN import.meta.url at
// runtime (packages/core/cli.mjs's `packageRoot`, used only by `construct
// doctor`'s enforcer-module listing; packages/core/extractExpression.mjs's
// `THIS_DIR`, used by `construct refactor extract-expression`; packages/
// engine/testRunner.mjs's `REPO`, used by `construct test run`; packages/
// engine/botRunner.mjs's `BIN`, used by the bot-runner's own subprocess
// spawn -- not reachable from this CLI's command graph today). Bundling
// collapses every file into ONE location, so those specific computations
// are only correct when run from the unbundled `node packages/cli/
// construct.mjs` (exactly what `npm test` exercises, and what
// ui/server/scripts/build.mjs's own doc comment flags as the same class of
// risk for the same reason). `--version` and `validate` -- this build's
// acceptance bar -- don't touch any of them and are unaffected.
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import { rm } from 'node:fs/promises';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, 'dist');
const OUT_FILE = path.join(OUT, 'construct.mjs');
const pkg = JSON.parse(fs.readFileSync(path.join(HERE, 'package.json'), 'utf8'));

await rm(OUT, { recursive: true, force: true });

await build({
  entryPoints: [path.join(HERE, 'construct.mjs')],
  outfile: OUT_FILE,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  packages: 'external',
  minify: true,
  treeShaking: true,
  sourcemap: false,
  logLevel: 'info',
  // Bakes the real, current packages/cli/package.json version into the
  // bundle at build time (see version.mjs) -- the built file needs no
  // package.json alongside it to answer `--version` correctly.
  define: { 'process.env.CONSTRUCT_CLI_VERSION': JSON.stringify(pkg.version) },
});

fs.chmodSync(OUT_FILE, 0o755);
console.log(`Built packages/cli -> ${path.relative(process.cwd(), OUT_FILE)} (v${pkg.version})`);
