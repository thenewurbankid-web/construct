// #384 (design: docs/design/ia-five-screens.md 9.3, 9.6) -- one call, `StoryApi.fetch(url)` / `POST
// /api/story/fetch`, one strategy chosen per link:
//   1. public page, host on the allow-list -> server, guarded by the ONE shared fetch (`safeFetch.mjs`, #436);
//   2. anything else -> the userscript bridge (#386, not implemented here): this module reports NEEDS_BRIDGE and
//      does nothing further, since the server must never hold or use a login.
// The (optional, later, owner-decision) server headless-browser strategy is not built; there is no slot to pick it.
//
// Consent (9.6, "a story file is not a permission") and selector VALIDATION (9.6b) both happen before any network
// call: a bad selector or a missing consent never spends a fetch. Applying a validated selector to the fetched
// HTML (extraction) is a later slice (#387) once the HTML-parsing dependency is chosen by its own spike (9.6b);
// this service returns the fetched, sanitised page text un-extracted.
import { safeFetch, DEFAULT_MAX_BYTES, DEFAULT_TIMEOUT_MS } from './safeFetch.mjs';
import { validateParseSpec, SelectorError } from './storySelectors.mjs';

/** `github.com` per 9.6; Atlassian only if the owner ever configures it (9.9), never on by default. */
export const DEFAULT_STORY_FETCH_HOSTS = Object.freeze(['github.com']);

/** The strategy for `host`: 'server' when it is on the allow-list (public page, SSRF-guarded), else 'bridge'
 * (login-only page, read through the user's own browser, #386 -- not implemented here).
 * @param {string} host - the target hostname.
 * @param {string[]} allowHosts - the configured allow-list of public hosts.
 * @returns {'server'|'bridge'} which strategy to use for this host.
 */
export function chooseStrategy(host, allowHosts) {
  return allowHosts.includes(String(host).toLowerCase()) ? 'server' : 'bridge';
}

/** Untrusted page text, made safe to keep and show: strip control characters (keep `\n`/`\t`), never HTML.
 * @param {string} text - the raw fetched text.
 * @returns {string} the text with control characters removed.
 */
export function sanitizeText(text) {
  return String(text).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/g, '');
}

/**
 * @param {string} url
 * @returns {{ok:true, host:string} | {ok:false, code:'BAD_URL', message:string}}
 */
function hostOf(url) {
  if (typeof url !== 'string' || url === '') return { ok: false, code: 'BAD_URL', message: 'A url is required.' };
  try {
    return { ok: true, host: new URL(url).hostname.toLowerCase() };
  } catch {
    return { ok: false, code: 'BAD_URL', message: 'That is not a valid url.' };
  }
}

/**
 * Fetch one story link end to end: validate its url/parse spec, choose the server or bridge
 * strategy for its host, and (server strategy only) run the guarded fetch and sanitize the result.
 * @param {{url?:string, parse?:unknown, allowHosts?:string[], maxBytes?:number, timeoutMs?:number,
 *   safeFetchImpl?: typeof safeFetch}} [input] `url` is required at runtime (a missing/invalid one
 *   returns `{ok:false, code:'BAD_URL', ...}` rather than throwing).
 * @returns {Promise<
 *   {ok:true, via:'server', status:number, url:string, text:string, redirects:number, selectors:Record<string,{kind:string,value:string}>}
 *   | {ok:false, code:'NEEDS_BRIDGE', via:'bridge', host:string}
 *   | {ok:false, code:string, message:string}
 * >}
 */
export async function fetchStory({
  url, parse, allowHosts = [...DEFAULT_STORY_FETCH_HOSTS], maxBytes = DEFAULT_MAX_BYTES, timeoutMs = DEFAULT_TIMEOUT_MS, safeFetchImpl = safeFetch,
} = {}) {
  const parsed = hostOf(url);
  // tsc's checkJs does not narrow a JSDoc-declared union on a boolean `ok` discriminant the way it
  // does for a string discriminant (verified against a minimal repro); the cast documents the same
  // narrowing `!parsed.ok` already guarantees at runtime.
  if (!parsed.ok) return /** @type {{ok:false, code:string, message:string}} */ (parsed);
  let selectors;
  try {
    selectors = validateParseSpec(parse);
  } catch (e) {
    if (e instanceof SelectorError) return { ok: false, code: e.code, message: e.message };
    throw e;
  }
  const strategy = chooseStrategy(parsed.host, allowHosts);
  if (strategy === 'bridge') return { ok: false, code: 'NEEDS_BRIDGE', via: 'bridge', host: parsed.host };
  const result = await safeFetchImpl(url, {
    allowHosts,
    maxBytes,
    timeoutMs,
    allowContentTypes: ['text/html', 'text/plain', 'application/xhtml+xml'],
  });
  if (!result.ok) return { ok: false, code: result.code, message: result.message };
  return {
    ok: true,
    via: 'server',
    status: result.status,
    url: result.url,
    redirects: result.redirects,
    text: sanitizeText(result.body.toString('utf8')),
    selectors,
  };
}
