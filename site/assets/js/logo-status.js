/* The docs logo as a status light. The white pill stays; the blue pill slowly slides under it and back, but ONLY while
 * `<html data-dev-status="active">`, and this script decides that from a mode the owner sets in their own browser:
 *   off     (default) never moves: this is what every visitor sees
 *   always  moves all the time
 *   status  moves while the endpoint the owner configured says an agent or model is working on the framework
 * Two places set it, the browser's own setting first:
 *   1. this browser (localStorage), set by link or with the small panel `?logo=config` opens:
 *        ?logo=off|always|status   the mode          ?logoApi=https://host/api/dev-status   the endpoint (?logoApi= clears it)
 *        ?logo=site                follow the site's setting again          ?logo=config   opens the panel
 *   2. the site's own setting, `logo.json` next to the pages (`{ "mode": "status", "api": "https://host/api/dev-status" }`), which the
 *      owner edits on GitHub (Trinity links there); a commit redeploys the docs. It is public like the rest of the site, so put in
 *      `api` only an address you are happy to publish; with no `api` there, only a browser that set its own endpoint polls.
 * A visitor with neither makes no request (mode off is the default).
 * The address is cleaned afterwards. The endpoint is read with a plain GET, no cookies, a 2 s timeout, every 5 s, only while the
 * tab is visible. Plain script, no libraries, works with storage blocked (the mode then lasts for the page). */
