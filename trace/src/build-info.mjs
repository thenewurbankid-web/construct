// Build identity: which files make up a deployable build, a content hash over them, and the version string
// `<package.json version>+<first 7 chars of the hash>`.
//
// The hash reads only relative paths and file bytes: never mtimes, never the checkout location, never git (this
// project is untracked). Two checkouts with the same content therefore get the same hash. `builtAt` is metadata only:
// it is not part of the hash and nothing generated may depend on it.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { parseChangelog, newestReleaseId, splitReleaseId } from "./changelog.mjs";

// What ships: an allow-list, so a new scratch folder can never leak into a build or trigger a redeploy.
export const TOP_DIRS = ["src", "examples"];
export const TOP_FILES = ["package.json", "package-lock.json", "ai.config.json", "RELEASE", "CHANGELOG.md", "README.md"];
// A run rewrites these next to the example it ran on; they are the running app's state, not part of the build, and a
// redeploy must not touch them.
export const STATE_FILES = ["answers.json", "answers.history.jsonl", "decisions.json", "ai-cache.json"];
// The API contract of an example is SOURCE: the shipped openapi.* files are in the build (so editing one in the source tree
// makes a new build). It is only preserved across a redeploy when someone changed or uploaded it in the RUNNING app: see
// userChangedContracts().
export const CONTRACT_FILES = ["openapi.json", "openapi.yaml", "openapi.yml"];
const SKIP_DIRS = new Set(["node_modules", ".git"]); // (a root deploy/ is outside the allow-list; src/deploy is source)
const SKIP_FILE = /(\.png|\.log|\.DS_Store)$/;

// rel: posix path relative to the repo root. Used for the full walk and by the watcher to ignore irrelevant events.
/**
 * Whether a repo-relative path ships in a build.
 *
 * @param {string} rel A posix path relative to the repo root.
 * @returns {boolean} `true` when the path is under an allow-listed top dir/file, not a skipped dir
 *   (`node_modules`, `.git`), not a skipped file type, not a per-run state file, and (under `docs/`) a
 *   top-level `.md` file rather than a `docs/theme` screenshot.
 */
export function isDeployable(rel) {
  const parts = rel.split("/");
  if (parts.some((p) => SKIP_DIRS.has(p)) || SKIP_FILE.test(parts[parts.length - 1])) return false;
  if (parts.length === 1) return TOP_FILES.includes(rel);
  if (parts[0] === "docs") return parts.length === 2 && rel.endsWith(".md"); // the notes, not docs/theme screenshots
  if (!TOP_DIRS.includes(parts[0])) return false;
  if (parts[0] === "examples" && STATE_FILES.includes(parts[parts.length - 1])) return false;
  return true;
}

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0); // code-unit order: the same on every machine, unlike localeCompare

/**
 * Every file that ships in a build, in a deterministic order.
 *
 * @param {string} rootDir The repo root.
 * @returns {string[]} Deployable file paths (posix, relative to `rootDir`), sorted by code-unit order (not
 *   `localeCompare`, so the order is the same on every machine). Symlinks are not followed or shipped.
 */
export function listDeployableFiles(rootDir) {
  const out = [];
  const walk = (rel) => {
    for (const e of fs.readdirSync(path.join(rootDir, rel), { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name) && (rel !== "" || TOP_DIRS.includes(e.name) || e.name === "docs")) walk(r); }
      else if (e.isFile() && isDeployable(r)) out.push(r); // symlinks are not followed or shipped
    }
  };
  walk("");
  return out.sort(cmp);
}

const sha1 = (buf) => createHash("sha1").update(buf).digest("hex");

// { "src/server.mjs": "<sha1 of the bytes>", ... } with sorted keys
/**
 * A content manifest of every deployable file: its path mapped to the sha1 of its bytes.
 *
 * @param {string} rootDir The repo root.
 * @returns {Object<string, string>} `{ "src/server.mjs": "<sha1>", ... }`, keys in {@link listDeployableFiles} order.
 */
export function buildManifest(rootDir) {
  const m = {};
  for (const rel of listDeployableFiles(rootDir)) m[rel] = sha1(fs.readFileSync(path.join(rootDir, rel)));
  return m;
}

// sha1 over the sorted (relative path + file bytes): each file is folded in through its own sha1, which is the same
// information and lets one manifest serve both the hash and the changes list.
/**
 * A single content hash for a whole manifest.
 *
 * @param {Object<string, string>} manifest From {@link buildManifest}.
 * @returns {string} The sha1 over each `path\0sha1\n` entry, sorted by path — the same information as the
 *   manifest, folded into one hash that also lets the manifest itself serve the changes list.
 */
export function hashManifest(manifest) {
  const h = createHash("sha1");
  for (const rel of Object.keys(manifest).sort(cmp)) h.update(`${rel}\0${manifest[rel]}\n`);
  return h.digest("hex");
}

