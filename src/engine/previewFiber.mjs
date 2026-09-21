// Live preview v2 (#443): click-to-source by reading React's own dev-time
// internals from the running app, with NOTHING installed in the target app.
// Design note: docs/design/live-preview-v2.md.
//
// Two halves, both deterministic and both in this file so the payload contract
// has exactly one owner:
//
//  1. THE BRIDGE — `installPreviewFiberBridge(win, options)`, a plain function
//     with no closure over module scope so `previewFiberBridgeScript()` can
//     serialise it into the <script> a loopback proxy injects into the app's
//     HTML (and so tests can call it directly against a fake window). It reads
//     the fiber attached to a DOM node (`__reactFiber$<key>`, present in every
//     React 16+ build), collects whatever source evidence that React version
//     offers, and posts it to the Cockpit. It never evaluates a string, never
//     fetches, and sends only a capped, plain payload.
//
//  2. THE RESOLVER — `resolveFiberSelection(payload, context)`, a pure function
//     that turns such a payload into { file, line, column, componentName,
//     ancestors[] } relative to the project root. No clock, no network, no fs,
//     no LLM: same input, same output. Fetching source maps is I/O and belongs
//     to the caller (the Cockpit server), which is what keeps this testable
//     against payloads recorded from real dev builds.
//
// React 19 note (measured, see the design note): `_debugSource` no longer
// exists and `jsxDEV` drops the `__source` argument, so the evidence is an
// Error captured at element creation (`_debugStack`) in GENERATED coordinates.
// Mapping it back needs the served file's source map, which is why the
// resolver takes one and degrades visibly when it has none.

import path from 'node:path';

export const PREVIEW_FIBER_PROTOCOL = 'construct-preview/1';

/** The closed message vocabulary. Anything else is dropped by both halves. */
export const PREVIEW_FIBER_MESSAGES = Object.freeze({
  hello: 'construct:preview:hello',   // page -> Cockpit, once, with the nonce
  select: 'construct:preview:select', // page -> Cockpit, on click / Alt+click
  hover: 'construct:preview:hover',   // page -> Cockpit, throttled
  error: 'construct:preview:error',   // page -> Cockpit
  mode: 'construct:preview:mode',     // Cockpit -> page (pick on/off)
  highlight: 'construct:preview:highlight', // Cockpit -> page (by selection id)
  detach: 'construct:preview:detach', // Cockpit -> page
});

/** Payload caps (§5 of the design note). Exceeding one is reported, never truncated silently. */
export const PREVIEW_FIBER_LIMITS = Object.freeze({
  ancestors: 32,
  stackChars: 4096,
  payloadChars: 65536,
  props: 40,
  propValueChars: 120,
  domPath: 12,
});

// ---------------------------------------------------------------------------
// 1. The bridge (runs inside the previewed app)
// ---------------------------------------------------------------------------

/**
 * Install the in-page half. `options`: { parentOrigin, nonce, pick }.
 * Returns false when it is already installed, not embedded, or has no nonce.
 * Serialisable: everything it needs is defined inside it.
 */
