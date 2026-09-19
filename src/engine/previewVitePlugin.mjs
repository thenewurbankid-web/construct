// Vite plugin: opt-in, dev-server-only wiring for the Cockpit live preview.
//   // vite.config.js
//   import { constructPreview } from 'construct/src/engine/previewVitePlugin.mjs';
//   plugins: [constructPreview(), react()]
// It annotates JSX in memory as Vite serves it (source files are never
// modified) and injects the click bridge into index.html. Never runs in build.
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
  };
}
