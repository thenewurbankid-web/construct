// Backend for epic #57 (#59 Workflows screen, #60 extraction from real
// source). Read-only: lists a feature's workflows/ layer files and returns
// each file's XState machines, extracted fresh from the source on every
// request (src/engine/workflowExtractor.mjs) -- nothing cached, stored, or
// hand-maintained. Same scope guard as pagesEditor.mjs's resolvePageFile: a
// (feature, file) pair must resolve strictly inside
// features/<feature>/workflows/ before any disk read.
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../../../src/config.mjs';
import { walk, rel } from '../../../src/fs.mjs';
import { extractMachines } from '../../../src/engine/workflowExtractor.mjs';
import { PagesEditorError, listFeatures } from './pagesEditor.mjs';

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs']);
const MAX_BYTES = 512 * 1024;

const featuresRootOf = (root) => loadConfig(root).features?.root || 'features';

/** Features that actually have a workflows/ folder. */
export function listWorkflowFeatures(root) {
  const base = featuresRootOf(root);
  return listFeatures(root).filter((f) => fs.existsSync(path.join(root, base, f, 'workflows')));
}

/** Every source file under features/<feature>/workflows/**, relative to it. */
export function listWorkflowFiles(root, feature) {
  const dir = workflowsDir(root, feature);
  if (!fs.existsSync(dir)) return [];
  return walk(dir)
    .filter((p) => SOURCE_EXTENSIONS.has(path.extname(p)) && !/\.(test|spec)\./.test(p))
    .map((p) => rel(dir, p))
    .sort();
}

function workflowsDir(root, feature) {
  if (!feature || typeof feature !== 'string' || /[/\\]/.test(feature)) {
    throw new PagesEditorError('Invalid feature name.');
  }
  return path.resolve(path.join(root, featuresRootOf(root), feature, 'workflows'));
}

/** Resolve + validate a (feature, file) pair to an absolute path strictly
 * inside that feature's workflows/ folder (or throw PagesEditorError). */
export function resolveWorkflowFile(root, feature, file) {
  const dir = workflowsDir(root, feature);
  if (!file || typeof file !== 'string') throw new PagesEditorError('Invalid file path.');
  const resolved = path.resolve(path.join(dir, file));
  if (!resolved.startsWith(dir + path.sep)) {
    throw new PagesEditorError(`Path "${file}" escapes features/${feature}/workflows/ — the workflows viewer is scoped to the workflow layer only.`);
  }
  if (!SOURCE_EXTENSIONS.has(path.extname(resolved))) throw new PagesEditorError(`"${file}" is not a JS/TS source file.`);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    throw new PagesEditorError(`No such workflow file: features/${feature}/workflows/${file}`, { status: 404 });
  }
  // Resolve symlinks too, so a link inside workflows/ can't point elsewhere.
  const real = fs.realpathSync(resolved);
  const realDir = fs.realpathSync(dir);
  if (!real.startsWith(realDir + path.sep)) {
    throw new PagesEditorError(`"${file}" resolves outside features/${feature}/workflows/.`);
  }
  if (fs.statSync(real).size > MAX_BYTES) throw new PagesEditorError(`"${file}" is too large to visualize.`, { status: 413 });
  return { absPath: real, relPath: rel(root, resolved) };
}

/** Machines defined in one workflow file, extracted from the live source. */
export function readWorkflowMachines(root, feature, file) {
  const { absPath, relPath } = resolveWorkflowFile(root, feature, file);
  const { machines, error } = extractMachines(fs.readFileSync(absPath, 'utf8'));
  return { feature, file, path: relPath, machines, error };
}
