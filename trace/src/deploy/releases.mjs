// What is on disk under deploy/: one directory per build (`deploy/<version>/` with build-info.json and manifest.json),
// the `current` symlink, and state.json. Shared by the deploy script and the server's /api/about.
import fs from "node:fs";
import path from "node:path";

const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; } };

// { current: version|null, pinnedHash: string|null }. pinnedHash is set by a manual rollback so the watcher does not
// immediately redeploy the newer tree the user just stepped back from.
/**
 * Read the deploy folder's own state.
 *
 * @param {string} deployDir The deploy folder.
 * @returns {{current: string|null, pinnedHash: string|null}} `current`: the running version. `pinnedHash`: set
 *   by a manual rollback, so the watcher does not immediately redeploy the newer tree just stepped back from.
 *   Defaults are used when `state.json` is missing or unreadable.
 */
export function readState(deployDir) {
  return { current: null, pinnedHash: null, ...(readJson(path.join(deployDir, "state.json")) ?? {}) };
}

/**
 * Read one kept build's `build-info.json`.
 *
 * @param {string} deployDir The deploy folder.
 * @param {string} version The build's version directory name.
 * @returns {object|null} The parsed file, or `null` if missing/unreadable.
 */
export const readBuildInfo = (deployDir, version) => readJson(path.join(deployDir, version, "build-info.json"));
/**
 * Read one kept build's `manifest.json`.
 *
 * @param {string} deployDir The deploy folder.
 * @param {string} version The build's version directory name.
 * @returns {Object<string, string>|null} The parsed manifest, or `null` if missing/unreadable.
 */
export const readManifest = (deployDir, version) => readJson(path.join(deployDir, version, "manifest.json"));

// Every kept build, newest first (by deploy time, then version, so the order is stable).
/**
 * List every kept build under a deploy folder.
 *
 * @param {string} deployDir The deploy folder.
 * @param {{current?: string|null}} [options] `current` defaults to {@link readState}'s value.
 * @returns {{version: string, release: string|null, hash: string, deployedAt: string, tests: *,
 *   current: boolean, rollbackAvailable: boolean}[]}
 *   Every build directory with a readable `build-info.json`, newest first (by deploy time, then version, so the
 *   order is stable).
 */
export function listReleases(deployDir, { current = readState(deployDir).current } = {}) {
  let names = [];
  try { names = fs.readdirSync(deployDir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name); } catch { return []; }
  return names
    .map((version) => ({ version, info: readBuildInfo(deployDir, version) }))
    .filter((r) => r.info)
    .map(({ version, info }) => ({
      version,
      release: info.release ?? null, // `R0` or a minor release such as `R0.1`
      hash: info.hash,
      deployedAt: info.builtAt,
      tests: info.tests ?? null,
      current: version === current,
      rollbackAvailable: version !== current,
    }))
    .sort((a, b) => (a.deployedAt < b.deployedAt ? 1 : a.deployedAt > b.deployedAt ? -1 : a.version < b.version ? -1 : 1));
}

// Which builds to delete: keep the newest `keep`, and never the running one or the one it can roll back to.
/**
 * Which kept builds to delete.
 *
 * @param {{version: string}[]} releases From {@link listReleases}.
 * @param {{current: string, previous?: string|null, keep?: number}} options `current`/`previous` are never
 *   pruned; `keep` (default 3) is how many of the newest to keep regardless.
 * @returns {string[]} The version names to delete.
 */
export function versionsToPrune(releases, { current, previous = null, keep = 3 }) {
  const keepSet = new Set(releases.slice(0, keep).map((r) => r.version));
  for (const v of [current, previous]) if (v) keepSet.add(v);
  return releases.filter((r) => !keepSet.has(r.version)).map((r) => r.version);
}
