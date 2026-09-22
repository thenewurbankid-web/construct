#!/usr/bin/env node
// #485 -- bundles ui/server into ui/server/dist/: compiled JS only, no .mjs
// sources of ui/server's own ~80 files (each imported/tested small module),
// no *.test.mjs. Uses esbuild (MIT).
//
// Scope note: this server calls straight into the repo's core CLI functions
// (packages/core/cli.mjs and friends — see ui/server/src/index.mjs's imports
// of `../../../packages/core/*`). Several of those core modules resolve
// sibling files (templates, packages/cli/construct.mjs, worker scripts)
// relative to their OWN import.meta.url at runtime (packageRoot in
// packages/core/cli.mjs, REPO in packages/engine/testRunner.mjs, BIN in
// packages/engine/botRunner.mjs, WORKER_URL in
// packages/engine/describeComponent.mjs). Bundling those files into this
// output would collapse every one of those file-relative computations onto
// this bundle's single location, breaking them (each assumes a different
// original depth). So this build deliberately leaves everything outside
// `ui/server/src/` (core's `../../../packages/**`) EXTERNAL — bundling only
// ui/server's own code — and keeps `dist/` at the exact same directory
// depth ui/server/src/ was, so those relative imports keep resolving
// exactly as they did before. Core (`packages/core/`, `packages/ast/`,
// `packages/engine/`, `packages/cli/`, `templates/`, `docs/`,
// `architecture.yml`) still needs to ship alongside dist/ until #480's
// steps 5-7 split it into a separately published `@line/construct-core`
// package — a documented limitation, not an oversight (see docs/DEPLOY.md
// and issue #485's closing note).
//
// The two worker scripts that ui/server's OWN code `fork()`s as separate
// Node processes (testRuns.mjs's TEST_RUN_WORKER, reviewRunner.mjs's WORKER)
// are built as their own entry points so they land next to index.mjs under
// the SAME file names those modules expect (HERE/testRunWorker.mjs,
// HERE/reviewWorker.mjs) once HERE resolves to dist/ after bundling.
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { rm } from 'node:fs/promises';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER_ROOT = path.resolve(HERE, '..');
const SRC = path.join(SERVER_ROOT, 'src');
const OUT = path.join(SERVER_ROOT, 'dist');

// Anything esbuild resolves to a path outside ui/server/src (core's
// `../../../packages/**`, node built-ins are handled by platform:'node'
// already) is kept as an external, unbundled import —
// esbuild recomputes it as a path relative to the new output location,
// which is a no-op here since dist/ sits at the same depth src/ did.
const keepCoreExternal = {
  name: 'keep-core-external',
  setup(b) {
    b.onResolve({ filter: /.*/ }, async (args) => {
      if (args.kind === 'entry-point') return null;
      if (!args.path.startsWith('.')) return null; // bare specifiers -> handled by `external` list below
      const resolved = path.resolve(args.resolveDir, args.path);
      if (!resolved.startsWith(SRC + path.sep)) {
        // Re-express as a path relative to dist/ (every entry point lands
        // directly in OUT, so this is the same for all of them) instead of
        // the absolute filesystem path esbuild would otherwise emit for an
        // externalized absolute resolution -- an absolute path would only
        // work on this machine, defeating the point of a redistributable.
        let rel = path.relative(OUT, resolved).split(path.sep).join('/');
        if (!rel.startsWith('.')) rel = `./${rel}`;
        return { path: rel, external: true };
      }
      return null;
    });
  },
};

await rm(OUT, { recursive: true, force: true });

await build({
  entryPoints: [
    path.join(SRC, 'index.mjs'),
    path.join(SRC, 'testRunWorker.mjs'),
    path.join(SRC, 'reviewWorker.mjs'),
  ],
  outdir: OUT,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outExtension: { '.js': '.mjs' },
  minify: true,
  treeShaking: true,
  sourcemap: false,
  logLevel: 'info',
  // npm dependencies stay real node_modules deps (ui/server/dist/package.json
  // declares them; `npm install --omit=dev` in the image/package provides
  // them) rather than being inlined -- `typescript` in particular does its
  // own dynamic resource loading that bundling would risk breaking.
  external: ['express', 'cors', 'ws', 'typescript'],
  plugins: [keepCoreExternal],
});

console.log(`Built ui/server -> ${path.relative(process.cwd(), OUT)}`);