(function () {
  'use strict';
  var MODE_KEY = 'construct.docs.logo';
  var API_KEY = 'construct.docs.logo.api';
  var MODES = ['off', 'always', 'status'];
  var POLL_MS = 5000;
  var TIMEOUT_MS = 2000;

  function parseMode(value) {
    return typeof value === 'string' && MODES.indexOf(value) >= 0 ? value : null;
  }

  /** https anywhere, or http on this machine; no credentials in the address; anything else is refused. */
  function parseApi(value) {
    if (typeof value !== 'string' || !value || value.length > 300) return null;
    var url;
    try {
      url = new URL(value);
    } catch (e) {
      return null;
    }
    if (url.username || url.password) return null;
    if (url.protocol === 'https:') return url.href;
    if (url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1')) return url.href;
    return null;
  }

  /** What the endpoint answers when an agent is working: `{ ok: true, available: true, active: true }`, nothing less. */
  function isActive(body) {
    return !!body && body.ok === true && body.available === true && body.active === true;
  }

  /** Should the logo move? `polled` is the last answer from the endpoint (only read in `status` mode). */
  function moves(mode, polled) {
    return mode === 'always' || (mode === 'status' && polled === true);
  }

  var CYCLE_MS = 9000;

  /** Where the blue pill is, in SVG units left of rest, `t` ms into the loop: the same shape as the CSS keyframes (rest, slide
   * under the white pill, hold, slide back, rest), so the tab icon and the logo tell one story. 0 while at rest. */
  function pillOffset(t) {
    var p = (((t % CYCLE_MS) + CYCLE_MS) % CYCLE_MS) / CYCLE_MS;
    var ease = function (u) {
      return u * u * (3 - 2 * u);
    };
    if (p < 0.08) return 0;
    if (p < 0.46) return -12 * ease((p - 0.08) / 0.38);
    if (p < 0.54) return -12;
    if (p < 0.92) return -12 * (1 - ease((p - 0.54) / 0.38));
    return 0;
  }

  /** The Line mark as the tab icon, with the blue pill `dx` units from rest (same drawing as the static icon in every page). */
  function faviconSvg(dx) {
    return (
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><style>:root{--i:#0d0f12}@media (prefers-color-scheme:dark){:root{--i:#f2f4f7}}</style>' +
      '<defs><linearGradient id="g" gradientUnits="userSpaceOnUse" x1="4" y1="4" x2="44" y2="44"><stop offset="0" stop-color="#8fb0ff"/><stop offset="1" stop-color="#4b63f5"/></linearGradient></defs>' +
      '<rect x="4" y="10" width="28" height="11" rx="5.5" fill="var(--i)"/>' +
      '<rect x="' + (16 + dx) + '" y="27" width="28" height="11" rx="5.5" fill="none" stroke="url(#g)" stroke-width="2.8"/></svg>'
    );
  }

  /** The site's own setting: `{ mode, api }`, each `null` when missing or not allowed. Never throws. */
  function parseConfig(text) {
    var data;
    try {
      data = typeof text === 'string' ? JSON.parse(text) : text;
    } catch (e) {
      return { mode: null, api: null };
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) return { mode: null, api: null };
    return { mode: parseMode(data.mode), api: parseApi(data.api) };
  }

  /** Read the link's parameters: what to store, what to clear, whether to open the panel. */
  function readParams(search) {
    var p = new URLSearchParams(search);
    var out = { mode: null, api: undefined, config: false, touched: p.has('logo') || p.has('logoApi') };
    var logo = p.get('logo');
    if (logo === 'config') out.config = true;
    else if (logo === 'site') out.mode = 'site';
    else out.mode = parseMode(logo);
    if (p.has('logoApi')) out.api = p.get('logoApi') === '' ? '' : parseApi(p.get('logoApi'));
    return out;
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { parseMode: parseMode, parseApi: parseApi, parseConfig: parseConfig, isActive: isActive, moves: moves, readParams: readParams, pillOffset: pillOffset, faviconSvg: faviconSvg, CYCLE_MS: CYCLE_MS, MODES: MODES };
  if (typeof document === 'undefined') return;

  var html = document.documentElement;
  var memory = {};
  function get(key) {
    try {
      var v = window.localStorage.getItem(key);
      return v === null ? memory[key] || null : v;
    } catch (e) {
      return memory[key] || null;
    }
  }
  function set(key, value) {
    memory[key] = value;
    try {
      if (value === null || value === '') window.localStorage.removeItem(key);
      else window.localStorage.setItem(key, value);
    } catch (e) {
      /* blocked storage: the choice lasts for this page */
    }
  }

  var params = readParams(window.location.search);
  if (params.mode === 'site') set(MODE_KEY, null);
  else if (params.mode) set(MODE_KEY, params.mode);
  if (params.api === '') set(API_KEY, null);
  else if (params.api) set(API_KEY, params.api);
  if (params.touched) {
    var url = new URL(window.location.href);
    url.searchParams.delete('logo');
    url.searchParams.delete('logoApi');
    try {
      window.history.replaceState(window.history.state, '', url);
    } catch (e) {
      /* an address that cannot be rewritten stays as it is */
    }
  }

  var site = { mode: null, api: null };
  var polled = false;
  var lastNote = '';
  var timer = null;
  var controller = null;
  var onNote = null;

  /** This browser's own choice first, then the site's setting, then off. */
  function mode() {
    return parseMode(get(MODE_KEY)) || site.mode || 'off';
  }
  function endpoint() {
    return parseApi(get(API_KEY)) || site.api;
  }
  var pill = document.querySelector('.brand-mark .pill-blue');
  var windDown = null;
  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function cancelWindDown() {
    if (windDown) window.clearTimeout(windDown);
    windDown = null;
    if (pill) pill.removeEventListener('animationiteration', finishWindDown);
  }
  function finishWindDown() {
    cancelWindDown();
    if (html.getAttribute('data-dev-status') === 'ending') html.removeAttribute('data-dev-status');
  }
  /** Status went quiet mid-slide: let the current cycle finish (the pill ends each cycle at rest) instead of snapping it there. */
  function beginWindDown() {
    html.setAttribute('data-dev-status', 'ending');
    pill.addEventListener('animationiteration', finishWindDown);
    // A background tab may never run the next frame: do not stay "ending" for ever.
    windDown = window.setTimeout(finishWindDown, 10000);
  }
  function apply() {
    var active = moves(mode(), polled);
    var state = html.getAttribute('data-dev-status');
    if (active) {
      cancelWindDown();
      if (state !== 'active') html.setAttribute('data-dev-status', 'active');
    } else if (state === 'active' && pill && !reduced) {
      beginWindDown();
    } else if (state !== 'ending') {
      html.removeAttribute('data-dev-status');
    }
  }
  function note(text) {
    lastNote = text;
    if (onNote) onNote(text);
  }
  function stopPolling() {
    if (timer) window.clearTimeout(timer);
    timer = null;
    if (controller) controller.abort();
    controller = null;
  }
  function poll() {
    timer = null;
    if (mode() !== 'status') return;
    var api = endpoint();
    if (!api) {
      polled = false;
      apply();
      note('Set an endpoint address to follow development status.');
      return;
    }
    if (document.hidden) {
      timer = window.setTimeout(poll, POLL_MS);
      return;
    }
    controller = typeof AbortController === 'function' ? new AbortController() : null;
    var cut = window.setTimeout(function () {
      if (controller) controller.abort();
    }, TIMEOUT_MS);
    window
      .fetch(api, { method: 'GET', mode: 'cors', credentials: 'omit', cache: 'no-store', signal: controller ? controller.signal : undefined })
      .then(function (r) {
        return r.ok ? r.json() : null;
      })
      .then(function (body) {
        polled = isActive(body);
        note(body === null ? 'The endpoint did not answer as expected.' : body.available === true ? (polled ? 'Reachable: an agent is working.' : 'Reachable: idle.') : 'Reachable, but development status is not available there.');
      })
      .catch(function () {
        polled = false;
        note('The endpoint could not be reached.');
      })
      .then(function () {
        window.clearTimeout(cut);
        apply();
        if (mode() === 'status') timer = window.setTimeout(poll, POLL_MS);
      });
  }
  function restart() {
    stopPolling();
    polled = false;
    apply();
    if (mode() === 'status') poll();
  }

  // The tab icon moves with the logo: while the status is active or winding down, redraw it from the clock (5 frames a second; a
  // hidden tab throttles this, and because it is clock-based it is simply choppier, never wrong), then finish the cycle and put
  // the original icon back. Reduced motion: no animation here either.
  var iconLink = document.querySelector('link[rel~="icon"]');
  var iconOriginal = iconLink ? iconLink.getAttribute('href') : null;
  var iconTimer = null;
  var iconLast = null;
  function iconTick() {
    var dx = pillOffset(Date.now());
    var status = html.getAttribute('data-dev-status');
    if (!status && dx === 0) {
      window.clearInterval(iconTimer);
      iconTimer = null;
      iconLast = null;
      if (iconLink && iconOriginal !== null) iconLink.setAttribute('href', iconOriginal);
      return;
    }
    var rounded = Math.round(dx * 4) / 4;
    if (rounded === iconLast) return;
    iconLast = rounded;
    if (iconLink) iconLink.setAttribute('href', 'data:image/svg+xml,' + encodeURIComponent(faviconSvg(rounded)));
  }
  if (iconLink && iconOriginal !== null && !reduced && typeof MutationObserver === 'function') {
    new MutationObserver(function () {
      if (html.getAttribute('data-dev-status') && !iconTimer) {
        iconTimer = window.setInterval(iconTick, 200);
        iconTick();
      }
    }).observe(html, { attributes: true, attributeFilter: ['data-dev-status'] });
  }

  restart();
  // The site's own setting (logo.json, same origin). A missing or broken file is just "off": nothing here can fail loudly.
  var configUrl = document.currentScript && document.currentScript.getAttribute('data-config');
  if (configUrl && typeof window.fetch === 'function') {
    window
      .fetch(configUrl, { cache: 'no-store', credentials: 'same-origin' })
      .then(function (r) {
        return r.ok ? r.text() : '';
      })
      .then(function (text) {
        site = parseConfig(text);
        restart();
      })
      .catch(function () {});
  }
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && mode() === 'status' && !timer && !controller) poll();
  });
  window.addEventListener('storage', function (e) {
    if (e.key === MODE_KEY || e.key === API_KEY) restart();
  });

  if (params.config) {
    var panel = document.createElement('form');
    panel.className = 'logo-panel';
    panel.setAttribute('aria-label', 'Logo status settings');
    panel.innerHTML =
      '<h2>Logo</h2>' +
      '<label>Moves<select name="mode"><option value="site">Follow the site setting</option><option value="off">Never</option><option value="status">While development is active</option><option value="always">Always</option></select></label>' +
      '<label>Endpoint address<input name="api" type="url" placeholder="https://your-host/api/dev-status" autocomplete="off"></label>' +
      '<p class="logo-panel-note" role="status" aria-live="polite"></p>' +
      '<button type="submit">Save</button>';
    var sel = panel.querySelector('select');
    var input = panel.querySelector('input');
    var noteEl = panel.querySelector('.logo-panel-note');
    sel.value = parseMode(get(MODE_KEY)) || 'site';
    input.value = get(API_KEY) || '';
    onNote = function (text) {
      noteEl.textContent = text;
    };
    if (lastNote) noteEl.textContent = lastNote;
    panel.addEventListener('submit', function (e) {
      e.preventDefault();
      var api = input.value.trim() === '' ? '' : parseApi(input.value.trim());
      if (api === null) {
        noteEl.textContent = 'That address is not allowed: use https, or http on localhost.';
        return;
      }
      set(MODE_KEY, sel.value === 'site' ? null : sel.value);
      set(API_KEY, api === '' ? null : api);
      noteEl.textContent = 'Saved.';
      restart();
    });
    document.body.appendChild(panel);
  }
})();
