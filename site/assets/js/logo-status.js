/* The docs logo as a status light. Its pills move ONLY while `<html data-dev-status="active">`, and this script decides that from a
 * mode the owner sets:
 *   off     (default) never moves: this is what every visitor sees
 *   always  moves all the time
 *   status  moves while the endpoint the owner configured says an agent or model is working on the framework
 * Two places set it, the browser's own setting first:
 *   1. this browser (localStorage), set by link or with the small panel `?logo=config` opens:
 *        ?logo=off|always|status   the mode          ?logoApi=https://host/api/dev-status   the endpoint (?logoApi= clears it)
 *        ?logo=site                follow the site's setting again          ?logo=config   opens the panel
 *   2. the site's own setting, `logo.json` next to the pages, which the owner edits on GitHub (Trinity links there); a commit
 *      redeploys the docs:  { "mode": "status", "api": "https://host/api/dev-status", "motion": { ...Logo Lab JSON... } }
 *      It is public like the rest of the site, so put in `api` only an address you are happy to publish; with no `api` there, only a
 *      browser that set its own endpoint polls.
 * WHAT MOVES is the `motion`: the JSON the Logo Lab (Claude Artifact) exports for the Line mark (parts, effect, distance, axis,
 * durationSeconds, restBeforePct, restAfterPct, holdPct, beats, easing, staggerPct, direction). One small engine turns it into the
 * CSS keyframes, the tab icon frames and the "finish the cycle" wind-down, so they can never disagree. This browser's own motion
 * (pasted into the panel) wins over the site's, and the site's over the built-in default below.
 * A visitor with none of this makes no request (mode off is the default). The endpoint is read with a plain GET, no cookies, a 2 s
 * timeout, every 5 s, only while the tab is visible. Plain script, no libraries, works with storage blocked. */