// What changed between two deployed builds. Lists are sorted and capped so a huge diff stays small in build-info.json.
/**
 * What changed between two manifests.
 *
 * @param {Object<string, string>} prev The previous build's manifest.
 * @param {Object<string, string>} next The new build's manifest.
 * @param {{cap?: number}} [options] `cap` (default 200): the max entries kept per list, so a huge diff stays
 *   small in `build-info.json`.
 * @returns {{added: string[], modified: string[], removed: string[], counts: {added: number, modified: number,
 *   removed: number}, truncated: {added: number, modified: number, removed: number}}}
 *   The (capped) file lists, their true counts, and how many were cut from each list.
 */
export function diffManifests(prev, next, { cap = 200 } = {}) {
  const added = [], modified = [], removed = [];
  for (const k of Object.keys(next).sort(cmp)) {
    if (!(k in prev)) added.push(k);
    else if (prev[k] !== next[k]) modified.push(k);
  }
  for (const k of Object.keys(prev).sort(cmp)) if (!(k in next)) removed.push(k);
  const cut = (l) => l.slice(0, cap);
  return {
    added: cut(added), modified: cut(modified), removed: cut(removed),
    counts: { added: added.length, modified: modified.length, removed: removed.length },
    truncated: { added: Math.max(0, added.length - cap), modified: Math.max(0, modified.length - cap), removed: Math.max(0, removed.length - cap) },
  };
}

const read = (p) => { try { return fs.readFileSync(p, "utf8"); } catch { return null; } };

// RELEASE file (first non-empty line, e.g. `R0` or, for a minor release, `R0.1`); else the newest release id in CHANGELOG.md; else null.
/**
 * The current release id.
 *
 * @param {string} rootDir The repo root.
 * @returns {string|null} The `RELEASE` file's first non-empty line (e.g. `"R0"` or, for a minor release,
 *   `"R0.1"`); else the newest release id from `CHANGELOG.md` (see {@link newestReleaseId}); else `null`.
 */
export function readRelease(rootDir) {
  const line = (read(path.join(rootDir, "RELEASE")) ?? "").split(/\r?\n/).map((s) => s.trim()).find(Boolean);
  if (line) return line;
  const log = read(path.join(rootDir, "CHANGELOG.md"));
  return log == null ? null : newestReleaseId(parseChangelog(log));
}

// opts: { release, builtAt, manifest }. `release` overrides the RELEASE file (null forces none); `manifest` skips a re-read.
/**
 * Compute this checkout's build identity.
 *
 * @param {string} rootDir The repo root.
 * @param {{release?: string|null, builtAt?: string|null, manifest?: Object<string, string>}} [opts]
 *   `release` overrides {@link readRelease} (`null` forces none); `builtAt` overrides the default
 *   (`new Date().toISOString()`); `manifest` skips a re-read (see {@link buildManifest}).
 * @returns {{name: "Trace", version: string, release: string|null, major: string|null, minor: string|null,
 *   hash: string, files: number, builtAt: string|null}}
 *   `version` is `<package.json version>+<first 7 hash chars>`. The hash reads only relative paths and file
 *   bytes (never mtimes, the checkout location, or git), so two checkouts with the same content get the same
 *   hash; `builtAt` is metadata only and nothing generated may depend on it.
 */
export function computeBuildInfo(rootDir, opts = {}) {
  const manifest = opts.manifest ?? buildManifest(rootDir);
  const hash = hashManifest(manifest);
  const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, "package.json"), "utf8"));
  const release = opts.release !== undefined ? opts.release : readRelease(rootDir);
  const { major, minor } = splitReleaseId(release); // R0.1 -> "R0" / "R0.1"; R0 -> "R0" / null; not an R<n>[.<m>] id -> null / null
  return {
    name: "Trace",
    version: `${pkg.version}+${hash.slice(0, 7)}`,
    release,
    major,
    minor,
    hash,
    files: Object.keys(manifest).length,
    builtAt: opts.builtAt !== undefined ? opts.builtAt : new Date().toISOString(),
  };
}

// JSON with recursively sorted keys, for build-info.json / manifest.json / state.json
/**
 * Stringify a value as pretty JSON with recursively sorted object keys, for `build-info.json` / `manifest.json`
 * / `state.json` (so the same content always serializes byte-identically, regardless of key insertion order).
 *
 * @param {*} value Any JSON-serializable value.
 * @returns {string} The JSON text, 2-space indented, with a trailing newline.
 */
export function sortedJson(value) {
  const sort = (v) => (Array.isArray(v) ? v.map(sort) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort(cmp).map((k) => [k, sort(v[k])])) : v);
  return JSON.stringify(sort(value), null, 2) + "\n";
}

