// G2, jest mechanism (1 of 2): a transformer that wraps the app's own transformer (ts-jest, babel-jest, ...). Files
// under test get two injections, neither of which adds a line (so the transformer's source map and istanbul's line
// numbers stay right):
//   head (on line 1, after "use strict"):  require = recorder.wrapRequire(require, meta, isTarget)
//       -> react / react/jsx-runtime come back with useState, useReducer and jsx wrapped; react-redux with useDispatch
//          wrapped; axios with its methods wrapped; app files that are targets come back with their exports wrapped
//          (also when jest.mock replaced them: the callee is recorded by module identity and marked `mocked`)
//   tail (after the code, before the source-map comment):  module.exports = recorder.instrumentExports(module.exports)
//       -> the module's own exports are wrapped, so callers that are not instrumented (the test file) reach them too
// Config (transformer options, JSON): {inner: [transformerPath, options], appRoot, files: [app-relative paths]}.
// Jest uses its own module system, so module.registerHooks does not see these loads; this transform is the equivalent.
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { stateNames } = require('./staticScan.cjs');

const VERSION = 'line-runtime-1';
const loaded = new Map();

function innerOf(cfg) {
  const [p, opts] = cfg.inner;
  const key = JSON.stringify(cfg.inner);
  if (!loaded.has(key)) {
    let m = require(p);
    if (!m.process && !m.createTransformer && m.default) m = m.default;
    const t = typeof m.createTransformer === 'function' ? m.createTransformer(opts) : m;
    loaded.set(key, t);
  }
  return { t: loaded.get(key), opts };
}

const posix = (p) => p.split(path.sep).join('/');
function relTarget(cfg, file) {
  const rel = posix(path.relative(cfg.appRoot, file));
  return cfg.files.includes(rel) ? rel : null;
}

function inject(code, meta) {
  const head = `var __lrt=globalThis.__lineRuntime,__lrm=${JSON.stringify(meta)};if(__lrt){require=__lrt.wrapRequire(require,__lrm,__lrt.isTarget);}`;
  const tail = '\n;if(typeof __lrt!=="undefined"&&__lrt){module.exports=__lrt.instrumentExports(module.exports,__lrm);}';
  const strict = /^(\s*(['"])use strict\2;?)/.exec(code);
  let out = strict ? `${strict[1]}${head}${code.slice(strict[1].length)}` : `${head}${code}`;
  const mapAt = out.search(/\n\/\/# sourceMappingURL=[^\n]*\s*$/);
  out = mapAt >= 0 ? `${out.slice(0, mapAt)}${tail}${out.slice(mapAt)}` : `${out}${tail}`;
  return out;
}

module.exports = {
  canInstrument: false,
  getCacheKey(src, file, options) {
    const cfg = options.transformerConfig;
    const { t, opts } = innerOf(cfg);
    const base = typeof t.getCacheKey === 'function' ? t.getCacheKey(src, file, { ...options, transformerConfig: opts }) : crypto.createHash('sha1').update(src).update(file).digest('hex');
    return crypto.createHash('sha1').update(String(base)).update(VERSION).update(relTarget(cfg, file) ?? '-').digest('hex');
  },
  process(src, file, options) {
    const cfg = options.transformerConfig;
    const { t, opts } = innerOf(cfg);
    const r = t.process(src, file, { ...options, transformerConfig: opts });
    const rel = relTarget(cfg, file);
    if (!rel) return r;
    const meta = { file: rel, states: stateNames(src) };
    if (typeof r === 'string') return inject(r, meta);
    return { ...r, code: inject(r.code, meta) };
  },
};

// for tests: the injection alone
module.exports.inject = inject;
module.exports.exists = (p) => fs.existsSync(p);
