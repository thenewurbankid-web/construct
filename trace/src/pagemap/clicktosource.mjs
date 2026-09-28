// Rendered click-to-source: given a DOM element in a RUNNING preview, resolve it back to the custom-component call site
// (the `<Foo .../>` that produced it), not just the host tag it happens to render as.
//
// Construct's `jsxSourceAnnotator` (already used by the Page map, see ../construct.mjs importConstructAnnotator) maps
// the OTHER direction: source position -> a `data-cx-src` attribute stamped on every HOST element, in that element's OWN
// file. It deliberately skips custom components ("the host elements they render are annotated in their own files"), so
// a `<div>` deep inside `<Foo/>`'s own render carries Foo's file, never the position in the PARENT file where `<Foo/>`
// itself was written. Getting THAT position needs the fiber tree: React attaches `_debugSource` to the fiber of every
// element it creates in dev builds, and that source is the position of the JSX call that made it -- so the fiber whose
// `type` is the component `Foo`, reached by walking `.return` from the clicked node, carries Foo's OWN call site.
//
// Construct already has this, built for the same reason (Cockpit's live preview v2, #443): `packages/engine/
// previewFiber.mjs` exports a pure resolver (`resolveFiberSelection`, no DOM, no clock, no network: a payload in, a
// location out) and an in-page bridge (`installPreviewFiberBridge` / `previewFiberBridgeScript`) that reads the fiber
// off a clicked DOM node and posts the evidence to a parent window. Reused here via the ONE seam (../construct.mjs);
// never edited. Its resolver also has a React-19 tier (a captured stack, mapped through a source map) that Trace's own
// fallback below does not attempt -- Trace's dev setup (Vite + React 18) has `_debugSource` on the fiber directly, so
// the fallback covers the `annotation` and `debug-source` tiers only and says so (`tier`, `confidence`) rather than
// guessing at a stack.
//
// Pure half (this file, `resolveComponentCallSite` / `traceResolveFiberSelection`): a payload in, a location out, same
// input same output, no I/O. Impure half (`bridgeScript`, `traceInstallFiberBridge`): runs inside the PREVIEWED app, not
// in Trace; it is a plain, self-contained function so it can be serialised into a `<script>` the same way Construct's is.
import { importConstructPreviewFiber } from "../construct.mjs";