// Which examples have a contract that the running build's user changed (uploaded, or replaced by "Backend ships the fix")?
// runningDir is the deployed build's folder: it holds manifest.json (the sha1 of every file it shipped) and its examples/.
// For each example the openapi.* files now on disk are compared with what THAT build shipped:
//   same names and same bytes  -> untouched: the new build's own copy is used (a source edit must redeploy)
//   anything different (a new file, another extension, other bytes) -> the user's: returns { example: [file names] }
// A shipped file that is now missing is not a user change (a reset restores it from .original/), so the new build's copy is used.
/**
 * Which examples have a contract the running build's user changed (uploaded, or replaced via "Backend ships the
 * fix"), versus what that build originally shipped.
 *
 * @param {string} runningDir The deployed build's directory (holds `manifest.json` and its `examples/`).
 * @returns {Object<string, string[]>} `{ [example]: [contract file names] }` for each example whose current
 *   openapi.* files differ (in names or bytes) from what `runningDir`'s manifest recorded; a shipped file that is
 *   now missing does not count (a reset restores it from `.original/`, so the new build's own copy is used), nor
 *   does an old build with no manifest count as unchanged (everything found is treated as the user's in that
 *   case).
 */
export function userChangedContracts(runningDir) {
  let shipped = {};
  try { shipped = JSON.parse(fs.readFileSync(path.join(runningDir, "manifest.json"), "utf8")); } catch { /* an old build without a manifest: everything found counts as the user's */ }
  const out = {};
  const exDir = path.join(runningDir, "examples");
  let names = [];
  try { names = fs.readdirSync(exDir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort(cmp); } catch { return out; }
  for (const name of names) {
    const now = CONTRACT_FILES.filter((f) => fs.existsSync(path.join(exDir, name, f)));
    if (!now.length) continue;
    const was = CONTRACT_FILES.filter((f) => `examples/${name}/${f}` in shipped);
    const same = now.length === was.length && now.every((f, i) => f === was[i] && sha1(fs.readFileSync(path.join(exDir, name, f))) === shipped[`examples/${name}/${f}`]);
    if (!same) out[name] = now;
  }
  return out;
}

// Puts the running build's user-changed contracts into a freshly built folder (newDir), replacing that example's shipped
// openapi.* so exactly one file is left. Returns the example names it carried over.
// Atomic per file: each file is copied to a temp name beside its target, checked byte for byte, then renamed over the
// target (a rename replaces in one step), and only after every file of the example is in place are the example's OTHER
// openapi.* removed. Nothing is removed before its replacement is safely on disk, so a failure at any step (a full disk, a
// permission error, a crash) leaves the older build with the contract it had, or the user's, never with none. On a failure
// the temp files are removed and the error is thrown; the examples already carried stay carried (carrying is repeatable).
// `ops` lets the tests inject a failing copy, rename or remove; it defaults to node:fs.
/**
 * Carry the running build's user-changed contracts (see {@link userChangedContracts}) into a freshly built
 * folder, replacing that example's shipped openapi.* so exactly one file remains. Each file is copied to a temp
 * name beside its target, checked byte for byte, then renamed over the target, and only after every file of an
 * example is safely in place are that example's other openapi.* removed — so a failure at any step (full disk,
 * permission error, crash) leaves the older build with the contract it had, or the user's, never with none.
 * Carrying is repeatable: examples already carried by an earlier, partially-failed call stay carried.
 *
 * @param {string} runningDir The currently running (old) build's directory.
 * @param {string} newDir The freshly built (new) build's directory to carry contracts into.
 * @param {{copyFileSync?: Function, renameSync?: Function, rmSync?: Function}} [ops]
 *   Overrides for `node:fs`'s functions (tests inject a failing copy/rename/remove); defaults to `node:fs`.
 * @returns {string[]} The example names successfully carried.
 * @throws {Error} On any copy/rename/remove failure; temp files from that example are removed before rethrowing.
 */
export function carryUserContracts(runningDir, newDir, ops = {}) {
  const { copyFileSync = fs.copyFileSync, renameSync = fs.renameSync, rmSync = fs.rmSync } = ops;
  const carried = [];
  for (const [name, files] of Object.entries(userChangedContracts(runningDir))) {
    const target = path.join(newDir, "examples", name);
    if (!fs.existsSync(target)) continue; // the example no longer exists in the new build
    const temps = [];
    try {
      for (const f of files) {
        const from = path.join(runningDir, "examples", name, f), tmp = path.join(target, `.${f}.${process.pid}.carry.tmp`);
        temps.push(tmp);
        copyFileSync(from, tmp);
        if (sha1(fs.readFileSync(tmp)) !== sha1(fs.readFileSync(from))) throw new Error(`the copy of examples/${name}/${f} does not match the original`);
        renameSync(tmp, path.join(target, f));
      }
      for (const f of CONTRACT_FILES) if (!files.includes(f)) rmSync(path.join(target, f), { force: true });
    } catch (err) {
      for (const t of temps) { try { fs.rmSync(t, { force: true }); } catch { /* best effort: a leftover temp file is dot-named and never read */ } }
      throw err;
    }
    carried.push(name);
  }
  return carried;
}
