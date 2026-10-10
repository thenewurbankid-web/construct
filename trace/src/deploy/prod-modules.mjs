// Which installed packages a deployed build takes with it: the production set. `package-lock.json` marks every package that
// only devDependencies need with `"dev": true` (today `esbuild` with its platform binaries, and `three`, both only used by
// `npm run build:hero`; the built hero ships in src/ui/hero3d/hero.bundle.mjs), so a build copies node_modules minus those.
// Pure functions plus one copy helper, unit-tested against a scratch tree; the deploy script only calls copyProductionModules().
import fs from "node:fs";
import path from "node:path";

// Set of lock keys ("node_modules/three", "node_modules/@esbuild/darwin-arm64", ...) that are dev-only. `devOptional`
// packages are kept: a production optional dependency may need them.
/**
 * The lock keys of packages `package-lock.json` marks as dev-only.
 *
 * @param {{packages?: Object<string, {dev?: boolean}>}|null} lock A parsed `package-lock.json`.
 * @returns {Set<string>} Lock keys (e.g. `"node_modules/three"`) with `dev: true`. `devOptional` packages are
 *   kept (not included), since a production optional dependency may still need them.
 */
export function devOnlyModulePaths(lock) {
  const out = new Set();
  for (const [key, v] of Object.entries(lock?.packages ?? {})) if (key && v && v.dev === true) out.add(key);
  return out;
}

// The package a `.bin` symlink points into ("../esbuild/bin/esbuild" -> "node_modules/esbuild", "../@scope/p/x" -> "node_modules/@scope/p"), else null.
function binTargetKey(linkTarget) {
  const parts = String(linkTarget).split(/[\\/]/).filter((p) => p && p !== "..");
  if (!parts.length) return null;
  return parts[0].startsWith("@") && parts.length > 1 ? `node_modules/${parts[0]}/${parts[1]}` : `node_modules/${parts[0]}`;
}

// filter(srcPath) for fs.cpSync(srcNodeModules, dest): false for a dev-only package (at any nesting depth), for a `.bin` link
// that points into one, and for npm's hidden lockfile (it lists the dev packages; a build is not installed by npm).
/**
 * Build the `filter` callback for `fs.cpSync(srcNodeModules, dest, {filter})`.
 *
 * @param {string} srcRoot The source `node_modules` directory.
 * @param {Set<string>} devOnly From {@link devOnlyModulePaths}.
 * @param {(p: string) => string} [readlink] Overridable for testing; defaults to `fs.readlinkSync`.
 * @returns {(src: string) => boolean} `false` for a dev-only package (at any nesting depth), for a `.bin` link
 *   pointing into one, and for npm's hidden lockfile (it lists the dev packages, but a build is not installed by
 *   npm); `true` otherwise.
 */
export function productionFilter(srcRoot, devOnly, readlink = (p) => fs.readlinkSync(p)) {
  return (src) => {
    const rel = path.relative(srcRoot, src).split(path.sep).join("/");
    if (!rel) return true;
    if (rel === ".package-lock.json") return false;
    const key = `node_modules/${rel}`;
    for (const d of devOnly) if (key === d || key.startsWith(`${d}/`)) return false; // (cpSync stops at the directory; this also covers a file under it)
    if (rel.startsWith(".bin/") && rel.split("/").length === 2) {
      let t = null;
      try { t = readlink(src); } catch { /* not a link: keep */ }
      const tk = t && binTargetKey(t);
      if (tk && devOnly.has(tk)) return false;
    }
    return true;
  };
}

// Copies `srcNodeModules` into `destNodeModules` without the dev-only packages. With no readable lockfile it copies
// everything (never a partial guess) and says so in the return value. Returns { skipped: [lock keys present in src but left out], all: bool }.
/**
 * Copy `node_modules` into a new build, without the dev-only packages.
 *
 * @param {string} srcNodeModules Source `node_modules` directory.
 * @param {string} destNodeModules Destination directory (created by the copy).
 * @param {string} lockPath Path to `package-lock.json`.
 * @returns {{skipped: string[], all: boolean}} `skipped`: lock keys present in the source but left out, sorted.
 *   `all: true` means no readable lockfile was found, so everything was copied (never a partial guess).
 */
export function copyProductionModules(srcNodeModules, destNodeModules, lockPath) {
  let lock = null;
  try { lock = JSON.parse(fs.readFileSync(lockPath, "utf8")); } catch { /* fall through */ }
  const devOnly = lock ? devOnlyModulePaths(lock) : new Set();
  fs.cpSync(srcNodeModules, destNodeModules, { recursive: true, verbatimSymlinks: true, filter: productionFilter(srcNodeModules, devOnly) });
  // a scope folder whose packages were all dev-only (`@esbuild`) would be left empty
  for (const e of fs.readdirSync(destNodeModules, { withFileTypes: true })) {
    const d = path.join(destNodeModules, e.name);
    if (e.isDirectory() && e.name.startsWith("@") && fs.readdirSync(d).length === 0) fs.rmdirSync(d);
  }
  const skipped = [...devOnly].filter((k) => fs.existsSync(path.join(path.dirname(srcNodeModules), k))).sort();
  return { skipped, all: !lock };
}
