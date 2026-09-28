// #387 (design docs/design/ia-five-screens.md 9.6) -- the HTTP surface for the two AI-assisted story flows:
//   POST /api/story-ai/skeleton       structure-only skeleton of a login-only page (no model call) -- shown to
//                                      the user BEFORE anything is sent, for both the "preview" itself and as a
//                                      building block for the pattern-proposal prompt below.
//   POST /api/story-ai/pattern/propose  "AI proposes the parse pattern ONCE" (9.6, preferred flow): one model
//                                      call over a stripped/skeleton copy of a page proposes `{url, parse}`
//                                      selectors; every selector is re-validated (storySelectors.mjs) and then
//                                      proved to actually match (storyExtract.mjs) before being returned, so an
//                                      unusable or hallucinated selector is dropped, never handed to the user as
//                                      if it worked. The caller turns the result into a diff via the EXISTING
//                                      /api/story-bridge/preview + /save (#386) -- this route never writes.
//   POST /api/story-ai/extract        "extraction on every use" (9.6, optional): one model call proposes field
//                                      VALUES directly; storyVerifyExtraction.mjs then requires every value be
//                                      quoted, verbatim, in the page text that was sent -- an unverifiable value
//                                      is rejected, never returned as if it were real.
//
// Consent and the fetch itself are NOT this router's concern: `html` always arrives already fetched by the
// caller through the existing consent-gated `/api/story/fetch` (storyFetchApi.mjs, #384) or, for a login-only
// page, captured by the userscript bridge (#386) -- this router only ever reads text it is handed, never fetches
// on its own. That also means "AI unavailable" is answered the same way for both flows: before spending any
// model call, `getOllamaStatusImpl()` is checked; when the model is offline the caller falls back to the
// existing mechanical snapshot (`ia-story-indicators`, design 9.8: "Using snapshot from <time>") instead of a
// half-finished AI call.
import express from 'express';
import { buildSkeleton } from '../../../packages/engine/storySkeleton.mjs';
import { buildStrippedText } from '../../../packages/engine/storyStrippedText.mjs';
import { validateParseSpec, SelectorError, SINGLE_VALUE_FIELDS, LIST_FIELDS } from '../../../packages/engine/storySelectors.mjs';
import { extract } from '../../../packages/engine/storyExtract.mjs';
import { verifyExtraction } from '../../../packages/engine/storyVerifyExtraction.mjs';
import { callLlm, stripCodeFence } from '../../../packages/core/llm.mjs';
import { getOllamaStatus } from './ollama.mjs';

export const MAX_HTML_BYTES = 2_000_000; // matches storyExtract.mjs's DEFAULT_MAX_HTML_BYTES

const ALL_FIELDS = [...SINGLE_VALUE_FIELDS, ...LIST_FIELDS];

const isPlain = (v) => v && typeof v === 'object' && !Array.isArray(v);
const bodyOf = (req) => (isPlain(req.body) ? req.body : {});

function proposePrompt(text, fields) {
  return [
    'You read the plain text of one web page and propose CSS or XPath selectors that would find each named field',
    'on the ORIGINAL html of that same page (the text below has already had tags stripped for you to read).',
    `Fields: ${fields.join(', ')}. "${LIST_FIELDS.join(', ')}" field(s) should select every matching item.`,
    'Reply with ONLY a JSON object mapping field name to a selector: either a plain string (CSS) or {"xpath": "..."}.',
    'Omit a field entirely if you are not confident. No prose, no markdown code fence, JSON only.',
    '',
    '--- PAGE TEXT ---',
    text,
  ].join('\n');
}

function extractPrompt(text, fields) {
  return [
    'You read the plain text of one web page and copy out the value of each named field, VERBATIM -- exact',
    'wording, do not paraphrase or summarise, because every value you return will be checked against this same',
    `text and dropped if it is not an exact quote. Fields: ${fields.join(', ')}.`,
    `"${LIST_FIELDS.join(', ')}" field(s) should be a JSON array of exact quoted items.`,
    'Reply with ONLY a JSON object mapping field name to its quoted value (or array). Omit a field you cannot',
    'find verbatim. No prose, no markdown code fence, JSON only.',
    '',
    '--- PAGE TEXT ---',
    text,
  ].join('\n');
}

