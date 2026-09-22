// Maps a source path onto Construct's own generated API reference (#468, epic #463) — deterministic, no
// network, no LLM. This is meaningful ONLY when the project being summarized is Construct's own repository (or
// a checkout of it, dogfooding `ui/` per CLAUDE.md's Dogfooding section): an arbitrary target project has no
// Construct-generated docs of its own, so `docsPathFor` returns null for one, silently, every time.
//
// `PACKAGES` mirrors `API_PACKAGES` in `packages/docs-site/lib/apiDocs.mjs` (id, title, dirs only — the site's
// own description/exts/tsconfig fields are a build concern, not a linking concern). `packages/core` ->
// `packages/docs-site` is a dependency direction this repo does not want reversed (the CLI core stays free of
// the doc generator's dependencies, e.g. typedoc), so the mapping is duplicated here rather than imported;
// `test/docsPackages.test.mjs` keeps the two in sync (fails the moment a package is added/renamed/moved in one
// file but not the other).
import fs from 'node:fs';
import path from 'node:path';

export const PACKAGES = [
  { id: 'core', title: 'Core engine', dirs: ['packages/core'] },
  { id: 'engine', title: 'Engine', dirs: ['packages/engine'] },
  { id: 'ast', title: 'AST', dirs: ['packages/ast'] },
  { id: 'cockpit-server', title: 'Cockpit server', dirs: ['ui/server/src'] },
  { id: 'cockpit-client-shared', title: 'Cockpit client (shared)', dirs: ['ui/client/components', 'ui/client/lib'] },
  { id: 'cockpit-client-features', title: 'Cockpit client (features)', dirs: ['ui/client/features'] },
  { id: 'tools', title: 'Tools', dirs: ['packages/tools'] },
  { id: 'docs-site', title: 'Docs site', dirs: ['packages/docs-site/lib', 'site'] },
];

// A directory is "the Construct repo" when it carries both of these — the docs generator and the doc this
// exact module is described in. Cheap, exact, and false only if someone renames both at once.
const SIGNATURE_FILES = ['docs/API-DOCS.md', 'site/build.mjs'];

/**
 * Walk up from `startDir` for a directory that looks like the Construct repo itself. `null` for an ordinary
 * target project — the common case, and the safe default (no link is ever shown for someone else's project).
 *
 * @param {string} startDir Directory to start from (typically a `construct` invocation's project root).
 * @param {number} [maxUp] How many parent levels to check before giving up.
 * @returns {string|null} The repo root, or `null` when none of the ancestors (up to `maxUp`) look like one.
 */
export function findDocsRepoRoot(startDir, maxUp = 6) {
  let dir = path.resolve(startDir);
  for (let i = 0; i <= maxUp; i++) {
    if (SIGNATURE_FILES.every((f) => fs.existsSync(path.join(dir, f)))) return dir;
    const up = path.dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
  return null;
}

/**
 * The package (if any) whose `dirs` is the longest prefix of `repoRelativePath`.
 *
 * @param {string} repoRelativePath A path relative to the Construct repo root (any separator).
 * @returns {{id: string, title: string, dirs: string[]}|null} The matching entry of `PACKAGES`, or `null`.
 */
export function packageForRelativePath(repoRelativePath) {
  const p = repoRelativePath.split(path.sep).join('/');
  let best = null;
  for (const pkg of PACKAGES) {
    for (const dir of pkg.dirs) {
      if (p === dir || p.startsWith(`${dir}/`)) {
        if (!best || dir.length > best.dirLen) best = { pkg, dirLen: dir.length };
      }
    }
  }
  return best?.pkg ?? null;
}

/**
 * The path (within the versioned docs, e.g. `<base>/<X.Y or next>/<this>`) to a source path's package page in
 * Construct's own generated API reference, or `null` when `root`/`absPath` is not inside a checkout of this
 * repository, or the path matches no known package.
 *
 * @param {string} root The project root `construct` is running against (a `--dir`, or cwd).
 * @param {string} absPath An absolute path under `root` (e.g. a feature directory).
 * @returns {string|null} e.g. `"developers/api/cockpit-client-features/"`.
 */
export function docsPathFor(root, absPath) {
  const repoRoot = findDocsRepoRoot(root);
  if (!repoRoot) return null;
  const rel = path.relative(repoRoot, absPath);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  const pkg = packageForRelativePath(rel);
  return pkg ? `developers/api/${pkg.id}/` : null;
}
