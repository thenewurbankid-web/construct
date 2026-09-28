// #386 (part of #367): the server side of the Picker's "propose selectors as a diff to story.md" (design
// docs/design/ia-five-screens.md section 9.7). Below the session gate like every other `/api` route
// (index.mjs). The request body is UNTRUSTED TEXT from the userscript's fields-only response -- it is never
// executed, never rendered as HTML, and the only thing ever written to disk is the `sources[].parse`
// selectors (data), validated the same way the userscript validates them client-side (design 9.6b).
//
// Two steps, mirroring every other AI-fill / Fill-with-AI flow in this Cockpit (componentsApi.mjs,
// pagesEditor.mjs): `/preview` computes the diff and writes nothing; `/save` re-validates and writes. The
// human approves in between -- there is no auto-apply here.
//
// This module does NOT create story.md (that's #385's "Add a story"), does NOT write the tool-owned
// snapshot block (that's #383), and does NOT run the freshness/fingerprint check (#385). It only merges one
// proposed `{url, parse}` into an EXISTING file's `sources` list.
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { featuresRootOf } from './pagesEditor.mjs';
import { mergeStorySource, StoryFrontMatterError } from './storyFrontMatter.mjs';

export const MAX_PAYLOAD_BYTES = 8 * 1024; // selectors are short strings; nothing here should ever be large
const SELECTOR_MAX_LEN = 200;

export class StoryBridgeError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** Same rule as the userscript's validateSelector (design 9.6b): length cap, CSS or {css}/{xpath}, no
 * javascript:/script forms, no XPath function that reaches outside the tree. Kept independent (not a shared
 * import from ui/client/public/construct-clipper.user.js) because the two run in different runtimes and this
 * is a small, deterministic, easily-duplicated check -- exactly the kind that is cheap to keep in sync by
 * eye and expensive to couple across a client/server boundary. */
export function validateSelector(value) {
  const isPlain = typeof value === 'string';
  const isBoxed = value && typeof value === 'object' && (typeof value.css === 'string' || typeof value.xpath === 'string');
  if (!isPlain && !isBoxed) return { ok: false, error: 'A selector must be a string (CSS) or {css} / {xpath}.' };
  const kind = isPlain ? 'css' : value.css != null ? 'css' : 'xpath';
  const text = isPlain ? value : value.css != null ? value.css : value.xpath;
  if (typeof text !== 'string' || !text.trim()) return { ok: false, error: 'Selector text is empty.' };
  if (text.length > SELECTOR_MAX_LEN) return { ok: false, error: `Selector is longer than ${SELECTOR_MAX_LEN} characters.` };
  if (/javascript\s*:/i.test(text)) return { ok: false, error: 'javascript: is not a valid selector.' };
  if (kind === 'xpath' && (/\bdocument\s*\(/i.test(text) || /\bid\s*\(/i.test(text))) {
    return { ok: false, error: 'That XPath reaches outside the page; only plain node-set paths are evaluated.' };
  }
  return { ok: true };
}

function validateBody(body) {
  const { feature, url, parse } = body;
  if (typeof feature !== 'string' || !feature || feature.includes('/') || feature.includes('..')) {
    throw new StoryBridgeError(400, 'feature must be a single directory name.');
  }
  if (typeof url !== 'string' || !/^https:\/\//i.test(url)) throw new StoryBridgeError(400, 'url must be an https URL.');
  if (!parse || typeof parse !== 'object' || Array.isArray(parse) || Object.keys(parse).length === 0) {
    throw new StoryBridgeError(400, 'parse must be a mapping of field name to selector.');
  }
  for (const [name, selector] of Object.entries(parse)) {
    const v = validateSelector(selector);
    if (!v.ok) throw new StoryBridgeError(422, `${name}: ${v.error}`);
  }
  return { feature, url, parse };
}

// `feature` is already validated (validateBody) to be a single directory name with no `/` or `..`, so this
// only needs to guard against a symlink walking the result outside the project root -- projectNav.mjs's
// resolveProjectFile does not apply here, it allow-lists source-code extensions only (.ts/.tsx/.js/.jsx),
// and would reject `story.md` unconditionally.
function storyPathFor(root, feature) {
  const abs = path.join(root, featuresRootOf(root), feature, 'story.md');
  let realRoot;
  let real;
  try {
    realRoot = fs.realpathSync(root);
    real = fs.realpathSync(abs);
  } catch {
    return null;
  }
  const isInside = real === realRoot || real.startsWith(realRoot.endsWith(path.sep) ? realRoot : realRoot + path.sep);
  if (!isInside || !fs.statSync(real).isFile()) return null;
  return real;
}

function computeDiff(root, body) {
  const { feature, url, parse } = validateBody(body);
  const real = storyPathFor(root, feature);
  if (!real) throw new StoryBridgeError(404, `No story yet for "${feature}". Add a story first.`);
  const before = fs.readFileSync(real, 'utf8');
  let merged;
  try {
    merged = mergeStorySource(before, { url, parse });
  } catch (e) {
    if (e instanceof StoryFrontMatterError) throw new StoryBridgeError(422, e.message);
    throw e;
  }
  return { real, feature, ...merged };
}

/** @param {{getRoot: () => {ok:true, root:string} | {ok:false, error:string}, clientOrigin?: string, afterSave?: (root:string, rel:string, isNew?: boolean) => unknown}} deps */
export function createStoryBridgeRouter({ getRoot, clientOrigin, afterSave }) {
  const router = express.Router();

  router.use((req, res, next) => {
    const origin = req.get('origin');
    if (clientOrigin && origin && origin !== clientOrigin) return res.status(403).json({ ok: false, error: 'This request came from a page that is not the Cockpit.' });
    if (req.session === undefined) return res.status(401).json({ ok: false, error: 'Authentication required.' });
    if (!req.is('application/json')) return res.status(415).json({ ok: false, error: 'Send a JSON body.' });
    const len = Number(req.get('content-length') || 0);
    if (len > MAX_PAYLOAD_BYTES) return res.status(413).json({ ok: false, error: 'That proposal is larger than expected for selectors alone.' });
    return next();
  });

  const handle = (fn) => (req, res) => {
    const r = getRoot();
    if (!r.ok) return res.status(400).json({ ok: false, error: r.error });
    const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
    try {
      const out = fn(r.root, body);
      return res.status(out.status).json(out.body);
    } catch (e) {
      if (e instanceof StoryBridgeError) return res.status(e.status).json({ ok: false, error: e.message });
      return res.status(500).json({ ok: false, error: 'Could not propose that diff.' });
    }
  };

  router.post('/preview', handle((root, body) => {
    const { before, after, changed } = computeDiff(root, body);
    return { status: 200, body: { ok: true, before, after, changed } };
  }));

  router.post('/save', handle((root, body) => {
    const { real, feature, after, changed } = computeDiff(root, body);
    if (!changed) return { status: 200, body: { ok: true, changed: false } };
    fs.writeFileSync(real, after);
    const rel = `${featuresRootOf(root)}/${feature}/story.md`;
    return { status: 200, body: { ok: true, changed: true, autoCommit: afterSave ? afterSave(root, rel, false) : undefined } };
  }));

  return router;
}
