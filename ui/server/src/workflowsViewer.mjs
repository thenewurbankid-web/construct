// Backend for epic #57 (#59 Workflows screen, #60 extraction from real
// source). Read-only: lists a feature's workflows/ layer files and returns
// each file's XState machines, extracted fresh from the source on every
// request (src/engine/workflowExtractor.mjs) -- nothing cached, stored, or
// hand-maintained. Same scope guard as pagesEditor.mjs's resolvePageFile: a
// (feature, file) pair must resolve strictly inside
// features/<feature>/workflows/ before any disk read.
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../../../packages/core/config.mjs';
import { walk, rel } from '../../../packages/core/fs.mjs';
import { extractMachines } from '../../../packages/engine/workflowExtractor.mjs';
import { editWorkflow } from '../../../packages/engine/workflowEditor.mjs';
import { explainSource } from '../../../packages/engine/workflowExplain.mjs';
import { PagesEditorError, listFeatures, checkEnforcement, hashOf } from './pagesEditor.mjs';

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
  return { feature, file, path: relPath, machines, error, contentHash: hashOf(fs.readFileSync(absPath, 'utf8')) };
}

/** Epic #185 -- the machines of one workflow file explained in plain English
 * (narrative, scenarios, health findings), derived fresh from the source on
 * every request (src/engine/workflowExplain.mjs). Same scope guard as
 * readWorkflowMachines; read-only, nothing stored. */
export function readWorkflowNarrative(root, feature, file) {
  const { absPath, relPath } = resolveWorkflowFile(root, feature, file);
  const source = fs.readFileSync(absPath, 'utf8');
  const { machines, error } = explainSource(source);
  return { feature, file, path: relPath, machines, error, contentHash: hashOf(source) };
}

/** #61 -- one visual edit, applied as an exact source-range edit
 * (src/engine/workflowEditor.mjs). `commit:false` returns the patched source
 * for the client's diff preview without touching disk; `commit:true`
 * re-applies the SAME request server-side (the client never sends file
 * content), checks the contentHash still matches (no clobbering a concurrent
 * edit), runs the same architecture/SoC enforcement gate the pages editor
 * uses, and only then writes. Nothing besides the source file is stored. */
export function editWorkflowFile(root, feature, file, req, { commit, contentHash }) {
  const { absPath, relPath } = resolveWorkflowFile(root, feature, file);
  const source = fs.readFileSync(absPath, 'utf8');
  if (commit && contentHash !== hashOf(source)) {
    throw new PagesEditorError('The file changed on disk since it was loaded; re-read it and redo the edit.', { status: 409 });
  }
  const result = editWorkflow(source, req);
  if (!result.ok) throw new PagesEditorError(result.error, { status: 422 });
  if (!commit) return { ok: true, before: source, after: result.source, contentHash: hashOf(source) };
  const enforcement = checkEnforcement(root, relPath, result.source);
  if (!enforcement.ok) {
    throw new PagesEditorError('Save blocked: violates architecture rules.', { status: 422, violations: enforcement.violations });
  }
  fs.writeFileSync(absPath, result.source);
  // `savedPath` tells the route which file to hand to commit-on-save (#283); the viewer itself
  // stays free of any git knowledge.
  return { ok: true, savedPath: relPath, violations: enforcement.violations, ...readWorkflowMachines(root, feature, file) };
}