export function installPreviewFiberBridge(win, options) {
  const opts = options || {};
  if (!opts.nonce || !opts.parentOrigin) return false;
  if (win.__constructPreviewFiber || win.parent === win) return false;
  win.__constructPreviewFiber = true;

  const LIMITS = { ancestors: 32, stackChars: 4096, payloadChars: 65536, props: 40, propValueChars: 120, domPath: 12 };
  const PROTOCOL = 'construct-preview/1';
  const NONCE = opts.nonce;
  const PARENT = opts.parentOrigin;

  let pick = !!opts.pick;
  let hovered = null;
  let hoverQueued = false;
  let nextId = 1;
  const byId = new Map(); // selection id -> element, capped; no selector is ever evaluated

  // A devtools-hook stub, only if nothing else claimed it. React reads this at
  // module scope, so it is useful only when we were injected before React ran;
  // it buys the root list and a commit signal, never source positions.
  try {
    if (typeof win.__REACT_DEVTOOLS_GLOBAL_HOOK__ === 'undefined') {
      win.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
        renderers: new Map(),
        supportsFiber: true,
        isDisabled: false,
        inject(renderer) { const id = this.renderers.size + 1; this.renderers.set(id, renderer); return id; },
        // Root list + commit signal (re-sync after HMR) are what the hook buys;
        // slice 3 subscribes here. It never yields source positions.
        onCommitFiberRoot() {},
        onCommitFiberUnmount() {},
        onPostCommitFiberRoot() {},
        checkDCE() {},
      };
    }
  } catch { /* a frozen window is not a reason to fail */ }

  function fiberOf(el) {
    if (!el) return null;
    // `__reactFiber$<randomKey>` is an OWN property react-dom attaches to every
    // host node (react-dom-client.development.js: internalInstanceKey), in every
    // build since React 16. No hook, no plugin, no app cooperation needed.
    for (const key of Object.keys(el)) {
      if (key.startsWith('__reactFiber$') || key.startsWith('__reactInternalInstance$')) return el[key];
    }
    return null;
  }

  function isComponent(type) {
    if (!type) return false;
    if (typeof type === 'function') return true;
    if (typeof type === 'object') {
      const t = type.$$typeof;
      return t === Symbol.for('react.forward_ref') || t === Symbol.for('react.memo');
    }
    return false;
  }

  function nameOf(fiber) {
    const type = fiber && fiber.type;
    if (!type || typeof type === 'string') return null;
    if (typeof type === 'function') return type.displayName || type.name || null;
    if (typeof type === 'object') {
      if (type.displayName) return type.displayName;
      if (type.render) return type.render.displayName || type.render.name || null;
      if (type.type) return type.type.displayName || type.type.name || null;
    }
    return null;
  }

  function stackOf(fiber) {
    try {
      const s = fiber && fiber._debugStack;
      const text = s && typeof s === 'object' ? s.stack : typeof s === 'string' ? s : null;
      return typeof text === 'string' ? text.slice(0, LIMITS.stackChars) : null;
    } catch { return null; }
  }

  function debugSourceOf(fiber) {
    const s = fiber && fiber._debugSource;
    if (!s || typeof s.fileName !== 'string') return null;
    return { fileName: s.fileName, lineNumber: s.lineNumber || null, columnNumber: s.columnNumber || null };
  }

  function safeProps(fiber) {
    const out = [];
    const props = fiber && fiber.memoizedProps;
    if (!props || typeof props !== 'object') return out;
    for (const name of Object.keys(props)) {
      if (out.length >= LIMITS.props) break;
      if (name === 'children') continue;
      const v = props[name];
      const t = v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v;
      // Never ship a graph: a prop is the likeliest place for a token or a DOM node.
      const value = t === 'string' || t === 'number' || t === 'boolean'
        ? String(v).slice(0, LIMITS.propValueChars)
        : null;
      out.push({ name, type: t, value });
    }
    return out;
  }

  function domPathOf(el) {
    const parts = [];
    let cur = el;
    while (cur && cur.nodeType === 1 && parts.length < LIMITS.domPath) {
      const parent = cur.parentElement;
      let index = 0;
      if (parent) {
        const kids = parent.children;
        for (let i = 0; i < kids.length; i++) { if (kids[i] === cur) { index = i; break; } }
      }
      parts.unshift({ tag: String(cur.tagName || '').toLowerCase(), index });
      cur = parent;
    }
    return parts;
  }

  function ancestorsOf(fiber) {
    const chain = [];
    let f = fiber && fiber.return;
    while (f && chain.length < LIMITS.ancestors) {
      if (isComponent(f.type)) {
        const name = nameOf(f);
        if (name) chain.push({ componentName: name, debugSource: debugSourceOf(f), stack: stackOf(f) });
      }
      f = f.return;
    }
    return chain;
  }

  function reactInfo(fiber) {
    let version = null;
    try { version = win.React && win.React.version ? String(win.React.version) : null; } catch { version = null; }
    return {
      version,
      hasDebugSource: !!(fiber && fiber._debugSource),
      hasDebugStack: !!(fiber && fiber._debugStack),
    };
  }

  function buildSelection(el) {
    const fiber = fiberOf(el);
    if (!fiber) return null;
    const id = nextId++;
    if (byId.size > 200) byId.clear();
    byId.set(id, el);
    const annotated = el.closest ? el.closest('[data-cx-src]') : null;
    return {
      id,
      protocol: PROTOCOL,
      tag: String(el.tagName || '').toLowerCase(),
      componentName: nameOf(fiber) || (function nearest(f) {
        let c = f && f.return;
        while (c) { if (isComponent(c.type)) { const n = nameOf(c); if (n) return n; } c = c.return; }
        return null;
      })(fiber),
      annotation: annotated && annotated.getAttribute ? annotated.getAttribute('data-cx-src') : null,
      debugSource: debugSourceOf(fiber),
      stack: stackOf(fiber),
      ancestors: ancestorsOf(fiber),
      props: safeProps(fiber),
      domPath: domPathOf(el),
      react: reactInfo(fiber),
    };
  }

  function post(type, body) {
    const message = Object.assign({ type, nonce: NONCE, protocol: PROTOCOL }, body);
    let text = '';
    try { text = JSON.stringify(message); } catch { text = ''; }
    if (!text || text.length > LIMITS.payloadChars) {
      win.parent.postMessage({ type: 'construct:preview:error', nonce: NONCE, protocol: PROTOCOL, reason: 'payload-too-large' }, PARENT);
      return;
    }
    win.parent.postMessage(message, PARENT);
  }

  function outline(el) {
    if (hovered === el) return;
    if (hovered) { try { hovered.style.outline = hovered.__cxOutline || ''; } catch { /* detached node */ } }
    hovered = el;
    if (el) { el.__cxOutline = el.style.outline; el.style.outline = '2px solid #7c5cff'; el.style.outlineOffset = '-2px'; }
  }

  function onMouseOver(e) {
    if (hoverQueued) return;
    hoverQueued = true;
    const target = e.target;
    const run = () => {
      hoverQueued = false;
      if (!pick) { outline(null); return; }
      if (!target || target.nodeType !== 1) return;
      outline(target);
      const fiber = fiberOf(target);
      post('construct:preview:hover', { componentName: fiber ? nameOf(fiber) : null, tag: String(target.tagName || '').toLowerCase() });
    };
    if (typeof win.requestAnimationFrame === 'function') win.requestAnimationFrame(run); else run();
  }

  function onMouseOut(e) {
    if (e.relatedTarget) return;
    outline(null);
  }

  function onClick(e) {
    if (!pick && !e.altKey) return; // Pick off: the app keeps its own clicks
    const target = e.target;
    if (!target || target.nodeType !== 1) return;
    const selection = buildSelection(target);
    if (!selection) { post('construct:preview:error', { reason: 'no-fiber' }); return; }
    e.preventDefault();
    e.stopPropagation();
    post('construct:preview:select', { selection });
  }

  function onKeyDown(e) {
    if (e.key === 'Escape' && pick) { pick = false; outline(null); post('construct:preview:hover', { componentName: null, tag: null }); }
  }

  function onMessage(e) {
    if (e.origin !== PARENT || e.source !== win.parent) return;
    const d = e.data;
    if (!d || d.nonce !== NONCE) return;
    if (d.type === 'construct:preview:mode') { pick = !!d.pick; if (!pick) outline(null); return; }
    if (d.type === 'construct:preview:highlight') { outline(byId.get(d.id) || null); return; }
    if (d.type === 'construct:preview:detach') {
      outline(null);
      win.document.removeEventListener('mouseover', onMouseOver, true);
      win.document.removeEventListener('mouseout', onMouseOut, true);
      win.document.removeEventListener('click', onClick, true);
      win.document.removeEventListener('keydown', onKeyDown, true);
      win.removeEventListener('message', onMessage);
      win.__constructPreviewFiber = false;
    }
  }

  win.document.addEventListener('mouseover', onMouseOver, true);
  win.document.addEventListener('mouseout', onMouseOut, true);
  win.document.addEventListener('click', onClick, true);
  win.document.addEventListener('keydown', onKeyDown, true);
  win.addEventListener('message', onMessage);
  post('construct:preview:hello', { capabilities: { pick: true, hover: true, highlight: true } });
  return true;
}

