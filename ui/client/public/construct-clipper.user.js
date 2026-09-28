// ==UserScript==
// @name         Construct Clipper
// @namespace    https://construct.dev/clipper
// @version      0.1.0
// @description  Bridge (reads a login-only ticket with your own browser, fields only) and Picker (click to pick ticket fields, propose selectors to story.md). Deterministic, no AI, no whole-page mode.
// @author       Construct
// @match        http://localhost:3000/*
// @match        *://*/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_listValues
// @grant        GM_registerMenuCommand
// @grant        GM_addValueChangeListener
// @grant        unsafeWindow
// @run-at       document-idle
// ==/UserScript==

// #386 (part of #367, design doc docs/design/ia-five-screens.md section 9.7). Two independent roles in one
// file, both deterministic, no AI:
//
//   BRIDGE  -- only active on the Cockpit origin (COCKPIT_ORIGIN below). Listens for a same-window
//              postMessage handshake, fetches a login-only ticket page with the user's OWN cookies
//              (GM_xmlhttpRequest, never the server's), applies the story.md `parse` selectors natively
//              (querySelectorAll / document.evaluate) and returns ONLY the picked fields. Bounded by:
//              per-host approval (persisted per Cockpit origin, revocable from the menu), a rate limit
//              (10 reads/min), and a user-visible activity log. No credential, cookie or token ever
//              leaves this script.
//   PICKER  -- active on any other page. Click to pick key/title/description/acceptance/status; emits the
//              most stable selector (data-testid/id first, never a positional index) and hands the
//              proposal to the Bridge role (via GM storage, which Tampermonkey/Violentmonkey share across
//              tabs for one script) so the Cockpit can pick it up as a diff to story.md.
//
// Both roles are exercised in ui/e2e/tests/story-bridge.spec.js by injecting this file's IIFE body into a
// plain Chromium page via page.addInitScript, with small GM_* stubs standing in for the userscript manager
// (see the spec for exactly what is stubbed and why: same idea a browser extension gives for free, faked at
// the boundary so the deterministic logic below -- the part this issue ships -- is exercised for real).

