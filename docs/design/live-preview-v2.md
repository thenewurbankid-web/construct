# Live preview v2 — click-to-source by reading React internals

Spike + design note for **#443**. Related: #378 (dev server as a process), #379, #381, #431,
`ia-five-screens.md` sections 8.4 and 8.5 (POC parity, what needs the dev server).
Reference for the *experience* only: the owner's POC repo `thenewurbankid-web/cockpit`
(`builder-app/src/fiberSource.ts`, `tree/`, `inspector/`, `locator/useLocator.ts`). No code or
assets from it are copied here; the approach is re-derived and adapted below.

> Status: **design + core block (slices 1-2) landed; slices 3-5 not built.** The tables below
> mark what is code today and what is still a decision on paper.

---

## 1. Why v1 is not enough

Today (`src/engine/jsxSourceAnnotator.mjs` + `previewVitePlugin.mjs` + `previewBridge.mjs`,
merged in #223) click-to-source works like this:

1. The **target app** adds `constructPreview()` to its `vite.config.js`.
2. The plugin rewrites every host JSX element in memory to carry `data-cx-src="file:line:col"`,
   and injects the bridge script into `index.html`.
3. A click in the iframe posts `{ type: 'construct:select', src }` to the Cockpit, which resolves
   it against the source-derived page tree (`domain/PreviewSelection.ts`).

Three hard limits:

| Limit | Consequence |
|---|---|
| Requires a **plugin installed in the target app** | Not "open a project and press play". Any repo we did not scaffold needs a code change first. |
| **Vite only** | Next.js App Router — our *primary* documented target — cannot use it at all (no Vite config to add it to). |
| Host elements only, **no component identity** | The click gives a position; it does not say "this is `<PriceTag>` rendered by `<Cart>`". The tree/inspector cannot show the mixed component/DOM view the POC has. |

The POC solves all three by reading **React's own dev-time internals from the running app** instead
of pre-annotating the source. That is the approach #443 adopts.

---

## 2. Spike findings (measured, not assumed)

Measured against the versions actually installed in this repo on 2026-09-21:
`react@19.3.0`, `react-dom@19.3.0` (`ui/client/node_modules`), `next@15.5.x`. Vite is **not**
installed anywhere in this repo (see §9).

### 2.1 DOM element -> fiber still works, and needs nothing installed

`react-dom-client.development.js:26840`:

```js
internalInstanceKey = "__reactFiber$" + randomKey,
```

Every host DOM node carries a `__reactFiber$<randomKey>` (and `__reactProps$<randomKey>`) own
property in **all** builds, dev and production. Finding it is a `Object.keys(el).find(k =>
k.startsWith('__reactFiber$'))` — exactly what the POC's `getReactFiber` does. This is the whole
foundation and it requires **no devtools hook, no plugin, no app cooperation**.

From a fiber we get, for free and deterministically:

- `fiber.type` — `'div'` for a host element, the function/class/`forwardRef`/`memo` object for a component.
- `fiber.return` — the parent chain, i.e. the **mixed component + DOM tree** (`<div>` inside
  `<Button>` inside `<LoginForm>` inside `<LoginPage>`).
- `fiber.child` / `fiber.sibling` — walk *down* for the tree panel.
- `fiber.memoizedProps` — the props the inspector shows.
- `fiber.stateNode` — back to the DOM node, for the hover outline and for selecting *from* the tree.

### 2.2 `_debugSource` is gone in React 19 — the POC's core read does not port

The POC reads `fiber._debugSource.{fileName,lineNumber,columnNumber}`, which React populated from
the `__source` prop that `@babel/plugin-transform-react-jsx-source` injects. In React 19:

- `grep -c _debugSource react-dom-client.development.js` -> **0**. The field no longer exists.
- `react-jsx-dev-runtime.development.js:327` — the dev runtime's entry point is
  `exports.jsxDEV = function (type, config, maybeKey, isStaticChildren)`: **four parameters**. The
  `source` and `self` arguments the Babel plugin passes are accepted by the transform and then
  **silently dropped by React**. Adding the Babel plugin to a React 19 app therefore buys nothing.

What React 19 has instead (`react-jsx-dev-runtime.development.js:326-344`):

```js
var trackActualOwner = 1e4 > ReactSharedInternals.recentlyCreatedOwnerStacks++;
if (trackActualOwner) {
  var previousStackTraceLimit = Error.stackTraceLimit;
  Error.stackTraceLimit = 10;
  var debugStackDEV = Error("react-stack-top-frame");
  Error.stackTraceLimit = previousStackTraceLimit;
} else debugStackDEV = unknownOwnerDebugStack;
```

and the fiber carries `_debugOwner` (23 references), `_debugStack` (5) and `_debugTask` (27).
So the source location is recoverable, but as an **Error stack captured at element creation**, in
*generated* coordinates — the same thing React DevTools symbolicates through source maps.

Two consequences that shape the design and that the UI must be honest about:

1. **Owner stacks are budgeted.** Only the first `1e4` elements per reset get a real stack
   (`recentlyCreatedOwnerStacks` is zeroed in `react-dom-client.development.js:18843`, once per
   render pass). A very large first paint can leave late elements with the shared
   `unknownOwnerDebugStack`, which resolves to nothing useful. Re-rendering the subtree (or
   clicking again after an interaction) restores it. The UI says "position unavailable — interact
   with the element and pick again", it does not silently point at the wrong line.
2. **Generated, not original.** `_debugStack` frames point at the URL the browser loaded
   (`http://127.0.0.1:5173/src/App.tsx?t=17…` for Vite, a webpack/Turbopack chunk for Next), at the
   *transformed* line/column. Mapping back to `app/page.tsx:42:7` needs the file's source map.

### 2.3 The devtools hook is a *supplement*, not an alternative

`__REACT_DEVTOOLS_GLOBAL_HOOK__` is read by react-dom at module scope
(`react-dom-client.development.js:26828`, `isDevToolsPresent = "undefined" !== typeof
__REACT_DEVTOOLS_GLOBAL_HOOK__`) and used in `injectInternals` (`:1114`). It therefore only works
if the stub exists **before react-dom evaluates**. What it adds over `__reactFiber$`:

- the set of **roots** (`hook.getFiberRoots(rendererID)`) — a tree without needing a DOM anchor;
- `onCommitFiberRoot` — a **commit signal**, i.e. "the app re-rendered, re-sync the tree/selection
  after HMR" without polling;
- the renderer's version, for the capability report ("React 18: exact positions; React 19: mapped
  positions").

It does **not** give source locations by itself, and it is not required for click-to-source.

**Therefore the question in #443 ("reverse proxy vs devtools-hook injection") is not a choice
between two equivalents.** They answer different questions:

- *How does our script get into the page?* -> delivery (§3).
- *How does our script read React?* -> access: `__reactFiber$` always, plus the hook when we were
  early enough to plant it (§2.3).

---

## 3. Decision 1 — delivery: a Cockpit-side loopback injecting proxy, on its own origin

**Chosen.** The Cockpit runs a small HTTP proxy on `127.0.0.1:<proxyPort>`, in front of the target
app's dev server on `127.0.0.1:<devPort>`. It:

- forwards every request to the dev server unchanged;
- for responses whose `content-type` is `text/html`, injects **one `<script>` as the first child of
  `<head>`** (before any app or framework script) carrying the bridge and the devtools-hook stub;
- forwards WebSocket upgrades verbatim, so the app's own HMR (Vite `/@vite/client`, Next's
  `/_next/webpack-hmr`) keeps working through the proxy;