/**
 * The inline script a loopback proxy injects as the FIRST child of <head>
 * (before any app script, so the devtools-hook stub lands before React loads).
 * `options` must carry `{ parentOrigin, nonce }`; both are embedded as JSON,
 * never interpolated as code, and the page never evaluates a string.
 */
export function previewFiberBridgeScript(options) {
  const opts = options || {};
  if (!opts.nonce || !opts.parentOrigin) throw new Error('previewFiberBridgeScript: `nonce` and `parentOrigin` are required');
  const safe = { parentOrigin: String(opts.parentOrigin), nonce: String(opts.nonce), pick: !!opts.pick };
  // `<` is escaped so the script can never terminate the enclosing <script> tag.
  const json = JSON.stringify(safe).replace(/</g, '\\u003c');
  return `(${installPreviewFiberBridge.toString()})(window,${json});`;
}

// ---------------------------------------------------------------------------
// 2. The resolver (pure)
// ---------------------------------------------------------------------------

const POSITION_RE = /^(.*):(\d+):(\d+)$/;
const REACT_INTERNAL_RE = /(?:\/node_modules\/|react-dom|react-jsx-dev-runtime|react-jsx-runtime|react-stack-bottom-frame|react-stack-top-frame|@react-refresh|react-refresh|\breact\.development\b)/;

