// The Components screen's API (#431, #434). A component is a source file in the `component` layer; the list comes from
// the core unit registry (src/engine/unitSummary.mjs, `listUnits({kind:'component'})`), so it is the same list
// `construct summarize --list --kind component` prints. Nothing here parses code: props come from the core block
// `describeComponent` (react-docgen, documentation only) and the file itself is plain text.
//
// Security, in one place:
//   - the client only ever names a component by its root-relative path, and that path must be EQUAL to one of the paths
//     in the real list for THIS project (never "resolved from" what the client sent), then re-checked as a real
//     path inside the project root (symlinks that leave it, node_modules, oversize files are refused);
//   - the only write is `POST /save`, on the same path the Pages editor and Workflows edits take: preview first
//     (nothing written), then commit with a content hash (no clobbering a concurrent edit), the architecture
//     enforcement gate (`checkEnforcement`), then the write and commit-on-save (`afterSave`);
//   - every route sits below the session gate (index.mjs); a POST from a foreign browser Origin is refused (403)
//     and must be JSON (415); the body is size-capped.
import express from 'express';
import fs from 'node:fs';
import { listUnits } from '../../../src/engine/unitSummary.mjs';
import { describeComponent } from '../../../src/engine/describeComponent.mjs';
import { checkPropLinks, propLinkViolations } from '../../../src/engine/propLinks.mjs';
import { collectDiagnostics, fromViolation } from '../../../src/engine/diagnostics.mjs';
import { loadConfig } from '../../../src/config.mjs';
import { resolveProjectFile } from './projectNav.mjs';
import { checkEnforcement, featuresRootOf, hashOf, PagesEditorError } from './pagesEditor.mjs';

export const MAX_COMPONENT_BYTES = 512 * 1024; // readable
// Editable: the app-wide JSON body limit is 100 kb (express.json in index.mjs), so a file that can be SENT back is capped below it.
export const MAX_EDIT_BYTES = 80 * 1024;
const EXT = /\.(tsx|jsx|ts|js|mjs)$/;

const err = (status, code, error) => ({ status, body: { ok: false, code, error } });
const noExt = (name) => name.replace(EXT, '');