(function constructClipper() {
  'use strict';

  // The one Cockpit origin this script serves. A userscript is configured for one Cockpit origin (design
  // 9.7's "Bounds"); change this line (or fork the script) to point at a self-hosted Cockpit. Kept as a
  // single, greppable constant rather than a setting UI -- there is no server this script talks to besides
  // the ticket host, so there is nowhere to store a setting except GM storage, and one wrong value here is a
  // worse failure mode (silently serving the wrong origin) than editing a line.
  const COCKPIT_ORIGIN = (typeof window !== 'undefined' && window.__CONSTRUCT_CLIPPER_COCKPIT_ORIGIN__) || 'http://localhost:3000';

  const RATE_LIMIT_PER_MINUTE = 10;
  const RATE_WINDOW_MS = 60 * 1000;
  const ACTIVITY_LOG_MAX = 200;
  const SELECTOR_MAX_LEN = 200;
  const MSG_REQUEST = 'construct-clipper:request';
  const MSG_RESPONSE = 'construct-clipper:response';

  const KEY_APPROVED_HOSTS = 'approvedHosts'; // { [cockpitOrigin]: { [host]: {approvedAt} } }
  const KEY_ACTIVITY_LOG = 'activityLog'; // [{time, host, url, ok, reason, fieldCount}]
  const KEY_RATE_BUCKET = 'rateBucket'; // { [host]: [timestamps] }
  const KEY_PENDING_PROPOSAL = 'pendingProposal'; // the Picker's latest proposal, read by the Bridge role

  // ---- GM storage helpers (JSON-boxed; every real userscript manager persists per-script, cross-tab, cross-page) ----
  const store = {
    get(key, fallback) {
      try {
        const raw = GM_getValue(key, undefined);
        return raw === undefined ? fallback : JSON.parse(raw);
      } catch {
        return fallback;
      }
    },
    set(key, value) {
      GM_setValue(key, JSON.stringify(value));
    },
  };

  // ============================================================ selectors: CSS and XPath (design 9.6b) ============

  /** Rejects anything that is not a plain node-set query: length cap, no javascript:/script pseudo-forms, no
   * XPath functions that reach outside the tree. Returns {ok:true} or {ok:false, error}. */
  function validateSelector(value) {
    if (value == null) return { ok: false, error: 'Selector is required.' };
    const isPlain = typeof value === 'string';
    const isBoxed = value && typeof value === 'object' && (typeof value.css === 'string' || typeof value.xpath === 'string');
    if (!isPlain && !isBoxed) return { ok: false, error: 'A selector must be a string (CSS) or {css} / {xpath}.' };
    const kind = isPlain ? 'css' : value.css != null ? 'css' : 'xpath';
    const text = isPlain ? value : value.css != null ? value.css : value.xpath;
    if (typeof text !== 'string' || !text.trim()) return { ok: false, error: 'Selector text is empty.' };
    if (text.length > SELECTOR_MAX_LEN) return { ok: false, error: `Selector is longer than ${SELECTOR_MAX_LEN} characters.` };
    if (/javascript\s*:/i.test(text)) return { ok: false, error: 'javascript: is not a valid selector.' };
    if (kind === 'xpath') {
      // node-set path only: no document(), no id()-style external functions.
      if (/\bdocument\s*\(/i.test(text) || /\bid\s*\(/i.test(text)) return { ok: false, error: 'That XPath reaches outside the page; only plain node-set paths are evaluated.' };
    }
    return { ok: true, kind, text };
  }

  /** querySelectorAll or document.evaluate over `doc`, never the live page's own document unless `doc` IS it. */
  function evalSelector(doc, selector) {
    const v = validateSelector(selector);
    if (!v.ok) return { ok: false, error: v.error };
    try {
      if (v.kind === 'css') {
        return { ok: true, nodes: Array.from(doc.querySelectorAll(v.text)) };
      }
      const result = doc.evaluate(v.text, doc, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
      const nodes = [];
      for (let i = 0; i < result.snapshotLength; i += 1) nodes.push(result.snapshotItem(i));
      return { ok: true, nodes };
    } catch (e) {
      return { ok: false, error: `Selector did not evaluate: ${e && e.message ? e.message : e}` };
    }
  }

  const textOf = (node) => (node && 'textContent' in node ? String(node.textContent || '').trim() : String(node));

  /** Applies a story.md `parse` map to a parsed document. Single-value fields (all but `acceptance`) error on
   * >1 match; `acceptance` takes every match in document order. Never throws: every field result carries its
   * own ok/matchCount/error so a partial template still returns what it found. */
  function applyParse(doc, parse) {
    const fields = {};
    for (const [name, selector] of Object.entries(parse || {})) {
      const r = evalSelector(doc, selector);
      if (!r.ok) {
        fields[name] = { ok: false, error: r.error, matchCount: 0 };
        continue;
      }
      if (name === 'acceptance') {
        fields[name] = { ok: true, matchCount: r.nodes.length, value: r.nodes.map(textOf) };
      } else if (r.nodes.length === 0) {
        fields[name] = { ok: false, error: 'Did not match: re-pick.', matchCount: 0 };
      } else if (r.nodes.length > 1) {
        fields[name] = { ok: false, error: `Matches ${r.nodes.length}, make it more specific.`, matchCount: r.nodes.length };
      } else {
        fields[name] = { ok: true, matchCount: 1, value: textOf(r.nodes[0]) };
      }
    }
    return fields;
  }

  /** The most stable selector for `el`: data-testid or id first, then the shortest CSS path (tag/class,
   * walking up to 2 more ancestors only while still ambiguous on the page), never nth-child/[n]. */
  function emitSelector(el) {
    if (!el || !el.getAttribute) return null;
    const testId = el.getAttribute('data-testid');
    if (testId) return { css: `[data-testid="${cssEscape(testId)}"]` };
    if (el.id) return { css: `#${cssEscape(el.id)}` };
    const doc = el.ownerDocument || (typeof document !== 'undefined' ? document : null);
    const parts = [];
    let node = el;
    let depth = 0;
    while (node && node.nodeType === 1 && depth < 3) {
      const tid = node.getAttribute && node.getAttribute('data-testid');
      const id = node.id;
      if (tid) { parts.unshift(`[data-testid="${cssEscape(tid)}"]`); break; }
      if (id) { parts.unshift(`#${cssEscape(id)}`); break; }
      const cls = (node.className && typeof node.className === 'string' ? node.className : '').trim().split(/\s+/).filter(Boolean)[0];
      parts.unshift(cls ? `${node.tagName.toLowerCase()}.${cssEscape(cls)}` : node.tagName.toLowerCase());
      const soFar = parts.join(' > ');
      try {
        if (doc && doc.querySelectorAll(soFar).length === 1) break;
      } catch { /* not a valid partial selector yet (shouldn't happen); keep climbing */ }
      node = node.parentElement;
      depth += 1;
    }
    return { css: parts.join(' > ') };
  }

  function cssEscape(s) {
    return String(s).replace(/["\\]/g, '\\$&');
  }

  // ============================================================ rate limit + activity log ============================

  function hostOf(urlStr) {
    try { return new URL(urlStr).host; } catch { return ''; }
  }

  /** true if this host may make one more read this minute; records the attempt either way so the log and
   * the limit agree on what happened. */
  function checkRateLimit(host) {
    const bucket = store.get(KEY_RATE_BUCKET, {});
    const now = Date.now();
    const recent = (bucket[host] || []).filter((t) => now - t < RATE_WINDOW_MS);
    if (recent.length >= RATE_LIMIT_PER_MINUTE) {
      bucket[host] = recent;
      store.set(KEY_RATE_BUCKET, bucket);
      return false;
    }
    recent.push(now);
    bucket[host] = recent;
    store.set(KEY_RATE_BUCKET, bucket);
    return true;
  }

  function logActivity(entry) {
    const log = store.get(KEY_ACTIVITY_LOG, []);
    log.push({ time: new Date().toISOString(), ...entry });
    while (log.length > ACTIVITY_LOG_MAX) log.shift();
    store.set(KEY_ACTIVITY_LOG, log);
  }

  // ============================================================ per-host approval ============================

  function isHostApproved(cockpitOrigin, host) {
    const all = store.get(KEY_APPROVED_HOSTS, {});
    return Boolean(all[cockpitOrigin] && all[cockpitOrigin][host]);
  }

  function approveHost(cockpitOrigin, host) {
    const all = store.get(KEY_APPROVED_HOSTS, {});
    all[cockpitOrigin] = all[cockpitOrigin] || {};
    all[cockpitOrigin][host] = { approvedAt: new Date().toISOString() };
    store.set(KEY_APPROVED_HOSTS, all);
  }

  function revokeHost(cockpitOrigin, host) {
    const all = store.get(KEY_APPROVED_HOSTS, {});
    if (all[cockpitOrigin]) delete all[cockpitOrigin][host];
    store.set(KEY_APPROVED_HOSTS, all);
  }

  // ============================================================ BRIDGE role ============================

  function nonceValid(nonce) {
    return typeof nonce === 'string' && nonce.length >= 16 && nonce.length <= 128;
  }

  /** Fetches `url` with the user's own cookies (GM_xmlhttpRequest, cross-origin, never through the server)
   * and resolves the response text, or rejects with a plain message. Swappable in tests via
   * window.__CONSTRUCT_CLIPPER_FETCH__ (see the e2e spec) -- production always goes through GM_xmlhttpRequest. */
  function gmFetch(url) {
    if (typeof window !== 'undefined' && typeof window.__CONSTRUCT_CLIPPER_FETCH__ === 'function') {
      return window.__CONSTRUCT_CLIPPER_FETCH__(url);
    }
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET',
        url,
        onload: (res) => (res.status >= 200 && res.status < 300 ? resolve(res.responseText) : reject(new Error(`Ticket host answered ${res.status}.`))),
        onerror: () => reject(new Error('Could not reach the ticket host.')),
        ontimeout: () => reject(new Error('Ticket host timed out.')),
        timeout: 10_000,
      });
    });
  }

  async function handleBridgeRequest({ requestId, nonce, url, parse }) {
    const host = hostOf(url);
    if (!host || !/^https:$/i.test(new URL(url).protocol)) {
      logActivity({ host, url, ok: false, reason: 'bad url' });
      return { ok: false, requestId, error: 'Only an https URL may be read.' };
    }
    if (!isHostApproved(COCKPIT_ORIGIN, host)) {
      logActivity({ host, url, ok: false, reason: 'host not approved' });
      return { ok: false, requestId, error: `Host not approved: ${host}. Allow this Cockpit from the userscript menu first.` };
    }
    if (!checkRateLimit(host)) {
      logActivity({ host, url, ok: false, reason: 'rate limited' });
      return { ok: false, requestId, error: 'Rate limit reached (10 reads per minute). Try again shortly.' };
    }
    let html;
    try {
      html = await gmFetch(url);
    } catch (e) {
      logActivity({ host, url, ok: false, reason: String(e && e.message ? e.message : e) });
      return { ok: false, requestId, error: e && e.message ? e.message : 'Fetch failed.' };
    }
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const fields = applyParse(doc, parse);
    const fieldCount = Object.values(fields).filter((f) => f.ok).length;
    logActivity({ host, url, ok: true, fieldCount });
    return { ok: true, requestId, fields };
  }

  function installBridge() {
    if (typeof window === 'undefined' || window.location.origin !== COCKPIT_ORIGIN) return;

    window.addEventListener('message', (event) => {
      // Bounds (design 9.7): only the same window, same origin as this page, a well-formed nonce, an
      // approved host and a request the Cockpit itself sent. Anything else is silently ignored, never
      // answered with page contents -- an XSS'd Cockpit page gets refusals, not data.
      if (event.source !== window) return;
      if (event.origin !== COCKPIT_ORIGIN) return;
      const data = event.data;
      if (!data || data.type !== MSG_REQUEST) return;
      const { requestId, nonce, url, parse } = data;
      if (!nonceValid(nonce)) {
        window.postMessage({ type: MSG_RESPONSE, requestId, ok: false, error: 'Bad nonce.' }, COCKPIT_ORIGIN);
        return;
      }
      if (typeof url !== 'string' || !parse || typeof parse !== 'object') {
        window.postMessage({ type: MSG_RESPONSE, requestId, ok: false, error: 'A url and parse selectors are required.' }, COCKPIT_ORIGIN);
        return;
      }
      handleBridgeRequest({ requestId, nonce, url, parse }).then((result) => {
        window.postMessage({ type: MSG_RESPONSE, ...result }, COCKPIT_ORIGIN);
      });
    });

    // Forward the Picker's latest proposal (written from a ticket tab, read here) as soon as this Cockpit
    // page is open. Tampermonkey/Violentmonkey deliver GM_addValueChangeListener across tabs for one script.
    if (typeof GM_addValueChangeListener === 'function') {
      GM_addValueChangeListener(KEY_PENDING_PROPOSAL, (_name, _old, newValue) => {
        try {
          const proposal = JSON.parse(newValue);
          window.postMessage({ type: 'construct-clipper:proposal', proposal }, COCKPIT_ORIGIN);
        } catch { /* malformed value: nothing to forward */ }
      });
    }

    if (typeof GM_registerMenuCommand === 'function') {
      GM_registerMenuCommand('Construct Clipper: allow this Cockpit to read a host…', () => {
        const host = window.prompt('Host to approve for this Cockpit (e.g. acme.atlassian.net):');
        if (host) approveHost(COCKPIT_ORIGIN, host.trim());
      });
      GM_registerMenuCommand('Construct Clipper: revoke a host…', () => {
        const host = window.prompt('Host to revoke:');
        if (host) revokeHost(COCKPIT_ORIGIN, host.trim());
      });
      GM_registerMenuCommand('Construct Clipper: show activity log', () => {
        const log = store.get(KEY_ACTIVITY_LOG, []);
        window.alert(log.slice(-20).map((e) => `${e.time} ${e.ok ? 'read' : 'refused'} ${e.host} ${e.url}${e.ok ? ` (${e.fieldCount} fields)` : ` — ${e.reason}`}`).join('\n') || 'No activity yet.');
      });
    }
  }

  // ============================================================ PICKER role ============================

  const PICKER_FIELDS = ['key', 'title', 'status', 'description', 'acceptance'];

  function installPicker() {
    if (typeof window === 'undefined' || window.location.origin === COCKPIT_ORIGIN) return;
    if (typeof GM_registerMenuCommand === 'function') {
      GM_registerMenuCommand('Construct Clipper: pick fields on this page', () => togglePickerUI(true));
    }
    if (window.__CONSTRUCT_CLIPPER_AUTOSTART_PICKER__) togglePickerUI(true);
  }

  let pickerState = null;

  function togglePickerUI(on) {
    if (!on) { pickerState = null; return; }
    pickerState = { picked: {}, activeField: null };
    window.__constructClipperPickerState = pickerState; // read by the e2e spec / a future in-page panel
  }

  /** Called with a field name ('key'|'title'|'status'|'description'|'acceptance') and the clicked element.
   * Public so both a real toolbar (not built here -- out of scope, see #386's "no w[...]" cut) and tests can
   * drive the Picker without simulating actual mouse events. */
  function pickField(fieldName, el) {
    if (!pickerState) togglePickerUI(true);
    if (!PICKER_FIELDS.includes(fieldName)) return { ok: false, error: `Unknown field: ${fieldName}` };
    const selector = emitSelector(el);
    if (!selector) return { ok: false, error: 'Could not derive a selector for that element.' };
    const evalResult = evalSelector(document, selector);
    const matchCount = evalResult.ok ? evalResult.nodes.length : 0;
    const preview = evalResult.ok ? evalResult.nodes.slice(0, 1).map(textOf)[0] : '';
    pickerState.picked[fieldName] = { selector, matchCount, preview };
    return { ok: true, selector, matchCount, preview };
  }

  /** The diff this Picker proposes to story.md: {url, parse}. Written to GM storage so the Bridge role
   * (running in whichever tab has the Cockpit open) can forward it, and returned directly for tests /
   * a synchronous caller. */
  function proposeSelectors() {
    if (!pickerState || Object.keys(pickerState.picked).length === 0) return { ok: false, error: 'Nothing picked yet.' };
    const parse = {};
    for (const [name, p] of Object.entries(pickerState.picked)) parse[name] = p.selector;
    const proposal = { url: window.location.href, parse, proposedAt: new Date().toISOString() };
    store.set(KEY_PENDING_PROPOSAL, proposal);
    return { ok: true, proposal };
  }

  // ============================================================ wiring ============================

  installBridge();
  installPicker();

  // Test-only hook (never present unless the harness sets the flag before this script runs): exposes the
  // pure, deterministic functions above so ui/e2e/tests/story-bridge.spec.js and a plain `node --test` can
  // exercise selector emission/validation, rate limiting and approval without a real userscript manager.
  if (typeof window !== 'undefined' && window.__CONSTRUCT_CLIPPER_TEST__) {
    window.__constructClipperCore = {
      validateSelector, evalSelector, applyParse, emitSelector,
      checkRateLimit, isHostApproved, approveHost, revokeHost,
      logActivity, getActivityLog: () => store.get(KEY_ACTIVITY_LOG, []),
      pickField, proposeSelectors, togglePickerUI,
      handleBridgeRequest, COCKPIT_ORIGIN,
    };
  }
})();