/**
 * Parse an Error.stack into frames. Handles V8 ("    at Foo (url:1:2)") and
 * SpiderMonkey/JSC ("Foo@url:1:2"). Frames that carry no position are dropped.
 * The location is cut out by structure, not by a URL regex, because bundler
 * URLs contain parentheses (`webpack-internal:///(app-pages-browser)/…`).
 * @returns {{ fn: string|null, url: string, line: number, column: number, raw: string }[]}
 */
export function parseStackFrames(stack) {
  if (typeof stack !== 'string' || !stack) return [];
  const frames = [];
  for (const rawLine of stack.split('\n')) {
    const line = rawLine.trim();
    if (!line || /^[A-Za-z]*Error\b/.test(line)) continue;
    let fn = null;
    let location = line.replace(/^at\s+/, '');
    const open = location.lastIndexOf(' (');
    if (open !== -1 && location.endsWith(')')) {
      fn = location.slice(0, open).trim() || null;
      location = location.slice(open + 2, -1);
    } else if (location.includes('@')) {
      const at = location.indexOf('@');
      fn = location.slice(0, at) || null;
      location = location.slice(at + 1);
    } else if (/^at\s/.test(line)) {
      fn = null;
    }
    const m = POSITION_RE.exec(location.trim());
    if (!m || !m[1]) continue;
    frames.push({ fn, url: m[1], line: Number(m[2]), column: Number(m[3]), raw: line });
  }
  return frames;
}

/**
 * The JSX call site is the first frame that is not React's own: `_debugStack`
 * is created inside `jsxDEV`, so frame 0 always belongs to the dev runtime.
 */
export function pickSourceFrame(frames) {
  for (const f of frames) if (!REACT_INTERNAL_RE.test(f.url) && !REACT_INTERNAL_RE.test(f.fn || '')) return f;
  return null;
}

// Bundler-specific prefixes seen in stack URLs and in source-map `sources`.
const URL_PREFIXES = [
  /^webpack-internal:\/\/\/(?:\([^)]*\)\/)?/,
  /^webpack:\/\/(?:\/|[^/]*\/)/,
  /^rsc:\/\/React\/[^/]+\//,
  /^turbopack:\/\/(?:\[[^\]]*\]\/)?/,
];

/**
 * Strip query/hash, decode %XX, drop the dev-server origin and the bundler
 * scheme. `urlish` says the reference came from something the dev SERVER
 * serves (so a leading "/" is server-relative), as opposed to a filesystem
 * path (where a leading "/" is the machine's root and must be inside the
 * project). Keeping the two apart is what stops "/etc/passwd" from being read
 * as the project-relative "etc/passwd".
 */