(function () {
  'use strict';
  var MODE_KEY = 'construct.docs.logo';
  var API_KEY = 'construct.docs.logo.api';
  var MOTION_KEY = 'construct.docs.logo.motion';
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

  // ---- the motion engine (the Logo Lab's, for the Line mark): (settings, time) -> where each pill is -----------------------------

  var PILLS = ['white', 'blue'];
  var CENTER = { white: [18, 15.5], blue: [30, 32.5] };
  var PARTNER = { white: 'blue', blue: 'white' };
  var AXIS = { x: [1, 0], y: [0, 1], diag: [1, 17 / 12] };
  var ID = { x: 0, y: 0, s: 1, o: 1 };

  /** The built-in motion: the two pills move toward each other until they share one column, hold, and part again (6.6 s). */
  var DEFAULT_MOTION_JSON = {
    preset: 'Handshake (docs default)',
    mark: 'line',
    parts: { white: 'pos', blue: 'neg' },
    effect: 'slide',
    distance: 6,
    axis: 'x',
    durationSeconds: 6.6,
    restBeforePct: 0,
    restAfterPct: 34,
    holdPct: 28,
    beats: 1,
    easing: { type: 'ease-in-out' },
    staggerPct: 0,
    direction: 'out-and-back',
  };

  function num(v, min, max, fallback) {
    var n = typeof v === 'number' && isFinite(v) ? v : fallback;
    return Math.min(max, Math.max(min, n));
  }

  /** The Logo Lab's JSON (object or text) as engine settings, clamped to the Lab's own ranges; `null` when it is not a Line motion
   * that moves something. Never throws. */
  function parseMotion(data) {
    if (typeof data === 'string') {
      try {
        data = JSON.parse(data);
      } catch (e) {
        return null;
      }
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
    if (data.mark !== undefined && data.mark !== 'line') return null;
    var parts = {};
    var any = false;
    PILLS.forEach(function (p) {
      var m = data.parts && data.parts[p];
      parts[p] = m === 'pos' || m === 'neg' ? m : 'still';
      if (parts[p] !== 'still') any = true;
    });
    if (!any) return null;
    var e = data.easing && typeof data.easing === 'object' ? data.easing : { type: 'ease-in-out' };
    var ease = 'io';
    if (e.type === 'linear') ease = 'linear';
    else if (e.type === 'ease-out') ease = 'out';
    else if (e.type === 'steps') ease = 'steps:' + Math.round(num(e.count, 1, 20, 6));
    else if (e.type === 'cubic-bezier' && Array.isArray(e.points) && e.points.length === 4) {
      ease = 'bez:' + [num(e.points[0], 0, 1, 0.42), num(e.points[1], -2, 3, 0), num(e.points[2], 0, 1, 0.58), num(e.points[3], -2, 3, 1)].join(',');
    }
    return {
      fx: ['slide', 'scale', 'fade', 'pulse', 'orbit'].indexOf(data.effect) >= 0 ? data.effect : 'slide',
      axis: ['x', 'y', 'diag'].indexOf(data.axis) >= 0 ? data.axis : 'x',
      parts: parts,
      distance: num(data.distance, 0, 30, 12),
      duration: num(data.durationSeconds, 0.3, 20, 4),
      rb: num(data.restBeforePct, 0, 90, 0),
      ra: num(data.restAfterPct, 0, 90, 0),
      hold: num(data.holdPct, 0, 100, 0),
      beats: Math.round(num(data.beats, 1, 4, 1)),
      ease: ease,
      stagger: num(data.staggerPct, 0, 50, 0),
      dir: data.direction === 'loop-one-way' ? 'loop' : 'pingpong',
    };
  }

  var easeCache = {};
  function bez(x1, y1, x2, y2) {
    function cx(t) {
      var m = 1 - t;
      return 3 * m * m * t * x1 + 3 * m * t * t * x2 + t * t * t;
    }
    function cy(t) {
      var m = 1 - t;
      return 3 * m * m * t * y1 + 3 * m * t * t * y2 + t * t * t;
    }
    return function (u) {
      if (u <= 0) return 0;
      if (u >= 1) return 1;
      var lo = 0;
      var hi = 1;
      var t = u;
      for (var i = 0; i < 28; i += 1) {
        var x = cx(t);
        if (Math.abs(x - u) < 1e-5) break;
        if (x < u) lo = t;
        else hi = t;
        t = (lo + hi) / 2;
      }
      return cy(t);
    };
  }
  function easeFn(str) {
    if (easeCache[str]) return easeCache[str];
    var f;
    if (str === 'linear') {
      f = function (u) {
        return u;
      };
    } else if (str === 'io') f = bez(0.42, 0, 0.58, 1);
    else if (str === 'out') f = bez(0, 0, 0.58, 1);
    else if (str.indexOf('steps:') === 0) {
      var n = Math.max(1, parseInt(str.slice(6), 10) || 1);
      f = function (u) {
        return u >= 1 ? 1 : Math.floor(u * n) / n;
      };
    } else {
      var b = str.slice(4).split(',').map(Number);
      f = bez(b[0], b[1], b[2], b[3]);
    }
    easeCache[str] = f;
    return f;
  }
  function easeCss(e) {
    if (e === 'linear') return 'linear';
    if (e === 'io') return 'ease-in-out';
    if (e === 'out') return 'ease-out';
    if (e.indexOf('steps:') === 0) return 'steps(' + e.slice(6) + ', end)';
    return 'cubic-bezier(' + e.slice(4).split(',').map(function (n) { return +(+n).toFixed(3); }).join(', ') + ')';
  }

  function orbitShape(S, p) {
    var q = PARTNER[p];
    if (!q) return null;
    var r0x = CENTER[p][0] - CENTER[q][0];
    var r0y = CENTER[p][1] - CENTER[q][1];
    var k = Math.pow(2, 0.25) * Math.max(0.05, S.distance / 12);
    var a = Math.abs(r0x) * k;
    var b = Math.abs(r0y) * k;
    var c = Math.sign(r0x) * Math.pow(Math.abs(r0x) / a, 2);
    var s = Math.sign(r0y) * Math.pow(Math.abs(r0y) / b, 2);
    return { a: a, b: b, t0: Math.atan2(s, c) };
  }
  function opos(sh, th) {
    var c = Math.cos(th);
    var s = Math.sin(th);
    return [sh.a * Math.sign(c) * Math.sqrt(Math.abs(c)), sh.b * Math.sign(s) * Math.sqrt(Math.abs(s))];
  }
  /** Where a pill is, for progress `pp` (0 = rest, 1 = furthest), moving in direction `sign`. */
  function effectAt(S, p, sign, pp) {
    var d = S.distance;
    var v;
    switch (S.fx) {
      case 'slide':
        v = AXIS[S.axis];
        return { x: v[0] * d * sign * pp, y: v[1] * d * sign * pp, s: 1, o: 1 };
      case 'scale':
        return { x: 0, y: 0, s: Math.max(0.05, 1 + sign * d * 0.03 * pp), o: 1 };
      case 'fade':
        return { x: 0, y: 0, s: 1, o: 1 - Math.min(0.9, d * 0.06) * pp };
      case 'pulse':
        return { x: 0, y: 0, s: Math.max(0.05, 1 + sign * d * 0.03 * pp), o: 1 - Math.min(0.9, d * 0.06) * pp };
      case 'orbit':
        var sh = orbitShape(S, p);
        if (!sh) return ID;
        var a = opos(sh, sh.t0);
        var b = opos(sh, sh.t0 + sign * Math.PI * 2 * pp);
        return { x: b[0] - a[0], y: b[1] - a[1], s: 1, o: 1 };
    }
    return ID;
  }

  /** The keyframes of each moving pill (percent of the cycle -> position, and the easing that follows). */
  function frames(S) {
    if (S._frames) return S._frames;
    var F = {};
    var rb = S.rb;
    var W = Math.max(2, 100 - rb - S.ra);
    var beats = S.beats;
    var c = W / beats;
    var hold = Math.max(0, Math.min(S.hold, W - 2 * beats));
    var hb = hold / beats;
    var ef = easeFn(S.ease);
    PILLS.forEach(function (p) {
      var mode = S.parts[p];
      if (mode !== 'pos' && mode !== 'neg') return;
      var sign = mode === 'neg' ? -1 : 1;
      var pts = [];
      var add = function (t, pp) {
        var l = pts[pts.length - 1];
        if (l && Math.abs(l.t - t) < 0.005 && l.p === pp) return;
        pts.push({ t: +t.toFixed(3), p: pp });
      };
      add(0, 0);
      if (rb > 0) add(rb, 0);
      for (var b = 0; b < beats; b += 1) {
        var s0 = rb + b * c;
        add(s0, 0);
        if (S.dir === 'loop') {
          add(hb > 0 ? s0 + c - hb : s0 + c - 0.01, 1);
          if (hb > 0) add(s0 + c - 0.01, 1);
        } else {
          var m = (c - hb) / 2;
          add(s0 + m, 1);
          if (hb > 0) add(s0 + m + hb, 1);
          add(s0 + c, 0);
        }
      }
      add(rb + W, 0);
      add(100, 0);
      var out = [];
      for (var i = 0; i < pts.length; i += 1) {
        var a = pts[i];
        var n = pts[i + 1];
        var v = effectAt(S, p, sign, a.p);
        out.push({ t: a.t, x: v.x, y: v.y, s: v.s, o: v.o, e: S.fx === 'orbit' ? 'linear' : S.ease });
        if (n && S.fx === 'orbit' && a.p !== n.p && n.t - a.t > 0.05) {
          for (var j = 1; j < 40; j += 1) {
            var u = j / 40;
            var w = effectAt(S, p, sign, a.p + (n.p - a.p) * ef(u));
            out.push({ t: +(a.t + (n.t - a.t) * u).toFixed(3), x: w.x, y: w.y, s: w.s, o: w.o, e: 'linear' });
          }
        }
      }
      F[p] = out;
    });
    S._frames = F;
    return F;
  }
  function sample(fr, ph) {
    var t = ph * 100;
    var hi = fr.length - 1;
    if (t >= fr[hi].t) return fr[hi];
    if (t <= fr[0].t) return fr[0];
    var lo = 0;
    while (hi - lo > 1) {
      var mid = (lo + hi) >> 1;
      if (fr[mid].t <= t) lo = mid;
      else hi = mid;
    }
    var a = fr[lo];
    var b = fr[hi];
    var e = easeFn(a.e)(b.t === a.t ? 1 : (t - a.t) / (b.t - a.t));
    return { x: a.x + (b.x - a.x) * e, y: a.y + (b.y - a.y) * e, s: a.s + (b.s - a.s) * e, o: a.o + (b.o - a.o) * e };
  }
  /** Each moving pill's start delay within the cycle, in ms (the stagger). */
  function offsets(S) {
    var F = frames(S);
    var cycle = S.duration * 1000;
    var k = 0;
    var o = {};
    PILLS.forEach(function (p) {
      if (F[p]) {
        o[p] = (k * S.stagger / 100) * cycle;
        k += 1;
      }
    });
    return o;
  }
  /** Where both pills are `tMs` into the clock (any time; the loop wraps). */
  function motionAt(S, tMs) {
    var F = frames(S);
    var cycle = S.duration * 1000;
    var off = offsets(S);
    var out = { white: ID, blue: ID };
    PILLS.forEach(function (p) {
      if (!F[p]) return;
      var ph = ((((tMs - off[p]) % cycle) + cycle) % cycle) / cycle;
      out[p] = sample(F[p], ph);
    });
    return out;
  }
  /** Are both pills exactly at their resting place? A stopping tab icon waits for this so it never freezes mid-move. */
  function atRest(vals) {
    return PILLS.every(function (p) {
      var v = vals[p];
      return v.x === 0 && v.y === 0 && v.s === 1 && v.o === 1;
    });
  }

  function r3(n) {
    return +(+n).toFixed(3);
  }
  /** The CSS that plays the motion on the header logo's pills while the status is active (or winding down). */
  function motionCss(S) {
    var F = frames(S);
    var off = offsets(S);
    var out = '';
    PILLS.forEach(function (p) {
      var fr = F[p];
      if (!fr) return;
      var hasS = fr.some(function (f) { return f.s !== 1; });
      var hasO = fr.some(function (f) { return f.o !== 1; });
      var sel = "html[data-dev-status='active'] .brand-mark .pill-" + p + ", html[data-dev-status='ending'] .brand-mark .pill-" + p;
      out += '.brand-mark .pill-' + p + ' { transform-box: fill-box; transform-origin: center; }\n';
      out += sel + ' { animation: logo-' + p + ' ' + r3(S.duration) + 's infinite;' + (off[p] ? ' animation-delay: ' + r3(off[p] / 1000) + 's;' : '') + ' }\n';
      out += '@keyframes logo-' + p + ' {\n';
      var groups = [];
      fr.forEach(function (f) {
        var body = 'transform: translate(' + r3(f.x) + 'px, ' + r3(f.y) + 'px)' + (hasS ? ' scale(' + r3(f.s) + ')' : '') + ';' + (hasO ? ' opacity: ' + r3(f.o) + ';' : '') + ' animation-timing-function: ' + easeCss(f.e) + ';';
        var g = groups[groups.length - 1];
        if (g && g.body === body) g.ts.push(f.t);
        else groups.push({ body: body, ts: [f.t] });
      });
      groups.forEach(function (g) {
        out += '  ' + g.ts.map(function (t) { return r3(t) + '%'; }).join(', ') + ' { ' + g.body + ' }\n';
      });
      out += '}\n';
    });
    return out;
  }

  function pillAttrs(p, v) {
    var c = CENTER[p];
    var t = '';
    if (v.s === 1) {
      if (v.x !== 0 || v.y !== 0) t = ' transform="translate(' + r3(v.x) + ' ' + r3(v.y) + ')"';
    } else {
      t = ' transform="matrix(' + r3(v.s) + ' 0 0 ' + r3(v.s) + ' ' + r3(v.x + c[0] - v.s * c[0]) + ' ' + r3(v.y + c[1] - v.s * c[1]) + ')"';
    }
    return t + (v.o === 1 ? '' : ' opacity="' + r3(v.o) + '"');
  }
  /** The Line mark as the tab icon with the pills where `vals` says (with nothing moved it is exactly the static icon in every page). */
  function faviconSvg(vals) {
    var v = vals || { white: ID, blue: ID };
    return (
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><style>:root{--i:#0d0f12}@media (prefers-color-scheme:dark){:root{--i:#f2f4f7}}</style>' +
      '<defs><linearGradient id="g" gradientUnits="userSpaceOnUse" x1="4" y1="4" x2="44" y2="44"><stop offset="0" stop-color="#8fb0ff"/><stop offset="1" stop-color="#4b63f5"/></linearGradient></defs>' +
      '<rect x="4" y="10" width="28" height="11" rx="5.5" fill="var(--i)"' + pillAttrs('white', v.white) + '/>' +
      '<rect x="16" y="27" width="28" height="11" rx="5.5" fill="none" stroke="url(#g)" stroke-width="2.8"' + pillAttrs('blue', v.blue) + '/></svg>'
    );
  }

  // ---- settings ---------------------------------------------------------------------------------------------------------------

  /** The site's own setting: `{ mode, api, motion }`, each `null` when missing or not allowed. Never throws. */
  function parseConfig(text) {
    var none = { mode: null, api: null, motion: null };
    var data;
    try {
      data = typeof text === 'string' ? JSON.parse(text) : text;
    } catch (e) {
      return none;
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) return none;
    return { mode: parseMode(data.mode), api: parseApi(data.api), motion: parseMotion(data.motion) };
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

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      parseMode: parseMode, parseApi: parseApi, parseConfig: parseConfig, parseMotion: parseMotion, isActive: isActive, moves: moves, readParams: readParams,
      motionAt: motionAt, motionCss: motionCss, atRest: atRest, faviconSvg: faviconSvg, offsets: offsets, DEFAULT_MOTION_JSON: DEFAULT_MOTION_JSON, MODES: MODES,
    };
  }
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

  var site = { mode: null, api: null, motion: null };
  var builtIn = parseMotion(DEFAULT_MOTION_JSON);
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
  /** What moves: this browser's own motion, else the site's, else the built-in one. */
  function motion() {
    return parseMotion(get(MOTION_KEY)) || site.motion || builtIn;
  }

  var styleEl = null;
  var windUpon = null;
  /** Put the motion's keyframes in the page, and pick the pill whose cycle end marks "finished" (the one that starts last). */
  function installMotion() {
    var S = motion();
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = 'logo-motion';
      document.head.appendChild(styleEl);
    }
    styleEl.textContent = motionCss(S);
    var off = offsets(S);
    var last = null;
    PILLS.forEach(function (p) {
      if (off[p] !== undefined && (last === null || off[p] >= off[last])) last = p;
    });
    var el = last ? document.querySelector('.brand-mark .pill-' + last) : null;
    if (windUpon && windUpon !== el) windUpon.removeEventListener('animationiteration', finishWindDown);
    windUpon = el;
  }

  var windDown = null;
  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function cancelWindDown() {
    if (windDown) window.clearTimeout(windDown);
    windDown = null;
    if (windUpon) windUpon.removeEventListener('animationiteration', finishWindDown);
  }
  function finishWindDown() {
    cancelWindDown();
    if (html.getAttribute('data-dev-status') === 'ending') html.removeAttribute('data-dev-status');
  }
  /** Status went quiet mid-move: let the current cycle finish (each cycle ends at rest) instead of snapping the pills there. */
  function beginWindDown() {
    html.setAttribute('data-dev-status', 'ending');
    windUpon.addEventListener('animationiteration', finishWindDown);
    // A background tab may never run the next frame: do not stay "ending" for ever.
    windDown = window.setTimeout(finishWindDown, Math.max(10000, motion().duration * 1000 + 2000));
  }
  function apply() {
    var active = moves(mode(), polled);
    var state = html.getAttribute('data-dev-status');
    if (active) {
      cancelWindDown();
      if (state !== 'active') html.setAttribute('data-dev-status', 'active');
    } else if (state === 'active' && windUpon && !reduced) {
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
    installMotion();
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
    var vals = motionAt(motion(), Date.now());
    var status = html.getAttribute('data-dev-status');
    if (!status && atRest(vals)) {
      window.clearInterval(iconTimer);
      iconTimer = null;
      iconLast = null;
      if (iconLink && iconOriginal !== null) iconLink.setAttribute('href', iconOriginal);
      return;
    }
    var svg = faviconSvg(vals);
    if (svg === iconLast) return;
    iconLast = svg;
    if (iconLink) iconLink.setAttribute('href', 'data:image/svg+xml,' + encodeURIComponent(svg));
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
    if (e.key === MODE_KEY || e.key === API_KEY || e.key === MOTION_KEY) restart();
  });

  if (params.config) {
    var panel = document.createElement('form');
    panel.className = 'logo-panel';
    panel.setAttribute('aria-label', 'Logo status settings');
    panel.innerHTML =
      '<h2>Logo</h2>' +
      '<label>Moves<select name="mode"><option value="site">Follow the site setting</option><option value="off">Never</option><option value="status">While development is active</option><option value="always">Always</option></select></label>' +
      '<label>Endpoint address<input name="api" type="url" placeholder="https://your-host/api/dev-status" autocomplete="off"></label>' +
      '<label>Motion, pasted from the Logo Lab (this browser only; empty follows the site)<textarea name="motion" rows="5" spellcheck="false" placeholder="{ &quot;mark&quot;: &quot;line&quot;, &quot;parts&quot;: { ... } }"></textarea></label>' +
      '<p class="logo-panel-note" role="status" aria-live="polite"></p>' +
      '<button type="submit">Save</button>';
    var sel = panel.querySelector('select');
    var input = panel.querySelector('input');
    var area = panel.querySelector('textarea');
    var noteEl = panel.querySelector('.logo-panel-note');
    sel.value = parseMode(get(MODE_KEY)) || 'site';
    input.value = get(API_KEY) || '';
    area.value = get(MOTION_KEY) || '';
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
      var raw = area.value.trim();
      if (raw !== '' && parseMotion(raw) === null) {
        noteEl.textContent = 'That is not a Line motion: paste the JSON from the Logo Lab (mark "line", at least one pill moving).';
        return;
      }
      set(MODE_KEY, sel.value === 'site' ? null : sel.value);
      set(API_KEY, api === '' ? null : api);
      set(MOTION_KEY, raw === '' ? null : raw);
      noteEl.textContent = 'Saved.';
      restart();
    });
    document.body.appendChild(panel);
  }
})();