/** Every component file of the project: `{ name, path, feature }` (feature is null outside features/). */
export function listComponents(root) {
  const r = listUnits(root, { kind: 'component' });
  if (!r.ok) return [];
  const base = `${featuresRootOf(root)}/`;
  return r.units
    .filter((u) => typeof u.path === 'string')
    .map((u) => ({ name: noExt(u.path.split('/').pop() ?? u.path), path: u.path, feature: u.path.startsWith(base) ? u.path.slice(base.length).split('/')[0] || null : null }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.path.localeCompare(b.path));
}

/** The real, validated file for a client-named path, or an error result. The path must be in the list, verbatim. */
function pick(root, rel) {
  if (typeof rel !== 'string' || !rel) return { fail: err(400, 'BAD_PATH', 'path is required.') };
  const entry = listComponents(root).find((c) => c.path === rel);
  if (!entry) return { fail: err(404, 'NOT_A_COMPONENT', 'That file is not a component of this project.') };
  const real = resolveProjectFile(root, rel);
  if (!real) return { fail: err(400, 'BAD_PATH', 'That file is not a readable source file inside the project.') };
  if (fs.statSync(real).size > MAX_COMPONENT_BYTES) return { fail: err(413, 'TOO_LARGE', 'That file is too large to open here.') };
  return { entry, real };
}

export function componentsIndex(root) {
  const components = listComponents(root);
  return { status: 200, body: { ok: true, count: components.length, components } };
}

/** #473 (PROP-LINK) -- best-effort: a component's own props documentation must never fail to load
 * because the cross-project call-site scan hit something unexpected (a huge project, an unusual
 * tsconfig). Returns `[]` on any error, same as a project with no findings. */
async function propLinkFindings(root, rel, described) {
  if (!described.ok || !described.components?.length) return [];
  try {
    const linked = await checkPropLinks(root, rel, { described });
    if (!linked.ok) return [];
    const severity = loadConfig(root).rules['PROP-LINK'];
    return linked.components.flatMap((c) => propLinkViolations(rel, c, severity));
  } catch {
    return [];
  }
}

export async function componentDescribe(root, rel, options = {}) {
  const p = pick(root, rel);
  if (p.fail) return p.fail;
  const result = await describeComponent(root, rel, options);
  const propLinks = await propLinkFindings(root, rel, result);
  return { status: 200, body: { ...result, name: p.entry.name, feature: p.entry.feature, propLinks } };
}

/** #473 (PROP-LINK) diagnostics for one component file, in the same normalized shape
 * `collectDiagnostics` returns (so the editor markers and the "N notes" summary line pick them
 * up for free, no client change needed). Best-effort: never throws, `[]` on any error. */
async function propLinkDiagnostics(root, rel, source) {
  try {
    const linked = await checkPropLinks(root, rel);
    if (!linked.ok) return [];
    const ruleConfig = loadConfig(root).rules['PROP-LINK'];
    const lines = source.split('\n');
    return linked.components.flatMap((c) => propLinkViolations(rel, c, ruleConfig)).map((v) => fromViolation(v, lines));
  } catch {
    return [];
  }
}

export async function componentSource(root, rel) {
  const p = pick(root, rel);
  if (p.fail) return p.fail;
  const source = fs.readFileSync(p.real, 'utf8');
  let diagnostics = [];
  try {
    diagnostics = collectDiagnostics(root, rel, source);
  } catch {
    /* a file that does not parse has no diagnostics we can compute; it still opens as plain text */
  }
  diagnostics = [...diagnostics, ...(await propLinkDiagnostics(root, rel, source))];
  return { status: 200, body: { ok: true, path: rel, name: p.entry.name, feature: p.entry.feature, source, contentHash: hashOf(source), editable: Buffer.byteLength(source, 'utf8') <= MAX_EDIT_BYTES, diagnostics } };
}

/** Preview (`commit` false: nothing written, returns before/after) or save (`commit` true). The file's text is the
 * only thing the client sends; where it goes is decided here. `afterSave(root, rel)` is commit-on-save (#283). */
export function componentSave(root, body, { afterSave = () => null } = {}) {
  const { path: rel, content, contentHash, commit } = body ?? {};
  const p = pick(root, rel);
  if (p.fail) return p.fail;
  if (typeof content !== 'string') return err(400, 'BAD_CONTENT', 'content must be the new text of the file.');
  if (Buffer.byteLength(content, 'utf8') > MAX_EDIT_BYTES) return err(413, 'TOO_LARGE', 'That file would be too large to save here.');
  const before = fs.readFileSync(p.real, 'utf8');
  if (commit !== true) return { status: 200, body: { ok: true, before, after: content, contentHash: hashOf(before), changed: before !== content } };
  if (contentHash !== hashOf(before)) return err(409, 'CHANGED_ON_DISK', 'The file changed on disk since it was loaded; re-read it and redo the edit.');
  if (before === content) return { status: 200, body: { ok: true, unchanged: true, path: rel, contentHash: hashOf(before), violations: [] } };
  const enforcement = checkEnforcement(root, rel, content);
  if (!enforcement.ok) return { status: 422, body: { ok: false, code: 'BLOCKED', error: 'Save blocked: violates architecture rules.', violations: enforcement.violations } };
  fs.writeFileSync(p.real, content);
  return { status: 200, body: { ok: true, path: rel, contentHash: hashOf(content), violations: enforcement.violations, autoCommit: afterSave(root, rel) } };
}

/** @param {{getRoot: () => {ok:true, root:string} | {ok:false, error:string}, clientOrigin?: string, afterSave?: (root:string, rel:string) => unknown, describeOptions?: object}} deps */
export function createComponentsRouter({ getRoot, clientOrigin, afterSave, describeOptions = {} }) {
  const router = express.Router();
  router.use((req, res, next) => {
    if (req.method === 'POST') {
      const origin = req.get('origin');
      if (clientOrigin && origin && origin !== clientOrigin) return res.status(403).json({ ok: false, error: 'This request came from a page that is not the Cockpit.' });
      if (!req.is('application/json')) return res.status(415).json({ ok: false, error: 'Send a JSON body.' });
    }
    return next();
  });
  const handle = (fn) => async (req, res) => {
    const r = getRoot();
    if (!r.ok) return res.status(400).json({ ok: false, error: r.error });
    try {
      const out = await fn(r.root, req);
      return res.status(out.status).json(out.body);
    } catch (e) {
      if (e instanceof PagesEditorError) return res.status(e.status).json({ ok: false, error: e.message });
      return res.status(500).json({ ok: false, error: 'Could not read that component.' });
    }
  };
  const one = (v) => (typeof v === 'string' ? v : '');
  router.get('/', handle((root) => componentsIndex(root)));
  router.get('/describe', handle((root, req) => componentDescribe(root, one(req.query.path), describeOptions)));
  router.get('/source', handle((root, req) => componentSource(root, one(req.query.path))));
  router.post('/save', handle((root, req) => componentSave(root, req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {}, { afterSave })));
  return router;
}