function cleanUrl(input) {
  let s = String(input == null ? '' : input).trim();
  if (!s) return { path: '', urlish: false };
  s = s.split('#')[0].split('?')[0];
  let urlish = false;
  for (const re of URL_PREFIXES) if (re.test(s)) { s = s.replace(re, ''); urlish = true; }
  const httpMatch = /^https?:\/\/[^/]+(\/.*)?$/.exec(s);
  if (httpMatch) { s = httpMatch[1] || '/'; urlish = true; }
  if (s.startsWith('file://')) { s = s.slice('file://'.length); urlish = false; }
  try { s = decodeURIComponent(s); } catch { /* keep the raw form */ }
  s = s.replace(/\\/g, '/');
  if (s.startsWith('/@fs/')) { s = s.slice('/@fs'.length); urlish = false; } // Vite's absolute-path escape hatch
  else if (s.startsWith('/@id/')) s = s.slice('/@id/'.length);
  return { path: s, urlish };
}

/**
 * Containment: turn whatever the page said into a path RELATIVE to the project
 * root, or null. Nothing the previewed app sends can make the Cockpit name a
 * file outside the open project — this is the block's most important property.
 *
 * `context.servedFrom` is the project-relative directory the dev server serves
 * from (a Vite `root`, a Next app in a monorepo package); URL-shaped references
 * are resolved under it.
 */