- strips `content-security-policy` / `x-frame-options` on the **proxied dev responses only** (a dev
  server that sets `frame-ancestors` or a nonce CSP would otherwise block both the iframe and the
  injected script). This is a local dev-only rewrite of a local dev server's own headers.

The preview iframe points at the proxy, never at the dev server directly.

### Why not the alternatives

| Alternative | Verdict |
|---|---|
| **Target-app plugin** (today's v1) | Rejected as the primary path — it is exactly the requirement #443 removes. Kept as a *fallback* (§6, tier 4) because where it is present it is the most precise and needs no source maps. |
| **"Bookmarklet": inject from the Cockpit into `iframe.contentWindow` after load** | Impossible across origins: `127.0.0.1:3000` (Cockpit) and `127.0.0.1:5173` (dev server) are different origins, so `contentWindow.eval` / `contentDocument` throw. It would only work if the app were served from the Cockpit's *own* origin — which we explicitly refuse (next row). It is also too late to plant the devtools hook. |
| **Proxy the app under the Cockpit's own origin** (e.g. `http://127.0.0.1:3000/preview/…`) | **Rejected on security.** It would make the target app's code same-origin with the Cockpit: the previewed app could read the Cockpit's `localStorage`, its session cookie and call its API as the signed-in user. A preview must never be able to do that. A separate loopback port keeps the app cross-origin and confines it to `postMessage`. |
| **`srcdoc` / `blob:` iframe rendering the app ourselves** | We would have to own module loading, HMR and routing — reimplementing the dev server. Against "never reinvent the wheel". |
| **CDP (Chrome DevTools Protocol) via a driven browser** | Real capability (it is how our e2e works), but it needs a browser we control, not the user's; and it does not fit the "iframe in the stage" cockpit layout. Keep as a future option for hosted mode. |

### Iframe / same-origin consequences of the choice

- The iframe is **cross-origin** to the Cockpit. So: no `contentDocument`, no shared storage, no
  synchronous DOM reads. Everything crosses as `postMessage`, which is what we want.
- We do **not** set `sandbox` on the iframe. `sandbox` without `allow-same-origin` gives the app an
  opaque origin, which breaks HMR (WebSocket + module loading) and any app that touches storage.
  With `allow-same-origin allow-scripts` the sandbox is, by the HTML spec's own warning, no real
  barrier. The real barrier is the separate origin, which we already have. This is recorded as a
  deliberate decision, not an oversight.
- `postMessage` is always sent with an explicit `targetOrigin` (the proxy origin), never `'*'`
  (v1's bridge uses `'*'`; v2 does not). The Cockpit checks `event.origin` **and** `event.source`.
- Keyboard: Alt+click and the picker are handled **inside** the iframe by the bridge, because the
  parent cannot see events in a cross-origin frame. The bridge reports what it did; the parent
  drives mode changes by posting to the frame.
- Scroll/zoom, viewport presets and "open in a real browser tab" all keep working, because the
  proxy is an ordinary origin.

---

## 4. Decision 2 — the dev server is a process the user starts (#378), local mode only

Unchanged from `ia-five-screens.md` §8.5; restated here because v2 makes it load-bearing:

- The preview is usable with **no server at all** (tree, source, impact, diff, Notes, plan all come
  from the files). The server only adds the rendered canvas, click-to-source and live reload.
- Starting it is an **explicit click**. The exact command read from the project's
  `package.json` `scripts.dev` is shown once per project before the first start; there is no
  auto-start, ever, because starting a dev server executes the project's code.
- It binds **127.0.0.1** on a free port; so does the injecting proxy. Neither is ever bound to
  `0.0.0.0`.
- It is **workspace-contained**: refused for any project outside `CONSTRUCT_WORKSPACE_ROOT`
  (`ui/server/src/projectGuard.mjs` / `workspace.mjs`), with the existing explanation.
- It appears in the **bottom Run panel** as a process with Start / Restart / Stop and Logs, on the
  existing process machinery (`src/engine/processEngine.mjs`), and is killed on Close project,
  Sign out and Cockpit shutdown. The proxy's lifetime is tied to the dev server's.
- "Use a URL instead" stays, restricted to loopback URLs. Attaching to a user-started server gets
  the same injection, through the same proxy.

### Hosted mode: disabled. Threat model

**In hosted mode the preview dev server is not offered at all.** The Cockpit shows the tree-only
experience and says why. Concretely the capability is gated on the *existing* signal — the API is
bound to a loopback host and no OAuth gate is configured (`ui/server/src/auth.mjs`,
`isLoopbackHost` / `resolveAuthConfig`) — not on a new flag that could drift.

Why, in one sentence: **a hosted Cockpit that starts a cloned repo's dev server is remote code
execution as a service.**

| Asset | Threat | Why the gate is the mitigation |
|---|---|---|
| The host machine | `npm run dev` runs arbitrary code from the cloned repo: `scripts.dev` itself, plus every `postinstall`/config file it loads (`vite.config.ts`, `next.config.js` are *executed*). Any signed-in user could clone a repo they control and own the box. | Nothing short of a per-project sandbox (container/VM, seccomp, read-only FS, no network) contains this. We do not have one; so the capability is off. |
| Other users' workspaces | The dev server process inherits the Cockpit's uid; the workspace jail is path-based and enforced *by our code*, not by the OS. Target-app code is under no such jail. | Same: needs OS-level isolation. |
| The host's network | A dev server's code can reach the host's loopback services (the Cockpit's own API on :4000, the hosted DB, cloud metadata endpoints on a VM). | Same. |
| Cockpit credentials | The hosted Cockpit holds a GitHub OAuth session and possibly tokens. Same-uid project code can read anything the process can. | Same. |
| Reachability (why it does not "just work" anyway) | A remote browser cannot reach `127.0.0.1:<port>` on the server; making it reachable means exposing an un-authenticated dev server through the hosted origin. | Would need the proxy to sit behind the auth gate and re-scope cookies — a separate design with its own review. |

Re-enabling hosted preview is **out of scope for #443** and needs its own ticket: per-project
container with no host network, an authenticated proxy path, and a resource/time budget.

The same reasoning applies at smaller scale in local mode, and is why the proxy exists on its own
port: even locally, the previewed app is untrusted code and must not be same-origin with the
Cockpit.

---

## 5. Decision 3 — the security contract of the bridge

The bridge is a string of JavaScript we inject into someone else's page. Its contract:

1. **Handshake with a nonce.** The proxy mints a random `nonce` per preview session and puts it in
   the injected script. The bridge's first act is
   `parent.postMessage({ type: 'construct:preview:hello', nonce, protocol, capabilities }, PARENT_ORIGIN)`.
   The Cockpit ignores any message whose `nonce` does not match the one it handed out, and the
   bridge ignores any inbound message that does not carry it. This is what distinguishes our frame
   from any other frame or extension on the page.
2. **Origin checks both ways.** Outbound: explicit `targetOrigin`. Inbound: `event.origin` must
   equal the Cockpit origin baked into the script, and `event.source` must be `window.parent`.
3. **No `eval`, no dynamic code, no network.** The bridge never evaluates a string, never fetches,
   never opens a socket. Everything it sends is a plain serialisable payload. (Source-map fetching
   is done by the **Cockpit server**, from disk or from the proxied dev server — not by the page.)
4. **A fixed, closed message vocabulary.** `hello`, `select`, `hover`, `mode`, `highlight`,
   `capabilities`, `error`. Anything else is dropped. No "run this in the page" verb exists — that
   is the difference between a cockpit and a remote shell.
5. **Caps.** A selection payload is capped: at most 32 ancestors, 4 KB of stack text per frame and
   64 KB total; prop *names* and small scalar values only (never a whole `memoizedProps` graph, see
   6 below). Hover events are throttled (one per animation frame) and the whole bridge no-ops if a
   payload would exceed the cap, reporting `error: 'payload-too-large'` instead of truncating into
   something that could resolve to the wrong place.
6. **No secrets.** Props are the single most likely place for a token to appear (`<Api
   token={…}>`). The bridge sends prop **names and types** plus values only for short primitives,
   and never sends functions, DOM nodes, promises or objects. Anything else is reported as
   `"[Object]"`. Values are never persisted by the Cockpit.
7. **Idempotent and removable.** Installing twice is a no-op; the Cockpit can tell it to detach,
   and it restores every style it changed.
8. **Dev-only by construction.** The proxy only injects in front of a dev server the user started;
   nothing is ever written into the project, and no build output can contain the bridge (unlike v1,
   which transforms module source — v2 does not touch the app's code at all).

---

## 6. Decision 4 — fiber -> source, a ladder that degrades visibly

`resolveFiberSelection()` (the core block, §7) accepts whichever evidence the page could produce and
resolves the **best available** tier. Every result carries `tier` and `confidence`, and the UI shows
it — the no-code-IDE principle means the user must never be silently pointed at the wrong line.

| Tier | Evidence | When | Result | UI |
|---|---|---|---|---|
| 1 `annotation` | `data-cx-src` on the element | the target opted into `constructPreview()` (v1 path) | exact `file:line:col` | "exact" |
| 2 `debug-source` | `fiber._debugSource` | React 16-18 dev builds | exact `file:line:col` | "exact" |
| 3 `stack` | `fiber._debugStack` frames + the file's source map | React 19 dev builds | mapped `file:line:col` | "mapped from the dev build" |
| 4 `component` | component name + fiber ancestor chain only | no position evidence (owner-stack budget exhausted, production build, source map missing) | `componentName` + `ancestors[]`, **no line** | "component only — position unavailable", and the tree selects the component node, not a line |

Nothing below tier 4 is ever guessed. A result with no file is `{ ok: false, reason }`, and the
reasons are enumerated (`no-fiber`, `no-evidence`, `unmapped`, `outside-project`, `minified`).

**Robustness notes that the implementation encodes:**

- *Stack frame choice.* `_debugStack` is created **inside** `jsxDEV`, so frame 0 is React's own
  (`react-jsx-dev-runtime`, `react-stack-top-frame`). The JSX call site is the first frame **not**
  inside `react`/`react-dom`/`node_modules`/`/@react-refresh`. Frames are parsed from both V8 and
  SpiderMonkey/JSC formats.
- *Owner vs use site.* Like the POC's `ownerFile`/`ownerLine`, the chain distinguishes *where the
  element is written* from *where its owning component is used*; the inspector needs the second to
  edit the binding. We keep both (`file`/`line` and `ancestors[i].file`/`line`).
- *Source maps.* Applied to the generated position to get the original source path. Vite serves
  per-file maps; Next serves bundle maps. Both are fetched by the **server**, which also resolves
  `webpack://_N_E/./app/page.tsx`-style and `/@fs/…`-style sources back to a real path.
- *Fast-refresh line drift.* The POC had to subtract 19/3 lines because `@vitejs/plugin-react`
  prepends a fast-refresh header **after** the `__source` positions were baked in. The v2 stack
  path does not have this class of bug at all: the stack's line/column are positions in the file
  *as served*, and the source map is computed on that same served output. (Tier 1 and 2 remain
  subject to it, which is one more reason they are not the primary path.)
- *Containment.* The resolver takes `projectRoot` and refuses to emit a path outside it —
  `..`, absolute paths, symlink-shaped escapes, Windows separators and `node_modules` are all
  rejected with `outside-project`. Nothing the page says can make the Cockpit open a file outside
  the open project. This is the single most important property of the block and is tested as such.
- *Minified/production apps.* Detected (no dev fiber fields, single-letter component names) and
  reported as `minified`, with "this looks like a production build — start the dev server".

**Determinism.** The resolver is a pure function of `(payload, { projectRoot, sourceMaps })`. No
clock, no network, no filesystem, no LLM. Same input, same output. Fetching source maps is I/O and
lives in the caller (the Cockpit server), which is what makes the resolver unit-testable against
recorded payloads from real dev builds.

**Performance.** Fiber reads happen only on hover (throttled to one per frame) and click, never on
a timer; a hover walks at most ~32 `fiber.return` steps. Source maps are fetched once per file and
cached per dev-server session, invalidated by the HMR commit signal. Nothing is sent over
`postMessage` that is not the result of a user gesture.

---

## 7. The core block: `src/engine/previewFiber.mjs`

Built in slice 2. Permissive deps only (in fact: none — Node built-ins only), pure, unit tested.

```js
import {
  previewFiberBridgeScript,   // (options) -> string: the in-page script
  installPreviewFiberBridge,  // (win, options) -> boolean: the same function, callable in tests
  resolveFiberSelection,      // (payload, context) -> resolution   <- the deterministic core
  parseStackFrames,           // (stackText) -> frames[]            (exported for tests/tools)
  applySourceMap,             // (map, line, column) -> original    (nearest-mapping lookup)
  toProjectPath,              // (url|path, { projectRoot }) -> relative path | null (containment)
  PREVIEW_FIBER_PROTOCOL,     // protocol version string
} from './previewFiber.mjs';
```

`resolveFiberSelection(payload, { projectRoot, sourceMaps })` returns

```js
{ ok: true, tier, confidence, file, line, column, componentName,
  ancestors: [{ componentName, file, line, column }], // nearest owner first
  domPath, reason: null }
// or
{ ok: false, tier: 'component'|null, reason: 'no-evidence'|'unmapped'|'outside-project'|…,
  componentName, ancestors }
```

`file` is always **project-root-relative with `/` separators**, or the result is `ok: false`.

---

## 8. How the UI uses it (slices 3-5, not built)

Selection-first, per the no-code-IDE principle: **hover outlines, click selects, the tree and
inspector follow, and "View source" is a collapsed drill-down** — the Monaco editor is never the
default surface of the Pages screen.

- **Pick mode** (a toggle in the stage toolbar, plus **Alt+click** as the modifier-driven shortcut
  that works without leaving normal interaction): with Pick off, clicks go to the app so the user
  can navigate it; with Pick on, clicks select instead. Alt+click selects in either mode. Esc exits
  Pick. This is exactly the POC's `useLocator` behaviour, generalised.
- **Selection sync both ways**: preview -> tree/inspector/breadcrumb, and tree row -> preview
  outline (the bridge highlights by a selection id it handed out, never by an evaluated selector).
- **The tree stays source-derived** (`/api/pages/tree`) so it works with the server stopped; the
  fiber payload *annotates* it (which node is live, which component rendered it) rather than
  replacing it. Where a fiber node has no source-tree counterpart (a node from another file,
  a library component) the tree shows it as a linked "elsewhere" row.
- **Capability banner**: one quiet line naming the tier ("positions mapped from the dev build"),
  and the fallback wording of §6 when it degrades.

---

## 9. Fixtures and what we could verify here

Slice 2 ships two fixtures under `test-utils/preview-fixtures/`:

- `next-app/` — a minimal Next.js App Router page. **Next 15 is installed in this repo**
  (`ui/client/node_modules/next`), so its dev build can be exercised locally.
- `vite-app/` — a minimal Vite + React app. **Vite is not installed anywhere in this repo**, and
  #443 explicitly forbids installing frameworks for this. The fixture's source is checked in so it
  can be used the moment a Vite toolchain exists (slice 5 / e2e), and the resolver is tested
  against **recorded payloads** shaped like a Vite dev build's (`/src/App.tsx?t=…` URLs, Vite's
  per-file source maps) rather than against a live server.

Recorded payloads live in `test/fixtures/previewFiber/`, each with a note saying whether it was
captured from a real run or hand-written from an observed shape.

---

## 10. Open questions

1. **Bundle-level source maps in Next dev.** Next 15 dev may serve client code through Turbopack or
   webpack depending on the flag; the source-map URL and the `sources` naming differ. The resolver
   handles both shapes it has seen; a third would be a data point, not a redesign.
2. **Server Components.** An RSC-rendered subtree has no client fiber for the server part. Clicking
   inside it resolves to the nearest client component; naming the server component needs the RSC
   payload. Out of scope for #443 — recorded as a known gap in the UI wording.
3. **Re-enabling hosted preview** (§4) — separate ticket, needs container isolation.
4. **Isolated single-component view** (render one component alone, for the Components screen and the
   State switcher) needs a route in the target app that mounts it; with no plugin installed, that is
   a bridge-side mount into a blank page, and is its own design.
