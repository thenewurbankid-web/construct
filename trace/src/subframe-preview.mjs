// TR-23: render a real Subframe TSX page (marked with data-dyn/data-list/data-action) to real HTML for the
// preview panel, instead of page-preview.mjs's crude tag-literal walker. Used only when an example's
// feature.json sets `"render": "subframe"`.
//
// How: Vite's SSR module runner (middlewareMode, no dev server on a port) resolves subframe-app's `@/` alias
// and TSX transform exactly like `npm run dev` does, so `ssrLoadModule()` gives back the same component tree
// Subframe's own dev server would render. The page's text is fed in as a virtual module (a content-hashed,
// fake-but-real-looking path a plugin resolves/loads in memory, see makeVirtualPagePlugin below) rather than
// a real file path, so the page can live anywhere — in particular in the example's own folder, self-contained
// like every other example, instead of needing to sit physically under subframe-app/src for module
// resolution to work. `react-dom/server`'s
// `renderToStaticMarkup` (resolved from subframe-app's own node_modules, not loaded through the SSR module
// runner, which mis-resolves its CJS entry) turns the tree into HTML; the marker props survive because
// Subframe's components pass unknown DOM props through to their root element, so `data-dyn`/`data-list`/
// `data-action` come out as real attributes. Tailwind's resolved CSS (subframe-app's own `postcss.config.js`
// + `tailwind.config.js`) is fetched the same way the dev server would serve `src/index.css`, via
// `server.transformRequest()`, so classNames come out styled, not bare. No network, no browser, no dev
// server bound to a port; deterministic for a given source.
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { injectDataId, hasMarkers } from "./subframe-data-id.mjs";

let viteServerPromise = null;
let cssPromise = null;
const virtualSources = new Map(); // fake absolute path -> source text, fed by the plugin below

// Serves a page's text as a module without it needing to be a real file: resolveId maps the public specifier
// ("trace-preview-page:<hash>.tsx") to a *fake but real-looking* absolute path under subframe-app/src/ (never
// written to disk — `load` intercepts it first). This id, rather than a Rollup-style "\0"-prefixed virtual
// id, matters: @vitejs/plugin-react's and esbuild's transforms silently skip "\0..." ids (their own
// convention for "not a source file, not ours to compile"), so a virtual id never got its JSX compiled and
// `vite:import-analysis` failed on the raw `<div ...>` syntax. A path-shaped id keeps every other plugin's
// normal file-extension-based logic working. The hash is the page's own content hash, so a changed page is
// automatically a new module id — no manual cache invalidation needed.
function virtualPagePath(subframeDir, hash) {
  return path.join(subframeDir, "src", `__trace_preview_page__${hash}.tsx`);
}

function makeVirtualPagePlugin(subframeDir) {
  return {
    name: "trace-preview-virtual-page",
    resolveId(id) {
      const m = /^trace-preview-page:([a-f0-9]+)\.tsx$/.exec(id);
      return m ? virtualPagePath(subframeDir, m[1]) : undefined;
    },
    load(id) {
      if (virtualSources.has(id)) return virtualSources.get(id);
    },
  };
}

// Adds data-id (see subframe-data-id.mjs) to a marked page's JSX *before* @vitejs/plugin-react compiles it,
// so the real DOM carries data-id the same way the hand-authored examples' preview does. `enforce: "pre"`
// puts it ahead of the react plugin in the transform pipeline; only files that actually carry a marker pay
// the parse+traverse cost.
const injectDataIdPlugin = {
  name: "trace-inject-data-id",
  enforce: "pre",
  transform(code, id) {
    if (!/\.tsx($|\?)/.test(id) || !hasMarkers(code)) return null;
    return { code: injectDataId(code), map: null };
  },
};

function getViteServer(subframeDir) {
  viteServerPromise ??= loadFromSubframeApp(subframeDir, "vite").then((vite) =>
    vite.createServer({
      root: subframeDir,
      appType: "custom",
      logLevel: "warn",
      plugins: [makeVirtualPagePlugin(subframeDir), injectDataIdPlugin],
      server: { middlewareMode: true, watch: null, hmr: false },
      optimizeDeps: { noDiscovery: true },
    })
  );
  return viteServerPromise;
}

// react-dom/server's CJS entry picks its implementation file at require() time by inspecting
// `require.cache`/`process.env`; loaded through Vite's SSR module runner it resolves the wrong file
// (`Cannot find module './cjs/react-dom-server-legacy...'`). Resolving and importing it directly from
// subframe-app's own node_modules (the same package a plain `npm run dev` would use) sidesteps that.
function loadFromSubframeApp(subframeDir, specifier) {
  const require = createRequire(path.join(subframeDir, "package.json"));
  return import(pathToFileURL(require.resolve(specifier)).href);
}

// Tailwind's resolved CSS for subframe-app, exactly as the dev server would compute it. Cached for the life
// of the process; a preview server restart picks up source changes (this is a preview endpoint, not the
// generator — determinism across calls matters more than live reload here).
async function loadTailwindCss(subframeDir) {
  cssPromise ??= (async () => {
    const server = await getViteServer(subframeDir);
    // Tailwind's own `content` glob resolution (unlike postcss.config.js/tailwind.config.js lookup) is
    // relative to process.cwd(), not to the config file, so a caller running from outside subframe-app/
    // (e.g. this server started from trace/) would silently get zero scanned files and empty CSS. Only
    // matters for this one call: the result is cached for the process, so later calls never touch cwd.
    const cwd = process.cwd();
    let code;
    try {
      process.chdir(subframeDir);
      ({ code } = await server.transformRequest("/src/index.css"));
    } finally {
      process.chdir(cwd);
    }
    const m = /const __vite__css = ("(?:[^"\\]|\\.)*")/.exec(code);
    if (!m) throw new Error("could not find the transformed CSS in Vite's output for src/index.css");
    // eslint-disable-next-line no-new-func -- decoding our own toolchain's JS string literal, not user input
    return new Function(`"use strict"; return (${m[1]});`)();
  })();
  return cssPromise;
}

/**
 * Render a real Subframe page to HTML for the preview panel.
 *
 * @param {string} subframeDir Absolute path to `subframe-app/`.
 * @param {string} pageSource The marked page's TSX source text (read by the caller from wherever the
 *   example's `feature.json` points — it need not live under `subframeDir`).
 * @returns {Promise<string>} A standalone HTML fragment: a `<style>` tag with Tailwind's resolved CSS
 *   followed by the rendered page markup.
 */
export async function renderSubframePreview(subframeDir, pageSource) {
  const server = await getViteServer(subframeDir);
  const hash = createHash("sha1").update(pageSource).digest("hex").slice(0, 16);
  const fakePath = virtualPagePath(subframeDir, hash);
  virtualSources.set(fakePath, pageSource);
  try {
    const url = `trace-preview-page:${hash}.tsx`;
    const [{ default: Page }, React, ReactDOMServer, css] = await Promise.all([
      server.ssrLoadModule(url),
      loadFromSubframeApp(subframeDir, "react"),
      loadFromSubframeApp(subframeDir, "react-dom/server"),
      loadTailwindCss(subframeDir),
    ]);
    const html = ReactDOMServer.renderToStaticMarkup(React.createElement(Page));
    return `<style>${css}</style>${html}`;
  } finally {
    virtualSources.delete(fakePath);
  }
}

/** Closes the Vite SSR server, if one was started. For tests and a clean process exit. */
export async function closeSubframePreview() {
  if (!viteServerPromise) return;
  const server = await viteServerPromise;
  viteServerPromise = null;
  cssPromise = null;
  virtualSources.clear();
  await server.close();
}
