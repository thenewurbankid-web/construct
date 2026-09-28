// #385 (slice 17 of epic #367/#616) -- the Story tab's REST surface: read a feature's `story.md`, "Add a story",
// apply a freshly-fetched snapshot, mark a compare drift reviewed, and toggle "Keep out of git". Fetching the
// ticket itself (network, consent, SSRF guard) is already `/api/story/fetch` (storyFetchApi.mjs, #384) -- this
// file only reads/writes the FILE and the two small UI-state fields that live outside it (storyUiState.mjs).
// Applying a fetched selector to page HTML (the extraction step) is #387, not built yet: `apply` below expects
// the caller to already have picked fields (from `parse`, from #387, once it exists), so the wiring is ready.
//
//   GET  /:feature                         parsed story (front matter, tool block, compare, drift), or `exists:false`
//   POST /:feature                         "Add a story": create story.md from the template (409 if one exists)
//   POST /:feature/apply     {fetchedAt, title, description, status, acceptanceTexts}
//                                           write a freshly-fetched snapshot (409 CONFLICT if hand-edited)
//   POST /:feature/reviewed  {driftHash}    "Mark reviewed" (design 9.5)
//   POST /:feature/keep      {keepOutOfGit} move the file between the tracked path and the per-user state dir
//
// Security, in one place: the feature name is compared against the project's REAL feature list (never becomes a
// path until re-validated, same pattern as testsApi.mjs's `checkFeature`); every write goes through `afterSave`
// (autoCommit.mjs) so it follows the project's own commit mode, exactly like Notes/Components/Pages; a mutating
// request from a foreign browser Origin is refused (403).
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { listUnits } from '../../../packages/engine/unitSummary.mjs';
import {
  parseStory, writeStorySnapshot, compareStory, summaryDriftHash, readStoryTags, storyTemplate,
} from '../../../packages/core/story.mjs';
import { openStoryUiState } from '../../../packages/engine/storyUiState.mjs';

const NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/;
const isPlain = (v) => v && typeof v === 'object' && !Array.isArray(v);
const bodyOf = (req) => (isPlain(req.body) ? req.body : {});

/** The current project's real feature, or a refusal. Only ever COMPARES the client's string (testsApi.mjs precedent). */
function checkFeature(root, feature) {
  if (typeof feature !== 'string' || !feature || feature.includes('\0') || !NAME.test(feature)) return { status: 400, body: { ok: false, error: 'That is not a feature name.' } };
  const listed = listUnits(root, { kind: 'feature' });
  if (!listed.ok || !listed.units.some((u) => u.id === feature)) return { status: 404, body: { ok: false, error: `No feature named "${feature}" in this project.` } };
  return null;
}

function storyPath(root, feature) {
  return path.join(root, 'features', feature, 'story.md');
}
function storyRelPath(feature) {
  return `features/${feature}/story.md`;
}

/** Every `@story` id referenced anywhere under `features/<feature>/tests/`, read straight off disk (no build step). */
function referencedIds(root, feature) {
  const dir = path.join(root, 'features', feature, 'tests');
  const ids = new Set();
  const walk = (d) => {
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile()) {
        let text = '';
        try { text = fs.readFileSync(p, 'utf8'); } catch { continue; }
        for (const id of readStoryTags(text)) ids.add(id);
      }
    }
  };
  walk(dir);
  return ids;
}

/** The parsed view the client renders, whichever store (tracked file or "kept out") the text lives in. */
function readView(root, feature, uiState) {
  const kept = uiState.getKept(feature);
  const file = storyPath(root, feature);
  const onDisk = kept === null && fs.existsSync(file);
  if (kept === null && !onDisk) return { exists: false };
  const text = kept !== null ? kept : fs.readFileSync(file, 'utf8');
  const parsed = parseStory(text);
  const compare = compareStory(parsed.tool?.acceptance ?? [], referencedIds(root, feature));
  const driftHash = summaryDriftHash(compare);
  return {
    exists: true,
    keptOutOfGit: kept !== null,
    sources: parsed.sources,
    tool: parsed.tool,
    userText: parsed.userText,
    compare,
    driftHash,
    reviewedHash: uiState.getReviewedHash(feature),
  };
}

/**
 * @param {{getRoot: () => {ok:true, root:string} | {ok:false, status?:number, body?:object}, clientOrigin?: string,
 *   stateDir?: string, afterSave: (root:string, relPath:string, isNew?:boolean) => object}} deps
 */
