// Epic #185 / #188 -- path-scoped, read-only access to a feature's workflow
// files for the CLI. A (feature, file) pair must resolve (symlinks included)
// strictly inside features/<feature>/workflows/ before anything is read;
// ui/server/src/workflowsViewer.mjs has its own equivalent guard for HTTP.
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../../src/config.mjs';
import { walk, rel } from '../../src/fs.mjs';
import { ConstructError, EXIT_CODES } from '../../src/diagnostics.mjs';

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs']);
const MAX_BYTES = 512 * 1024;
const usage = (message) => new ConstructError(message, { exitCode: EXIT_CODES.USAGE_ERROR });

export function workflowsDirOf(root, feature) {
  if (!feature || /[/\\]/.test(feature) || feature.startsWith('.')) throw usage(`Invalid feature name "${feature ?? ''}".`);
  const base = loadConfig(root).features?.root || 'features';
  const dir = path.resolve(root, base, feature, 'workflows');
  if (!fs.existsSync(dir)) throw usage(`Feature "${feature}" has no workflows/ folder (looked in ${rel(root, dir)}).`);
  return dir;
}

/**
 * Workflow source files (not tests) under the feature's workflows/ folder, relative to it, sorted.
 *
 * @param {string} root Project root.
 * @param {string} feature Feature name.
 * @returns {string[]} Sorted paths relative to `features/<feature>/workflows/`.
 */
export function listWorkflowSourceFiles(root, feature) {
  const dir = workflowsDirOf(root, feature);
  return walk(dir)
    .filter((p) => SOURCE_EXTENSIONS.has(path.extname(p)) && !/\.(test|spec)\./.test(p))
    .map((p) => rel(dir, p))
    .sort();
}

/**
 * Read one workflow file, or throw a clean ConstructError if it is outside the workflows/ layer.
 *
 * @param {string} root Project root.
 * @param {string} feature Feature name.
 * @param {string} file Path relative to the feature's `workflows/` folder.
 * @returns {string} The file text.
 * @throws {ConstructError} Usage error when the path escapes the workflows layer, is not a source file, is missing or is too large.
 */
export function readWorkflowSource(root, feature, file) {
  const dir = workflowsDirOf(root, feature);
  const resolved = path.resolve(dir, file);
  if (!resolved.startsWith(dir + path.sep)) throw usage(`Path "${file}" escapes features/${feature}/workflows/ — this command is scoped to the workflow layer only.`);
  if (!SOURCE_EXTENSIONS.has(path.extname(resolved))) throw usage(`"${file}" is not a JS/TS source file.`);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) throw usage(`No such workflow file: features/${feature}/workflows/${file}`);
  const real = fs.realpathSync(resolved);
  if (!real.startsWith(fs.realpathSync(dir) + path.sep)) throw usage(`"${file}" resolves outside features/${feature}/workflows/.`);
  if (fs.statSync(real).size > MAX_BYTES) throw usage(`"${file}" is too large to explain.`);
  return fs.readFileSync(real, 'utf8');
}
