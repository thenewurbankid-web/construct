// The atom runtime (Smith, packages/line-smith in this construct repo), read from its
// COMMITTED state only: `git archive <sha>:<subdir> src` into a local snapshot folder
// (bench/atoms/.runtime/<sha>, git-ignored). Never writes to the repo.
// SMITH_RUNTIME_REPO (+ SMITH_RUNTIME_SUBDIR, default '') points at another checkout instead.
//
//   snapshotRuntime({repo, ref, subdir}) -> {sha, dir}
//   catalogFor(dir, sha)         -> {catalog, compiled, source: 'catalog.json' | 'derived'}
//   deriveCatalog(dir)           -> catalog entries derived from the sources' "Exactly `form`" doc lines,
//                                   used only while src/atoms/catalog.json is not committed yet
//   bundleRuntime(dir)           -> one CommonJS script defining globalThis.__smith (for QuickJS)
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const parser = require('@babel/parser');
const { compileCatalog, paramsFromSource } = require('../../atoms-catalog');

const DEFAULT_REPO = process.env.SMITH_RUNTIME_REPO || path.resolve(__dirname, '../../../..');
const DEFAULT_SUBDIR = process.env.SMITH_RUNTIME_REPO ? (process.env.SMITH_RUNTIME_SUBDIR || '') : 'packages/line-smith';
const SNAP_ROOT = path.join(__dirname, '.runtime');

function snapshotRuntime({ repo = DEFAULT_REPO, ref = 'HEAD', subdir = DEFAULT_SUBDIR } = {}) {
  const sha = execFileSync('git', ['-C', repo, 'rev-parse', ref], { encoding: 'utf8' }).trim();
  // The tree of Smith's folder at that commit: the snapshot key, so a construct commit that leaves Smith alone reuses it.
  const tree = execFileSync('git', ['-C', repo, 'rev-parse', subdir ? `${sha}:${subdir}` : `${sha}^{tree}`], { encoding: 'utf8' }).trim();
  const dir = path.join(SNAP_ROOT, tree.slice(0, 12));
  if (!fs.existsSync(path.join(dir, 'src', 'index.ts'))) {
    fs.mkdirSync(dir, { recursive: true });
    const tar = execFileSync('git', ['-C', repo, 'archive', tree, 'src'], { maxBuffer: 64 * 1024 * 1024 });
    execFileSync('tar', ['-x', '-C', dir], { input: tar });
  }
  return { sha, dir };
}

// "Exactly `form`" (first backtick snippet on the first doc line saying exactly) per exported function.
function deriveCatalog(dir) {
  const atomsDir = path.join(dir, 'src', 'atoms');
  const entries = [];
  for (const f of fs.readdirSync(atomsDir).filter((n) => n.endsWith('.ts') && n !== 'index.ts').sort()) {
    const src = fs.readFileSync(path.join(atomsDir, f), 'utf8');
    const ast = parser.parse(src, { sourceType: 'module', plugins: ['typescript'], attachComment: true });
    const seen = new Set();
    for (const st of ast.program.body) {
      if (st.type !== 'ExportNamedDeclaration' || !st.declaration) continue;
      const d = st.declaration;
      if ((d.type !== 'FunctionDeclaration' && d.type !== 'TSDeclareFunction') || !d.id) continue;
      const name = d.id.name;
      if (seen.has(name)) continue;
      const doc = (st.leadingComments || []).filter((c) => c.type === 'CommentBlock').map((c) => c.value).join('\n');
      if (!doc) continue;
      seen.add(name);
      const lines = doc.split('\n').map((l) => l.replace(/^\s*\*\s?/, ''));
      const line = lines.find((l) => /exactly/i.test(l) && /`[^`]+`/.test(l.slice(l.search(/exactly/i))));
      const form = line ? line.slice(line.search(/exactly/i)).match(/`([^`]+)`/)[1] : null;
      entries.push({
        atom: name,
        js: form ? [form] : [],
        reads: (d.params || []).map((p) => (p.type === 'Identifier' ? p.name : p.left ? p.left.name : p.argument ? p.argument.name : null)).filter(Boolean),
        pure: !/IMPURE/.test(doc),
        mutates: false,
        module: `src/atoms/${f}`,
      });
    }
  }
  return entries;
}

function catalogFor(dir, sha) {
  const file = path.join(dir, 'src', 'atoms', 'catalog.json');
  let catalog;
  let source;
  if (fs.existsSync(file)) {
    catalog = JSON.parse(fs.readFileSync(file, 'utf8'));
    source = 'catalog.json';
  } else {
    catalog = { version: `derived:${sha.slice(0, 12)}`, atoms: deriveCatalog(dir) };
    source = 'derived';
  }
  const compiled = compileCatalog(catalog, { signatures: paramsFromSource(dir) });
  if (source === 'catalog.json' && !String(compiled.version).includes(sha.slice(0, 7))) compiled.version = `${compiled.version}@${sha.slice(0, 12)}`;
  return { catalog, compiled, source };
}

// Every runtime .ts file transpiled to CommonJS and wrapped in a tiny module
// table; the bundle sets globalThis.__smith to the package's root exports.
function bundleRuntime(dir) {
  const ts = require('typescript');
  const srcDir = path.join(dir, 'src');
  const files = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name.endsWith('.ts') && !e.name.endsWith('.d.ts')) files.push(full);
    }
  };
  walk(srcDir);
  const mods = files.map((full) => {
    const rel = path.relative(srcDir, full).replace(/\\/g, '/').replace(/\.ts$/, '');
    const out = ts.transpileModule(fs.readFileSync(full, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: false },
    }).outputText;
    return `${JSON.stringify(rel)}: function (exports, require, module) {\n${out}\n}`;
  });
  return `(function () {
  var defs = {${mods.join(',\n')}};
  var cache = {};
  function norm(from, spec) {
    if (spec.charAt(0) !== '.') return spec;
    var parts = from.split('/'); parts.pop();
    spec.split('/').forEach(function (p) { if (p === '..') parts.pop(); else if (p !== '.') parts.push(p); });
    var id = parts.join('/');
    if (defs[id]) return id;
    if (defs[id + '/index']) return id + '/index';
    return id;
  }
  function load(id) {
    if (cache[id]) return cache[id].exports;
    var def = defs[id];
    if (!def) throw new Error('smith runtime: no module ' + id);
    var module = { exports: {} };
    cache[id] = module;
    def(module.exports, function (spec) { return load(norm(id, spec)); }, module);
    return module.exports;
  }
  globalThis.__smith = load('index');
})();`;
}

module.exports = { DEFAULT_REPO, snapshotRuntime, deriveCatalog, catalogFor, bundleRuntime };
