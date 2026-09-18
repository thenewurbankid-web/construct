// Frozen presentation (#23) -- externally-authored source (a design tool's
// synced output, e.g. Subframe / Figma-to-code) that a Construct project
// wraps via a controller instead of forking. `frozen: [<glob>, ...]` in
// architecture.yml declares it; globs are resolved relative to the project
// root and may reach OUTSIDE it (`../../src/subframe-pages-v2/**`).
//
// Frozen globs are READ-ONLY references. They are only ever (a) matched
// against a write target so Construct can REFUSE the write, or (b) expanded
// to a file list that is only read (see frozen-detector.mjs). Nothing
// derived from a frozen glob is ever a write destination.
//
// This module deliberately imports nothing from fs.mjs (fs.mjs's write()
// calls assertNotFrozen below, so the reverse edge would be a cycle).
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { minimatch } from 'minimatch';
import { findProjectRoot } from './config.mjs';
import { ConstructError, EXIT_CODES } from './diagnostics.mjs';

const MATCH_OPTIONS = { dot: true };
const toPosix = (p) => p.split(path.sep).join('/');

/** Validate the raw `frozen:` value. Absent/null -> []. Throws a USAGE_ERROR
 * ConstructError naming the offending entry otherwise. Absolute globs are
 * rejected (a committed architecture.yml must be portable across machines). */
export function normalizeFrozen(raw) {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    throw new ConstructError(
      "Invalid 'frozen' in architecture.yml — expected a list of glob strings (e.g. frozen: ['../../src/design/**']).",
      { exitCode: EXIT_CODES.USAGE_ERROR },
    );
  }
  raw.forEach((g, i) => {
    const bad = (why) => new ConstructError(
      `Invalid architecture.yml frozen[${i}]: ${why}.`,
      { exitCode: EXIT_CODES.USAGE_ERROR },
    );
    if (typeof g !== 'string' || !g.trim()) throw bad('expected a non-empty glob string');
    if (g.includes('\0')) throw bad('glob contains a NUL byte');
    if (path.isAbsolute(g) || /^[A-Za-z]:[\\/]/.test(g)) {
      throw bad(`"${g}" is absolute — use a path relative to the project root (it may start with ../ to reach outside it)`);
    }
  });
  return raw.map((g) => g.trim());
}

/** Absolute, normalized, posix-separated form of a root-relative frozen glob. */
export function resolveFrozenGlob(root, glob) {
  return toPosix(path.resolve(root, glob));
}

/** Leading path segments of an absolute glob that contain no magic chars --
 * the directory a walk must start from to enumerate everything it can match. */
function staticPrefix(absGlob) {
  const out = [];
  for (const s of absGlob.split('/')) {
    if (/[*?[\]{}()!+@]/.test(s)) break;
    out.push(s);
  }
  return out.join('/') || '/';
}

// Cache of raw frozen globs per architecture.yml, invalidated by mtime, so
// the write() guard doesn't re-parse YAML on every single file write.
const rawCache = new Map(); // ymlPath -> { mtimeMs, globs }

/** Frozen globs (raw, root-relative) for `root`, or [] if unset/unreadable/
 * malformed. Never throws: shape errors are reported by loadConfig (which
 * `construct validate` runs); the write guard must not turn a config typo
 * into a different failure. Non-string / absolute entries are skipped. */
export function readFrozenGlobs(root) {
  const file = path.join(root, 'architecture.yml');
  let stat;
  try { stat = fs.statSync(file); } catch { return []; }
  const hit = rawCache.get(file);
  if (hit && hit.mtimeMs === stat.mtimeMs && hit.size === stat.size) return hit.globs;
  let globs = [];
  try {
    const c = yaml.load(fs.readFileSync(file, 'utf8'));
    if (c && typeof c === 'object' && Array.isArray(c.frozen)) {
      globs = c.frozen.filter((g) => typeof g === 'string' && g.trim() && !path.isAbsolute(g)).map((g) => g.trim());
    }
  } catch { /* malformed yaml: loadConfig reports it */ }
  rawCache.set(file, { mtimeMs: stat.mtimeMs, size: stat.size, globs });
  return globs;
}

/** The first frozen glob (as written in architecture.yml) matching `absPath`
 * for the project at `root`, or null. */
export function matchFrozen(root, absPath, globs = readFrozenGlobs(root)) {
  const target = toPosix(path.resolve(absPath));
  for (const g of globs) {
    if (minimatch(target, resolveFrozenGlob(root, g), MATCH_OPTIONS)) return g;
  }
  return null;
}

/** Throw a clear ConstructError if `absPath` falls inside the frozen region of
 * the nearest enclosing Construct project. `action` is a short verb phrase
 * for the message ("write to", "move", ...). No-op when no project root is
 * found or it declares no `frozen:` globs (behavior for such projects is
 * unchanged). */
export function assertNotFrozen(absPath, action = 'write to', knownRoot = null) {
  const abs = path.resolve(absPath);
  // Generators only ever target paths under their project root, so the nearest
  // architecture.yml ancestor IS that root; a caller that already knows the
  // root (and a target that may sit outside it) can pass it explicitly.
  const root = knownRoot || findProjectRoot(path.dirname(abs));
  if (!root) return;
  const globs = readFrozenGlobs(root);
  if (!globs.length) return;
  const glob = matchFrozen(root, abs, globs);
  if (glob) {
    throw new ConstructError(
      `Refusing to ${action} "${abs}": it matches the frozen glob "${glob}" in ${path.join(root, 'architecture.yml')}. `
      + 'Frozen files are externally authored and read-only to Construct — wrap them from a controller (import + prop-forward) instead of editing or scaffolding into them.',
      { exitCode: EXIT_CODES.USAGE_ERROR },
    );
  }
}

const SOURCE_EXT = new Set(['.ts', '.tsx', '.js', '.jsx']);

/** Absolute paths of every source file matched by any of `globs` (read-only
 * enumeration, used by the duplicate-markup detector). Walks only each
 * glob's static-prefix directory; skips node_modules/.git. */
export function listFrozenFiles(root, globs) {
  const abs = globs.map((g) => resolveFrozenGlob(root, g));
  const found = new Set();
  const visited = new Set();
  const stack = abs.map(staticPrefix);
  while (stack.length) {
    const p = stack.pop();
    if (visited.has(p)) continue;
    visited.add(p);
    let st;
    try { st = fs.statSync(p); } catch { continue; }
    if (st.isDirectory()) {
      for (const e of fs.readdirSync(p)) {
        if (e === 'node_modules' || e === '.git') continue;
        stack.push(`${p === '/' ? '' : p}/${e}`);
      }
    } else if (SOURCE_EXT.has(path.extname(p)) && abs.some((a) => minimatch(p, a, MATCH_OPTIONS))) {
      found.add(p);
    }
  }
  return [...found].sort();
}