export function createStoriesRouter({ getRoot, clientOrigin, stateDir, afterSave }) {
  const router = express.Router();

  router.use((req, res, next) => {
    if (req.method !== 'GET') {
      const origin = req.get('origin');
      if (clientOrigin && origin && origin !== clientOrigin) return res.status(403).json({ ok: false, error: 'This request came from a page that is not the Cockpit.' });
    }
    return next();
  });
  router.use(express.json({ limit: '64kb' }));
  router.use((req, res, next) => {
    if ((req.method === 'POST') && !req.is('application/json') && Object.keys(req.body ?? {}).length) return res.status(415).json({ ok: false, error: 'Send a JSON body.' });
    return next();
  });

  const handle = (fn) => (req, res) => {
    const r = getRoot();
    if (!r.ok) return res.status(r.status ?? 400).json(r.body ?? { ok: false, error: r.error ?? 'No project is open.' });
    const bad = checkFeature(r.root, req.params.feature);
    if (bad) return res.status(bad.status).json(bad.body);
    const uiState = openStoryUiState(r.root, stateDir ? { stateDir } : {});
    try {
      const out = fn(r.root, req.params.feature, req, uiState);
      return res.status(out.status).json(out.body);
    } catch (e) {
      return res.status(500).json({ ok: false, error: e.message });
    }
  };

  router.get('/:feature', handle((root, feature, req, uiState) => ({ status: 200, body: { ok: true, ...readView(root, feature, uiState) } })));

  router.post('/:feature', handle((root, feature, req, uiState) => {
    const view = readView(root, feature, uiState);
    if (view.exists) return { status: 409, body: { ok: false, code: 'EXISTS', error: 'This feature already has a story.' } };
    const text = storyTemplate(feature);
    const file = storyPath(root, feature);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
    const autoCommit = afterSave(root, storyRelPath(feature), true);
    return { status: 201, body: { ok: true, autoCommit, ...readView(root, feature, uiState) } };
  }));

  router.post('/:feature/apply', handle((root, feature, req, uiState) => {
    const b = bodyOf(req);
    if (typeof b.fetchedAt !== 'string' || !b.fetchedAt) return { status: 400, body: { ok: false, error: 'fetchedAt is required.' } };
    const kept = uiState.getKept(feature);
    const file = storyPath(root, feature);
    const onDisk = kept === null && fs.existsSync(file);
    if (kept === null && !onDisk) return { status: 404, body: { ok: false, code: 'NOT_FOUND', error: 'This feature has no story yet.' } };
    const existingText = kept !== null ? kept : fs.readFileSync(file, 'utf8');
    const result = writeStorySnapshot(existingText, {
      fetchedAt: b.fetchedAt, title: b.title, description: b.description, status: b.status, acceptanceTexts: Array.isArray(b.acceptanceTexts) ? b.acceptanceTexts : [],
    });
    if (result.conflict) return { status: 409, body: { ok: false, code: 'HAND_EDITED', error: 'The snapshot was edited by hand since the last refresh. Keep mine, or refresh again to overwrite it.' } };
    if (!result.changed) return { status: 200, body: { ok: true, changed: false, ...readView(root, feature, uiState) } };
    if (kept !== null) uiState.setKept(feature, result.text);
    else fs.writeFileSync(file, result.text);
    const autoCommit = kept !== null ? { committed: false, status: 'kept-out-of-git' } : afterSave(root, storyRelPath(feature), false);
    return { status: 200, body: { ok: true, changed: true, autoCommit, ...readView(root, feature, uiState) } };
  }));

  router.post('/:feature/reviewed', handle((root, feature, req, uiState) => {
    const b = bodyOf(req);
    if (typeof b.driftHash !== 'string' || !b.driftHash) return { status: 400, body: { ok: false, error: 'driftHash is required.' } };
    uiState.setReviewedHash(feature, b.driftHash);
    return { status: 200, body: { ok: true, ...readView(root, feature, uiState) } };
  }));

  router.post('/:feature/keep', handle((root, feature, req, uiState) => {
    const b = bodyOf(req);
    if (typeof b.keepOutOfGit !== 'boolean') return { status: 400, body: { ok: false, error: 'keepOutOfGit must be a boolean.' } };
    const file = storyPath(root, feature);
    const wasKept = uiState.getKept(feature) !== null;
    if (b.keepOutOfGit && !wasKept) {
      if (!fs.existsSync(file)) return { status: 404, body: { ok: false, code: 'NOT_FOUND', error: 'This feature has no story yet.' } };
      const text = fs.readFileSync(file, 'utf8');
      uiState.setKept(feature, text);
      fs.rmSync(file);
      const autoCommit = afterSave(root, storyRelPath(feature), false);
      return { status: 200, body: { ok: true, autoCommit, ...readView(root, feature, uiState) } };
    }
    if (!b.keepOutOfGit && wasKept) {
      const text = uiState.getKept(feature);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, text);
      uiState.setKept(feature, null);
      const autoCommit = afterSave(root, storyRelPath(feature), true);
      return { status: 200, body: { ok: true, autoCommit, ...readView(root, feature, uiState) } };
    }
    return { status: 200, body: { ok: true, ...readView(root, feature, uiState) } };
  }));

  router.use((err, req, res, next) => {
    if (err && (err.type === 'entity.parse.failed' || err.type === 'entity.too.large')) {
      return res.status(err.type === 'entity.too.large' ? 413 : 400).json({ ok: false, code: err.type === 'entity.too.large' ? 'TOO_LARGE' : 'BAD_JSON', error: err.type === 'entity.too.large' ? 'That request is too large.' : 'The request body was not valid JSON.' });
    }
    return next(err);
  });
  router.use((req, res) => res.status(404).json({ ok: false, error: 'Not found.' }));
  return router;
}