export function toProjectPath(input, context) {
  const projectRoot = context && context.projectRoot;
  if (typeof projectRoot !== 'string' || !projectRoot) throw new Error('toProjectPath: `projectRoot` is required');
  const { path: s, urlish } = cleanUrl(input);
  if (!s) return null;
  const root = projectRoot.replace(/\\/g, '/').replace(/\/+$/, '');
  const isAbsolute = s.startsWith('/') || /^[A-Za-z]:\//.test(s);

  let rel;
  if (isAbsolute && !urlish) {
    // A filesystem path: it must be inside the project, no second chance.
    const norm = path.posix.normalize(s);
    if (norm !== root && !norm.startsWith(root + '/')) return null;
    rel = norm.slice(root.length + 1);
  } else {
    // Server-relative or already relative. The leading "/" is dropped BEFORE
    // normalising, so "/../../etc/passwd" stays an escape instead of being
    // collapsed to "/etc/passwd" and then read as "etc/passwd".
    rel = path.posix.normalize(s.replace(/^\/+/, '').replace(/^\.\//, ''));
  }

  const servedFrom = context.servedFrom ? String(context.servedFrom).replace(/\\/g, '/').replace(/^\/+|\/+$/g, '') : '';
  if (servedFrom && urlish) rel = path.posix.normalize(`${servedFrom}/${rel}`);

  if (!rel || rel === '.' || rel === '/') return null;
  if (rel.startsWith('/') || rel.startsWith('../') || rel === '..' || /^[A-Za-z]:\//.test(rel)) return null;
  if (rel.split('/').includes('node_modules')) return null;
  if (rel.includes('\0')) return null;
  return rel;
}

/** Build output is not source: naming a chunk would be worse than saying "unmapped". */
const BUILD_OUTPUT = new Set(['_next', '.next', '.nuxt', '.svelte-kit', 'dist', 'build', 'out', '.vite', '.turbo', 'coverage']);

function looksLikeSource(rel) {
  if (!/\.[cm]?[jt]sx?$/.test(rel)) return false;
  return !rel.split('/').some((segment) => BUILD_OUTPUT.has(segment));
}

/** Base64 VLQ alphabet, as in the source-map spec. */
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Decode a source map's `mappings` string into per-generated-line segments. */
export function decodeMappings(mappings) {
  const lines = [];
  if (typeof mappings !== 'string') return lines;
  let sourceIndex = 0;
  let sourceLine = 0;
  let sourceColumn = 0;
  let nameIndex = 0;
  for (const chunk of mappings.split(';')) {
    const segments = [];
    let generatedColumn = 0;
    if (chunk) {
      for (const segment of chunk.split(',')) {
        if (!segment) continue;
        const values = [];
        let shift = 0;
        let value = 0;
        for (const char of segment) {
          const digit = B64.indexOf(char);
          if (digit < 0) { values.length = 0; break; }
          const more = digit & 32;
          value += (digit & 31) << shift;
          if (more) { shift += 5; continue; }
          const negative = value & 1;
          value >>= 1;
          values.push(negative ? -value : value);
          shift = 0;
          value = 0;
        }
        if (!values.length) continue;
        generatedColumn += values[0];
        if (values.length === 1) { segments.push({ generatedColumn, sourceIndex: null, sourceLine: null, sourceColumn: null, nameIndex: null }); continue; }
        sourceIndex += values[1];
        sourceLine += values[2];
        sourceColumn += values[3];
        if (values.length > 4) nameIndex += values[4];
        segments.push({ generatedColumn, sourceIndex, sourceLine, sourceColumn, nameIndex: values.length > 4 ? nameIndex : null });
      }
    }
    lines.push(segments);
  }
  return lines;
}

/**
 * Map a 1-based generated position to its original one.
 * @returns {{ source: string, line: number, column: number, name: string|null }|null}
 */
export function applySourceMap(map, line, column) {
  if (!map || typeof map !== 'object') return null;
  if (map.sections) return null; // index maps: not supported, reported as `unmapped`
  if (!Array.isArray(map.sources) || typeof map.mappings !== 'string') return null;
  const decoded = decodeMappings(map.mappings);
  const row = decoded[line - 1];
  if (!row || !row.length) return null;
  const target = Math.max(0, (column || 1) - 1);
  let best = null;
  for (const segment of row) {
    if (segment.sourceIndex === null) continue;
    if (segment.generatedColumn <= target) best = segment;
    else break; // segments are ordered by generated column
  }
  if (!best) { // before the first mapping on this line: the first one is the honest answer
    best = row.find((s) => s.sourceIndex !== null) || null;
    if (!best) return null;
  }
  const source = map.sources[best.sourceIndex];
  if (typeof source !== 'string') return null;
  const root = typeof map.sourceRoot === 'string' && map.sourceRoot ? map.sourceRoot.replace(/\/?$/, '/') : '';
  const names = Array.isArray(map.names) ? map.names : [];
  return {
    source: root && !/^[a-zA-Z][\w+.-]*:/.test(source) ? root + source.replace(/^\.?\//, '') : source,
    line: best.sourceLine + 1,
    column: best.sourceColumn + 1,
    name: best.nameIndex !== null && names[best.nameIndex] ? names[best.nameIndex] : null,
  };
}

/** Look a source map up by the frame URL, with and without its query string. */
function mapFor(sourceMaps, url) {
  if (!sourceMaps) return null;
  const get = typeof sourceMaps === 'function' ? sourceMaps : (u) => (Object.prototype.hasOwnProperty.call(sourceMaps, u) ? sourceMaps[u] : null);
  const bare = String(url).split('#')[0];
  return get(bare) || get(bare.split('?')[0]) || null;
}

/** Tier 1: the `data-cx-src="file:line:col"` attribute written by the v1 annotator. */
function fromAnnotation(annotation, context) {
  const m = /^(.*):(\d+):(\d+)$/.exec(String(annotation == null ? '' : annotation));
  if (!m) return null;
  const file = toProjectPath(m[1], context);
  return file ? { tier: 'annotation', confidence: 'exact', file, line: Number(m[2]), column: Number(m[3]) } : { tier: 'annotation', confidence: 'none', file: null, reason: 'outside-project' };
}

/** Tier 2: `fiber._debugSource` (React 16-18 dev builds). */
function fromDebugSource(debugSource, context) {
  if (!debugSource || typeof debugSource.fileName !== 'string') return null;
  const file = toProjectPath(debugSource.fileName, context);
  if (!file) return { tier: 'debug-source', confidence: 'none', file: null, reason: 'outside-project' };
  return {
    tier: 'debug-source',
    confidence: 'exact',
    file,
    line: Number(debugSource.lineNumber) || null,
    column: Number(debugSource.columnNumber) || null,
  };
}

/** Tier 3: `fiber._debugStack` (React 19) mapped through the served file's source map. */
function fromStack(stack, context) {
  const frame = pickSourceFrame(parseStackFrames(stack));
  if (!frame) return null;
  const map = mapFor(context.sourceMaps, frame.url);
  const mapped = map ? applySourceMap(map, frame.line, frame.column) : null;
  if (mapped) {
    const file = toProjectPath(mapped.source, context);
    if (file) return { tier: 'stack', confidence: 'mapped', file, line: mapped.line, column: mapped.column, frame };
    return { tier: 'stack', confidence: 'none', file: null, reason: 'outside-project', frame };
  }
  // No map: the served URL can still name the right FILE (Vite serves
  // /src/App.tsx, Next's eval modules are named webpack-internal:///./app/page.tsx),
  // but its line/column are positions in the transformed output, so they are
  // dropped rather than reported as if they were source positions.
  const file = toProjectPath(frame.url, context);
  if (file && looksLikeSource(file)) return { tier: 'stack', confidence: 'file-only', file, line: null, column: null, reason: 'unmapped-position', frame };
  return { tier: 'stack', confidence: 'none', file: null, reason: 'unmapped', frame };
}

function bestOf(evidence, context) {
  const ladder = [
    () => fromAnnotation(evidence.annotation, context),
    () => fromDebugSource(evidence.debugSource, context),
    () => fromStack(evidence.stack, context),
  ];
  let fallback = null;
  for (const step of ladder) {
    const hit = step();
    if (!hit) continue;
    if (hit.file) return hit;
    if (!fallback) fallback = hit; // remember why the tier failed, keep trying
  }
  return fallback;
}

/** True when the payload looks like a production build rather than a dev one. */
function looksMinified(selection) {
  const react = selection.react || {};
  if (react.hasDebugSource || react.hasDebugStack) return false;
  if (selection.annotation) return false;
  const names = [selection.componentName, ...(selection.ancestors || []).map((a) => a.componentName)].filter(Boolean);
  return names.length > 0 && names.every((n) => n.length <= 2);
}

/**
 * Turn a bridge selection payload into a source location, project-root-relative.
 *
 * @param {object} payload   the `construct:preview:select` message, or its `selection`
 * @param {{ projectRoot: string, sourceMaps?: object|Function }} context
 * @returns {{ ok: boolean, tier: string|null, confidence: string, file: string|null,
 *             line: number|null, column: number|null, componentName: string|null,
 *             ancestors: object[], domPath: object[], reason: string|null }}
 */
export function resolveFiberSelection(payload, context) {
  const ctx = context || {};
  if (typeof ctx.projectRoot !== 'string' || !ctx.projectRoot) throw new Error('resolveFiberSelection: `projectRoot` is required');
  const selection = payload && payload.selection ? payload.selection : payload;
  const miss = (reason, extra) => Object.assign({
    ok: false, tier: null, confidence: 'none', file: null, line: null, column: null,
    componentName: (selection && selection.componentName) || null, ancestors: [], domPath: [], reason,
  }, extra || {});

  if (!selection || typeof selection !== 'object') return miss('invalid-payload');
  if (selection.protocol && selection.protocol !== PREVIEW_FIBER_PROTOCOL) return miss('protocol-mismatch');

  const rawAncestors = Array.isArray(selection.ancestors) ? selection.ancestors.slice(0, PREVIEW_FIBER_LIMITS.ancestors) : [];
  const ancestors = rawAncestors.map((a) => {
    const hit = bestOf({ annotation: null, debugSource: a && a.debugSource, stack: a && a.stack }, ctx);
    return {
      componentName: (a && a.componentName) || null,
      file: hit && hit.file ? hit.file : null,
      line: hit && hit.file ? (hit.line ?? null) : null,
      column: hit && hit.file ? (hit.column ?? null) : null,
      tier: hit ? hit.tier : null,
    };
  });

  const domPath = Array.isArray(selection.domPath) ? selection.domPath.slice(0, PREVIEW_FIBER_LIMITS.domPath) : [];
  const componentName = selection.componentName || null;
  const hit = bestOf({ annotation: selection.annotation, debugSource: selection.debugSource, stack: selection.stack }, ctx);

  if (hit && hit.file) {
    return {
      ok: true,
      tier: hit.tier,
      confidence: hit.confidence,
      file: hit.file,
      line: hit.line ?? null,
      column: hit.column ?? null,
      componentName,
      ancestors,
      domPath,
      reason: hit.reason || null,
    };
  }

  // Tier 4: component identity only. Honest, and still useful — the tree can
  // select the component node; the UI says the position is unavailable.
  const reason = hit && hit.reason ? hit.reason : looksMinified(selection) ? 'minified' : 'no-evidence';
  return {
    ok: false,
    tier: componentName || ancestors.length ? 'component' : null,
    confidence: 'none',
    file: null,
    line: null,
    column: null,
    componentName,
    ancestors,
    domPath,
    reason,
  };
}
