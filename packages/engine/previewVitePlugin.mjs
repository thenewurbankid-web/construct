// Vite plugin: opt-in, dev-server-only wiring for the Cockpit live preview.
//   // vite.config.js
//   import { constructPreview } from 'construct/packages/engine/previewVitePlugin.mjs';
//   plugins: [constructPreview(), react()]
// It annotates JSX in memory as Vite serves it (source files are never
// modified) and injects the click bridge into index.html. Never runs in build.
import fs from 'node:fs';
import path from 'node:path';
import { annotateJsxSource } from './jsxSourceAnnotator.mjs';
import { previewBridgeScript } from './previewBridge.mjs';

/** Pure transform used by the plugin (exported for tests). Returns null to skip the file. */
export function transformForPreview(code, id, root) {
  const clean = id.split('?')[0];
  if (!/\.[jt]sx$/.test(clean) || clean.includes('node_modules')) return null;
  const file = path.relative(root, clean).split(path.sep).join('/');
  try {
    const out = annotateJsxSource(code, { file });
    return out.count ? { code: out.code, map: null } : null;
  } catch {
    return null; // let the normal pipeline report the syntax error
  }
}

// The isolated-component harness (#380, "Components screen"): serves ONE component
// alone, mounted with no surrounding app, so the Cockpit can preview it outside the
// pages that use it. Dev-server-only (`apply: 'serve'`), same trust boundary as the
// rest of this plugin (127.0.0.1 only, see docs/design/ia-five-screens.md 8.5).
export const HARNESS_PATH = '/__construct/component';

function withinRoot(root, abs) {
  return abs === root || abs.startsWith(root + path.sep);
}

/** Pure: the harness HTML for one file/export (exported for tests). `fsPath` must already be
 * validated as inside the project root.
 * @param {string} fsPath - absolute path of the component file to preview.
 * @param {string} exportName - the export to render (`'default'` or a named export).
 * @returns {string} the standalone HTML document that mounts and renders that export.
 */
export function harnessHtml(fsPath, exportName) {
  const importPath = `/@fs/${fsPath.split(path.sep).join('/')}`;
  const pick = exportName && exportName !== 'default' ? `mod[${JSON.stringify(exportName)}] ?? mod.default` : 'mod.default';
  return `<!doctype html>
<html>
  <head><meta charset="utf-8" /><title>Construct component preview</title></head>
  <body>
    <div id="construct-preview-root"></div>
    <script type="module">
      import { createElement } from 'react';
      import { createRoot } from 'react-dom/client';
      import * as mod from ${JSON.stringify(importPath)};
      const Comp = ${pick};
      const target = document.getElementById('construct-preview-root');
      if (Comp) createRoot(target).render(createElement(Comp));
      else target.textContent = 'No such export in this file.';
    </script>
  </body>
</html>`;
}

function handleHarness(root, req, res) {
  const url = new URL(req.url, 'http://localhost');
  const file = (url.searchParams.get('file') || '').replace(/^\/+/, '');
  const exportName = url.searchParams.get('export') || 'default';
  const abs = path.resolve(root, file);
  if (!file || !/\.[jt]sx$/.test(abs) || !withinRoot(root, abs) || !fs.existsSync(abs)) {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'text/plain');
    res.end('Not a component of this project.');
    return;
  }
  res.setHeader('Content-Type', 'text/html');
  res.end(harnessHtml(abs, exportName));
}

export function constructPreview() {
  let root = process.cwd();
  return {
    name: 'construct-preview',
    apply: 'serve',
    enforce: 'pre',
    configResolved(config) { root = config.root; },
    transform(code, id) { return transformForPreview(code, id, root); },
    transformIndexHtml() {
      return [{ tag: 'script', children: previewBridgeScript(), injectTo: 'body' }];
    },
    configureServer(server) {
      server.middlewares.use(HARNESS_PATH, (req, res) => handleHarness(root, req, res));
    },
  };
}