/** Strip a file reference down to a path relative to `projectRoot`, or `null` when it is not under it (never guessed). */
function toProjectPath(fileName, projectRoot) {
  if (typeof fileName !== "string" || !fileName || typeof projectRoot !== "string" || !projectRoot) return null;
  const root = projectRoot.replace(/\\/g, "/").replace(/\/+$/, "");
  let p = fileName.replace(/\\/g, "/");
  if (p.startsWith("/@fs/")) p = p.slice("/@fs".length); // Vite's absolute-path escape hatch
  if (/^https?:\/\//.test(p)) { try { p = new URL(p).pathname; } catch { return null; } }
  try { p = decodeURIComponent(p); } catch { /* keep the raw form */ }
  if (p === root || p.startsWith(root + "/")) return p.slice(root.length + 1);
  if (p.startsWith("/")) return null; // an absolute path outside the project: never named
  const rel = p.replace(/^\.\//, "");
  return rel && !rel.startsWith("../") ? rel : null;
}

const fromAnnotation = (annotation, root) => {
  const m = /^(.*):(\d+):(\d+)$/.exec(String(annotation ?? ""));
  if (!m) return null;
  const file = toProjectPath(m[1], root);
  return file ? { tier: "annotation", confidence: "exact", file, line: Number(m[2]), column: Number(m[3]) } : null;
};
const fromDebugSource = (ds, root) => {
  if (!ds || typeof ds.fileName !== "string") return null;
  const file = toProjectPath(ds.fileName, root);
  return file ? { tier: "debug-source", confidence: "exact", file, line: ds.lineNumber ?? null, column: ds.columnNumber ?? null } : null;
};

/**
 * Trace's own fallback resolver, used when no Construct checkout is available. Same result contract as Construct's
 * `resolveFiberSelection` (`{ok, tier, confidence, file, line, column, componentName, ancestors, domPath, reason}`), but
 * only the `annotation` (a `data-cx-src` ancestor) and `debug-source` (`fiber._debugSource`, React 16-18 dev builds)
 * tiers: no captured-stack tier, so a React 19 app without `_debugSource` resolves to the component's name only, openly
 * (`reason: "no-evidence"`), never a guess.
 *
 * @param {{selection?:object}|object} payload The bridge's `construct:preview:select`-shaped message, or its `selection`.
 * @param {{projectRoot:string}} context `projectRoot` is required (a location is only ever reported relative to it).
 * @returns {{ok:boolean, tier:string|null, confidence:"exact"|"none", file:string|null, line:number|null, column:number|null, componentName:string|null, ancestors:object[], domPath:object[], reason:string|null}}
 * @throws {Error} When `context.projectRoot` is missing.
 */
export function traceResolveFiberSelection(payload, context) {
  const root = context?.projectRoot;
  if (typeof root !== "string" || !root) throw new Error("traceResolveFiberSelection: `projectRoot` is required");
  const sel = payload && typeof payload === "object" && "selection" in payload ? payload.selection : payload;
  const domPath = Array.isArray(sel?.domPath) ? sel.domPath : [];
  const miss = (reason, componentName, ancestors) => ({ ok: false, tier: componentName || ancestors.length ? "component" : null, confidence: "none", file: null, line: null, column: null, componentName: componentName ?? null, ancestors, domPath, reason });
  if (!sel || typeof sel !== "object") return miss("invalid-payload", null, []);
  const ancestors = (Array.isArray(sel.ancestors) ? sel.ancestors : []).map((a) => {
    const hit = fromDebugSource(a?.debugSource, root);
    return { componentName: a?.componentName ?? null, file: hit?.file ?? null, line: hit?.line ?? null, column: hit?.column ?? null, tier: hit?.tier ?? null };
  });
  const hit = fromAnnotation(sel.annotation, root) ?? fromDebugSource(sel.debugSource, root);
  if (hit) return { ok: true, tier: hit.tier, confidence: hit.confidence, file: hit.file, line: hit.line, column: hit.column, componentName: sel.componentName ?? null, ancestors, domPath, reason: null };
  return miss("no-evidence", sel.componentName, ancestors);
}

/**
 * The resolver to use: Construct's `resolveFiberSelection` when a checkout loads, else Trace's own fallback (same
 * contract, fewer tiers -- see `traceResolveFiberSelection`).
 *
 * @param {string|undefined} root `CONSTRUCT_ROOT`.
 * @returns {Promise<{resolve:Function, source:"construct"|"trace"}>}
 */
export async function getResolver(root = process.env.CONSTRUCT_ROOT) {
  const c = await importConstructPreviewFiber(root);
  return c ? { resolve: c.resolveFiberSelection, source: "construct" } : { resolve: traceResolveFiberSelection, source: "trace" };
}

/**
 * The deliverable: given a clicked element's fiber evidence, the CUSTOM-COMPONENT call site (not the host element
 * itself) -- the nearest fiber ancestor that is a component, resolved to a file/line/column when the evidence reaches
 * that far, plus the full ancestor chain and which resolver answered (`source`).
 *
 * @param {object} payload The bridge's selection payload (see `traceResolveFiberSelection`).
 * @param {{projectRoot:string}} context `projectRoot` (required) and anything the chosen resolver also wants (e.g. Construct's `sourceMaps`, `servedFrom`).
 * @param {string|undefined} root `CONSTRUCT_ROOT`.
 * @returns {Promise<{self:object, callSite:object|null, ancestors:object[], source:"construct"|"trace"}>} `callSite` is
 *   `ancestors[0]` (the nearest component ancestor) when it resolved to a file, else `null` -- never the element's OWN
 *   position mistaken for its wrapping component's.
 */
export async function resolveComponentCallSite(payload, context, root = process.env.CONSTRUCT_ROOT) {
  const { resolve, source } = await getResolver(root);
  const self = await resolve(payload, context);
  const callSite = self.ancestors.find((a) => a.file) ?? null;
  return { self, callSite, ancestors: self.ancestors, source };
}

/**
 * Trace's own in-page bridge, installed in the PREVIEWED app (never in Trace itself): on a click (pick mode or
 * Alt+click), reads the clicked element's fiber (`__reactFiber$<key>` / `__reactInternalInstance$<key>`, present on
 * every host node since React 16), walks `.return` collecting component ancestors and their `_debugSource`, and posts
 * `{type: "trace:preview:select", selection}` to `window.parent`. Deliberately smaller than Construct's
 * `installPreviewFiberBridge`: no hover outline, no payload-size ladder, no devtools-hook stub -- a fallback for when no
 * checkout is present, not a re-implementation of it. A plain function (no closure over module scope) so it can be
 * serialised the same way.
 *
 * @param {any} win The previewed page's `window`.
 * @returns {boolean} `false` when already installed or not embedded in a parent frame.
 */
export function traceInstallFiberBridge(win) {
  if (win.__tracePreviewFiber || win.parent === win) return false;
  win.__tracePreviewFiber = true;
  function fiberOf(el) {
    for (const key of Object.keys(el || {})) if (key.startsWith("__reactFiber$") || key.startsWith("__reactInternalInstance$")) return el[key];
    return null;
  }
  function isComponent(type) { return typeof type === "function" || (typeof type === "object" && type && (type.$$typeof === Symbol.for("react.forward_ref") || type.$$typeof === Symbol.for("react.memo"))); }
  function nameOf(fiber) {
    const t = fiber && fiber.type;
    if (!t || typeof t === "string") return null;
    return typeof t === "function" ? t.displayName || t.name || null : t.displayName || (t.render && (t.render.displayName || t.render.name)) || null;
  }
  function debugSourceOf(fiber) {
    const s = fiber && fiber._debugSource;
    return s && typeof s.fileName === "string" ? { fileName: s.fileName, lineNumber: s.lineNumber || null, columnNumber: s.columnNumber || null } : null;
  }
  function ancestorsOf(fiber) {
    const out = [];
    let f = fiber && fiber.return;
    while (f && out.length < 32) { if (isComponent(f.type)) { const n = nameOf(f); if (n) out.push({ componentName: n, debugSource: debugSourceOf(f) }); } f = f.return; }
    return out;
  }
  function onClick(e) {
    if (!win.__tracePreviewFiberPick && !e.altKey) return;
    const target = e.target;
    if (!target || target.nodeType !== 1) return;
    const fiber = fiberOf(target);
    if (!fiber) return;
    e.preventDefault();
    e.stopPropagation();
    const annotated = target.closest ? target.closest("[data-cx-src]") : null;
    win.parent.postMessage({ type: "trace:preview:select", selection: { componentName: nameOf(fiber), debugSource: debugSourceOf(fiber), annotation: annotated ? annotated.getAttribute("data-cx-src") : null, ancestors: ancestorsOf(fiber), domPath: [] } }, "*");
  }
  win.document.addEventListener("click", onClick, true);
  return true;
}

/** Inline-script source that installs Trace's own bridge in the previewed page. */
export function traceBridgeScript() {
  return `(${traceInstallFiberBridge.toString()})(window);`;
}

/**
 * The bridge-script source to inject: Construct's `previewFiberBridgeScript` when a checkout loads (needs `{nonce,
 * parentOrigin}` in `options`), else Trace's own (`traceBridgeScript`, no options).
 *
 * @param {object} [options] `{nonce, parentOrigin, pick}`, required only for Construct's script.
 * @param {string|undefined} root `CONSTRUCT_ROOT`.
 * @returns {Promise<{script:string, source:"construct"|"trace"}>}
 */
export async function bridgeScript(options, root = process.env.CONSTRUCT_ROOT) {
  const c = await importConstructPreviewFiber(root);
  return c ? { script: c.previewFiberBridgeScript(options), source: "construct" } : { script: traceBridgeScript(), source: "trace" };
}