async function callModelJson(callLlmImpl, provider, prompt, timeoutMs) {
  let raw;
  try {
    raw = await callLlmImpl(provider, prompt, timeoutMs ? { timeoutMs } : {});
  } catch (e) {
    return { ok: false, code: 'MODEL_ERROR', message: String(e?.message || e).slice(0, 300) };
  }
  try {
    const parsed = JSON.parse(stripCodeFence(String(raw ?? '')));
    if (!isPlain(parsed)) return { ok: false, code: 'BAD_MODEL_RESPONSE', message: 'The model did not return a JSON object.' };
    return { ok: true, value: parsed };
  } catch {
    return { ok: false, code: 'BAD_MODEL_RESPONSE', message: 'The model did not return valid JSON.' };
  }
}

function validateCommon(body) {
  const { feature, url, html } = body;
  if (typeof feature !== 'string' || !feature || feature.includes('/') || feature.includes('..')) {
    return { ok: false, status: 400, code: 'BAD_FEATURE', message: 'feature must be a single directory name.' };
  }
  if (typeof url !== 'string' || !/^https:\/\//i.test(url)) return { ok: false, status: 400, code: 'BAD_URL', message: 'url must be an https URL.' };
  if (typeof html !== 'string' || !html) return { ok: false, status: 400, code: 'BAD_HTML', message: 'html is required (fetch it first via /api/story/fetch).' };
  if (Buffer.byteLength(html, 'utf8') > MAX_HTML_BYTES) return { ok: false, status: 413, code: 'TOO_LARGE', message: `html is larger than ${MAX_HTML_BYTES} bytes.` };
  return { ok: true, feature, url, html };
}

/** @param {{ provider?: string, callLlmImpl?: typeof callLlm, getOllamaStatusImpl?: typeof getOllamaStatus,
 *   clientOrigin?: string, llmTimeoutMs?: number }} [deps] */
export function createStoryAiRouter({
  provider = 'ollama', callLlmImpl = callLlm, getOllamaStatusImpl = getOllamaStatus, clientOrigin, llmTimeoutMs,
} = {}) {
  const router = express.Router();

  router.use((req, res, next) => {
    const origin = req.get('origin');
    if (clientOrigin && origin && origin !== clientOrigin) return res.status(403).json({ ok: false, error: 'This request came from a page that is not the Cockpit.' });
    if (req.session === undefined) return res.status(401).json({ ok: false, error: 'Authentication required.' });
    return next();
  });
  router.use(express.json({ limit: '3mb' }));
  router.use((req, res, next) => {
    if (!req.is('application/json')) return res.status(415).json({ ok: false, error: 'Send a JSON body.' });
    return next();
  });

  const modelOfflineCheck = async () => {
    const status = await getOllamaStatusImpl();
    if (status.running) return null;
    return { ok: false, code: 'MODEL_OFFLINE', error: 'The local model is offline. Using the last snapshot instead of sending anything.' };
  };

  router.post('/skeleton', (req, res) => {
    const { html } = bodyOf(req);
    if (typeof html !== 'string' || !html) return res.status(400).json({ ok: false, code: 'BAD_HTML', error: 'html is required.' });
    if (Buffer.byteLength(html, 'utf8') > MAX_HTML_BYTES) return res.status(413).json({ ok: false, code: 'TOO_LARGE', error: `html is larger than ${MAX_HTML_BYTES} bytes.` });
    const out = buildSkeleton(html);
    if (!out.ok) return res.status(400).json({ ok: false, code: out.code, error: out.message });
    return res.status(200).json({ ok: true, text: out.text, truncated: out.truncated, bytes: out.bytes });
  });

  router.post('/pattern/propose', async (req, res) => {
    const v = validateCommon(bodyOf(req));
    if (!v.ok) return res.status(v.status).json({ ok: false, code: v.code, error: v.message });
    const offline = await modelOfflineCheck();
    if (offline) return res.status(503).json(offline);

    const stripped = buildStrippedText(v.html);
    if (!stripped.ok) return res.status(400).json({ ok: false, code: stripped.code, error: stripped.message });

    const modelOut = await callModelJson(callLlmImpl, provider, proposePrompt(stripped.text, ALL_FIELDS), llmTimeoutMs);
    if (!modelOut.ok) return res.status(502).json({ ok: false, code: modelOut.code, error: modelOut.message });

    let selectors;
    try {
      selectors = validateParseSpec(modelOut.value);
    } catch (e) {
      if (e instanceof SelectorError) return res.status(422).json({ ok: false, code: e.code, error: e.message });
      throw e;
    }
    if (Object.keys(selectors).length === 0) return res.status(422).json({ ok: false, code: 'EMPTY_PROPOSAL', error: 'The model proposed no fields.' });

    const fields = Object.entries(selectors).map(([name, sel]) => ({ name, selector: sel.value, kind: sel.kind, list: LIST_FIELDS.includes(name) }));
    const checked = extract(v.html, { fields });
    if (checked.code) return res.status(400).json({ ok: false, code: checked.code, error: checked.message });

    const rejectedFields = [...checked.misses.map((name) => ({ name, reason: 'NO_MATCH' })), ...checked.ambiguous.map((name) => ({ name, reason: 'AMBIGUOUS' }))];
    const parse = {};
    for (const name of Object.keys(selectors)) {
      if (checked.values[name] !== undefined) parse[name] = modelOut.value[name];
    }
    if (Object.keys(parse).length === 0) return res.status(422).json({ ok: false, code: 'EMPTY_PROPOSAL', error: 'None of the proposed selectors matched.', rejectedFields });

    return res.status(200).json({
      ok: true, feature: v.feature, url: v.url, parse, rejectedFields, calls: 1, sentBytes: stripped.bytes, truncated: stripped.truncated,
    });
  });

  router.post('/extract', async (req, res) => {
    const body = bodyOf(req);
    const v = validateCommon(body);
    if (!v.ok) return res.status(v.status).json({ ok: false, code: v.code, error: v.message });
    const fields = Array.isArray(body.fields) ? body.fields.filter((f) => ALL_FIELDS.includes(f)) : ALL_FIELDS;
    if (fields.length === 0) return res.status(400).json({ ok: false, code: 'BAD_FIELDS', error: `fields must be a subset of ${ALL_FIELDS.join(', ')}.` });
    const offline = await modelOfflineCheck();
    if (offline) return res.status(503).json(offline);

    const stripped = buildStrippedText(v.html);
    if (!stripped.ok) return res.status(400).json({ ok: false, code: stripped.code, error: stripped.message });

    const modelOut = await callModelJson(callLlmImpl, provider, extractPrompt(stripped.text, fields), llmTimeoutMs);
    if (!modelOut.ok) return res.status(502).json({ ok: false, code: modelOut.code, error: modelOut.message });

    const { verified, rejected } = verifyExtraction(stripped.text, modelOut.value);
    if (Object.keys(verified).length === 0) return res.status(422).json({ ok: false, code: 'NOTHING_VERIFIED', error: 'No extracted value was found verbatim in the fetched page text.', rejected });

    return res.status(200).json({
      ok: true, feature: v.feature, url: v.url, values: verified, rejected, calls: 1, sentBytes: stripped.bytes,
    });
  });

  router.use((err, req, res, next) => {
    if (err && (err.type === 'entity.parse.failed' || err.type === 'entity.too.large')) {
      return res.status(err.type === 'entity.too.large' ? 413 : 400).json({ ok: false, code: err.type === 'entity.too.large' ? 'TOO_LARGE' : 'BAD_JSON', error: err.type === 'entity.too.large' ? 'That request is too large.' : 'The request body was not valid JSON.' });
    }
    return next(err);
  });
  router.use((req, res) => res.status(404).json({ ok: false, error: 'Not found.' }));
  return router;
}
