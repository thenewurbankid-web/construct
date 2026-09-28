// #384 (design: docs/design/ia-five-screens.md 9.3, 9.6, 9.6b) -- the HTTP surface for `StoryApi.fetch(url)`:
//   POST   /api/story/fetch      one guarded fetch, strategy chosen per link, consent enforced first
//   GET    /api/story/consent    the standing (host, url) approvals/denials, for the revoke list (9.6)
//   DELETE /api/story/consent/:id  revoke one
//
// Persistence is `storyConsentStore.mjs` / the guard is `storyFetchService.mjs` (which itself defers to the ONE
// shared SSRF-guarded fetch, `packages/engine/safeFetch.mjs`, #436); this file only maps HTTP onto them, same
// division as `notesApi.mjs` / `notesStore.mjs`.
//
// Security, in one place:
//   - mounted below the session gate AND the project-open gate (consent is per PROJECT, since a story.md's
//     trustworthiness depends on which repository it came from);
//   - a mutating request (anything but GET) from a foreign browser Origin is refused (403), same rule as notes;
//   - the client never widens the host allow-list or the fetch caps: it names a url and, optionally, `parse`
//     selectors and a consent choice, everything else is decided on the server;
//   - "allow once" is never persisted (`storyConsentStore.mjs`): it grants exactly the call in flight.
import express from 'express';
import { openConsentStore } from '../../../packages/engine/storyConsentStore.mjs';
import { fetchStory, DEFAULT_STORY_FETCH_HOSTS, chooseStrategy } from '../../../packages/engine/storyFetchService.mjs';

/** A `safeFetch`/service failure code -> the HTTP status it is reported with. */
const FETCH_ERROR_STATUS = {
  BAD_URL: 400, BAD_SCHEME: 400, BAD_SHAPE: 400, EMPTY: 400, TOO_LONG: 400, BAD_SYNTAX: 400, BANNED_CONSTRUCT: 400,
  HOST_NOT_ALLOWED: 403, NOT_PUBLIC: 403,
  TOO_LARGE: 413,
  TIMEOUT: 504,
};

const isPlain = (v) => v && typeof v === 'object' && !Array.isArray(v);
const bodyOf = (req) => (isPlain(req.body) ? req.body : {});

/**
 * @param {{getRoot: () => {ok:true, root:string} | {ok:false, status?:number, body?:object},
 *   clientOrigin?: string, stateDir?: string, now?: () => string, allowHosts?: string[],
 *   safeFetchImpl?: Function}} deps
 */
export function createStoryFetchRouter({
  getRoot, clientOrigin, stateDir, now, allowHosts = DEFAULT_STORY_FETCH_HOSTS, safeFetchImpl,
} = {}) {
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
    if ((req.method === 'POST') && !req.is('application/json')) return res.status(415).json({ ok: false, error: 'Send a JSON body.' });
    return next();
  });

  const withStore = (fn) => (req, res) => {
    const r = getRoot();
    if (!r.ok) return res.status(r.status ?? 400).json(r.body ?? { ok: false, error: r.error ?? 'No project is open.' });
    const consent = openConsentStore(r.root, { ...(stateDir ? { stateDir } : {}), ...(now ? { now } : {}) });
    return fn(consent, req, res);
  };

  router.get('/consent', withStore((consent, req, res) => {
    res.status(200).json({ ok: true, approvals: consent.list() });
  }));

  router.delete('/consent/:id', withStore((consent, req, res) => {
    const removed = consent.revoke(req.params.id);
    if (!removed) return res.status(404).json({ ok: false, code: 'NOT_FOUND', error: `No such approval "${req.params.id}".` });
    return res.status(200).json({ ok: true, removed: req.params.id });
  }));

  router.post('/fetch', withStore(async (consent, req, res) => {
    const { url, parse, consent: choice, source } = bodyOf(req);
    if (typeof url !== 'string' || url === '') return res.status(400).json({ ok: false, code: 'BAD_URL', error: 'A url is required.' });
    let host;
    try {
      host = new URL(url).hostname.toLowerCase();
    } catch {
      return res.status(400).json({ ok: false, code: 'BAD_URL', error: 'That is not a valid url.' });
    }
    const sourceOrigin = source === 'foreign' ? 'foreign' : 'local';

    if (chooseStrategy(host, allowHosts) === 'bridge') {
      return res.status(409).json({ ok: false, code: 'NEEDS_BRIDGE', via: 'bridge', host, error: 'This host is not fetched by the server; read it with the userscript bridge.' });
    }

    const decision = consent.decisionFor(host, url);
    if (decision?.decision === 'deny') return res.status(403).json({ ok: false, code: 'CONSENT_DENIED', host, url, error: `Reading ${url} was denied.` });
    if (!decision || decision.decision !== 'allow') {
      if (choice === 'always') {
        consent.record({ host, scope: 'host', decision: 'allow', sourceOrigin });
      } else if (choice === 'deny') {
        consent.record({ host, url, scope: 'url', decision: 'deny', sourceOrigin });
        return res.status(403).json({ ok: false, code: 'CONSENT_DENIED', host, url, error: `Reading ${url} was denied.` });
      } else if (choice !== 'once') {
        return res.status(428).json({
          ok: false,
          code: 'CONSENT_REQUIRED',
          host,
          url,
          warning: sourceOrigin === 'foreign',
          error: `This story wants to read ${url} from ${host}. Allow once, always for this host, or deny.`,
        });
      }
      // choice === 'once': proceed without persisting anything.
    }

    const result = await fetchStory({ url, parse, allowHosts, ...(safeFetchImpl ? { safeFetchImpl } : {}) });
    if (result.ok) return res.status(200).json({ ok: true, via: result.via, status: result.status, url: result.url, redirects: result.redirects, text: result.text, selectors: result.selectors });
    const status = FETCH_ERROR_STATUS[result.code] ?? 502;
    return res.status(status).json({ ok: false, code: result.code, error: result.message });
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
