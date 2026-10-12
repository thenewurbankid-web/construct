// G2, plain-node mechanism: `node --import <this file> ...` instruments the target files at load time with
// module.registerHooks (synchronous hooks, Node >= 22.15 / 23.5; they see both import and require).
//   ESM target  -> served as a facade: `export *` from the original (loaded as `<url>?line-orig`) plus each exported
//                  function re-exported wrapped, so every caller that imports it is recorded (module identity: file +
//                  export name). Calls inside one module do not go through the facade and are not recorded.
//   CJS target  -> the source gets a tail that wraps module.exports in place.
// Env: LINE_RUNTIME_ROOT (app root, default cwd), LINE_RUNTIME_FILES (comma-separated app-relative targets),
// LINE_RUNTIME_DIR (where the records are written on exit). A test names itself in `globalThis.__lineRuntimeTest`.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire, registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { createRecorder } = require('./recorder.cjs');
const { esmExportNames } = require('./staticScan.cjs');

const ORIG = 'line-orig';
const root = path.resolve(process.env.LINE_RUNTIME_ROOT ?? process.cwd());
const files = new Set((process.env.LINE_RUNTIME_FILES ?? '').split(',').filter(Boolean));
const posix = (p) => p.split(path.sep).join('/');

const recorder = createRecorder({ test: () => globalThis.__lineRuntimeTest });
recorder.isTarget = (abs) => { const rel = posix(path.relative(root, abs)); return files.has(rel) ? rel : null; };
globalThis.__lineRuntime = recorder;
recorder.installFetch(globalThis);

/** The app-relative target a file URL names, or null (a `?line-orig` URL is never a target). */
function targetOf(url) {
  if (!url.startsWith('file:') || url.includes(`?${ORIG}`)) return null;
  return recorder.isTarget(fileURLToPath(url));
}

/** Wrap an ESM module's namespace into a plain object of wrapped exports (used by the facade). */
recorder.esmExports = (ns, meta) => {
  recorder.instrumentExports({}, meta); // marks the file loaded
  const out = {};
  for (const k of Object.keys(ns)) {
    const v = ns[k];
    out[k] = typeof v === 'function' ? recorder.wrap(v, { kind: 'export', file: meta.file, name: k, local: v.name || k }) : v;
  }
  return out;
};

registerHooks({
  load(url, context, nextLoad) {
    const file = targetOf(url);
    if (!file) return nextLoad(url, context);
    const r = nextLoad(url, context);
    const source = r.source == null ? fs.readFileSync(fileURLToPath(url), 'utf8') : String(r.source);
    if (r.format === 'module') {
      const { names, hasDefault } = esmExportNames(source);
      const orig = JSON.stringify(`${url}?${ORIG}`);
      const lines = [
        `import * as __o from ${orig};`,
        `export * from ${orig};`,
        `const __w = globalThis.__lineRuntime.esmExports(__o, ${JSON.stringify({ file })});`,
        ...names.map((n) => `export const ${n} = __w[${JSON.stringify(n)}];`),
        ...(hasDefault ? ['export default __w.default;'] : []),
      ];
      return { format: 'module', source: lines.join('\n'), shortCircuit: true };
    }
    if (r.format === 'commonjs') {
      return { ...r, source: `${source}\n;module.exports = globalThis.__lineRuntime.instrumentExports(module.exports, ${JSON.stringify({ file })});` };
    }
    return r;
  },
});

process.on('exit', () => {
  const dir = process.env.LINE_RUNTIME_DIR;
  if (!dir) return;
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `node-${process.pid}.json`), JSON.stringify(recorder.records()));
});
