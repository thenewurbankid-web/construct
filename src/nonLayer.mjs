// Non-layer paths (#348, owner decision on #284): `nonLayer: [<glob>, ...]` in
// architecture.yml declares paths that live INSIDE a feature but OUTSIDE the layer graph --
// today `features/*/tests/**` (generated and authored end-to-end tests). The layer enforcers
// skip them, so a test may legitimately reach across layers WITHOUT any exemption being carved
// into SLICE-001 / MODULE-001 / SOC-001 for everyone else. Nothing is skipped unless a project
// declares it: an undeclared `tests/` folder is still an unrecognized folder (SOC-001).
//
// Follows the `frozen:` precedent (frozen.mjs): root-relative globs, read defensively, cached
// by architecture.yml mtime. Unlike `frozen:` these are never write-guards, only a skip list,
// and they may not reach outside the project.
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { minimatch } from 'minimatch';
import { ConstructError, EXIT_CODES } from './diagnostics.mjs';

const MATCH_OPTIONS = { dot: true };
const toPosix = (p) => p.split(path.sep).join('/');

/** The glob that declares the generated-test region (also the `frozen:` glob). */
export const GENERATED_TESTS_GLOB = 'features/*/tests/generated/**';
/** The glob a project declares as `nonLayer:` for tests. */
export const TESTS_GLOB = 'features/*/tests/**';

/** Validate the raw `nonLayer:` value. Absent/null -> []. Absolute globs and `..` segments are rejected. */
export function normalizeNonLayer(raw) {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    throw new ConstructError("Invalid 'nonLayer' in architecture.yml — expected a list of glob strings (e.g. nonLayer: ['features/*/tests/**']).", { exitCode: EXIT_CODES.USAGE_ERROR });
  }
  raw.forEach((g, i) => {
    const bad = (why) => new ConstructError(`Invalid architecture.yml nonLayer[${i}]: ${why}.`, { exitCode: EXIT_CODES.USAGE_ERROR });
    if (typeof g !== 'string' || !g.trim()) throw bad('expected a non-empty glob string');
    if (g.includes('\0')) throw bad('glob contains a NUL byte');
    if (path.isAbsolute(g) || /^[A-Za-z]:[\\/]/.test(g)) throw bad(`"${g}" is absolute — use a path relative to the project root`);
    if (g.split(/[\\/]/).includes('..')) throw bad(`"${g}" contains ".." — non-layer paths must stay inside the project`);
  });
  return raw.map((g) => g.trim());
}

const cache = new Map(); // architecture.yml path -> { mtimeMs, size, globs }

/** Declared non-layer globs for `root`; [] if unset/unreadable/malformed. Never throws (loadConfig reports shape errors). */
export function readNonLayerGlobs(root) {
  const file = path.join(root, 'architecture.yml');
  let stat;
  try { stat = fs.statSync(file); } catch { return []; }
  const hit = cache.get(file);
  if (hit && hit.mtimeMs === stat.mtimeMs && hit.size === stat.size) return hit.globs;
  let globs = [];
  try {
    const c = yaml.load(fs.readFileSync(file, 'utf8'));
    if (c && typeof c === 'object' && Array.isArray(c.nonLayer)) {
      globs = c.nonLayer.filter((g) => typeof g === 'string' && g.trim() && !path.isAbsolute(g) && !g.split(/[\\/]/).includes('..')).map((g) => g.trim());
    }
  } catch { /* malformed yaml: loadConfig reports it */ }
  cache.set(file, { mtimeMs: stat.mtimeMs, size: stat.size, globs });
  return globs;
}

/** Is `file` (absolute, or relative to `root`) inside a declared non-layer region of the project? */
export function isNonLayerPath(root, file, globs = readNonLayerGlobs(root)) {
  if (!globs.length) return false;
  const rel = toPosix(path.isAbsolute(file) ? path.relative(root, file) : file);
  if (rel.startsWith('../')) return false;
  return globs.some((g) => minimatch(rel, toPosix(g), MATCH_OPTIONS));
}
