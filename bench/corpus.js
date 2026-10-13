// Smith coverage corpus: collects real TS/TSX functions from a source tree
// and measures how much of them toEnglish() can say in plain English.
//
// Deterministic, read-only: files are walked in sorted order, functions in
// source order, and nothing is written back to the corpus. The harness CLI
// (bench/coverage.mjs) and the golden test (smith-golden.test.js) both use
// this module so they can never disagree on what "the corpus" or "the rate"
// means.
const fs = require('fs');
const path = require('path');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;

const TS_PLUGINS = ['typescript', 'jsx'];
const DEFAULT_CONSTRUCT = '/Users/shashank/Repositories/construct/.claude/worktrees/og-final-1012';
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', '.next', 'coverage', '__tests__', 'test', 'tests', 'e2e', '.git']);
const TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$/;

// The three placeholder shapes toEnglish can fall back to, in the order the
// harness reports them.
const PLACEHOLDER_KINDS = ['expr', 'stmt', 'pattern'];

function defaultRoots(base = process.env.SMITH_CORPUS || DEFAULT_CONSTRUCT) {
  if (!fs.existsSync(base)) return [];
  const roots = [path.join(base, 'packages')];
  const bench = path.join(base, 'bench');
  if (fs.existsSync(bench)) {
    for (const name of fs.readdirSync(bench).sort()) {
      const starter = path.join(bench, name, 'starter');
      if (fs.existsSync(starter)) roots.push(starter);
    }
  }
  return roots.filter((r) => fs.existsSync(r));
}

function collectFiles(roots) {
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) walk(full);
      } else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith('.d.ts') && !TEST_FILE.test(entry.name)) {
        out.push(full);
      }
    }
  };
  roots.forEach(walk);
  return out;
}

function containsJsx(node) {
  let found = false;
  const visit = (n) => {
    if (found || !n || typeof n.type !== 'string') return;
    if (n.type === 'JSXElement' || n.type === 'JSXFragment') { found = true; return; }
    for (const key of Object.keys(n)) {
      if (key === 'loc' || key === 'leadingComments' || key === 'trailingComments' || key === 'innerComments') continue;
      const v = n[key];
      if (Array.isArray(v)) v.forEach(visit);
      else if (v && typeof v.type === 'string') visit(v);
    }
  };
  visit(node);
  return found;
}

function parses(code, kind) {
  const wrapped = kind === 'method' ? `class __W__ {\n${code}\n}` : code;
  // Same tolerance as toEnglish: a method lifted out of its class may use
  // private fields the wrapper doesn't declare; nothing else is forgiven.
  try {
    const ast = parser.parse(wrapped, { sourceType: 'module', plugins: TS_PLUGINS, errorRecovery: true });
    return !(ast.errors || []).some((e) => e.reasonCode !== 'InvalidPrivateFieldResolution');
  } catch {
    return false;
  }
}

// An arrow/function expression bound to a name, rewritten as an equivalent
// FunctionDeclaration so every toEnglish version (including the pin, which
// only ever looked for FunctionDeclaration/ClassMethod) gets the same input.
function asDeclaration(src, name, fn) {
  const head = `${fn.async ? 'async ' : ''}function${fn.generator ? '*' : ''} ${name}`;
  const typeParams = fn.typeParameters ? src.slice(fn.typeParameters.start, fn.typeParameters.end) : '';
  const params = fn.params.length ? src.slice(fn.params[0].start, fn.params[fn.params.length - 1].end) : '';
  const ret = fn.returnType ? src.slice(fn.returnType.start, fn.returnType.end) : '';
  const body = fn.body.type === 'BlockStatement'
    ? src.slice(fn.body.start, fn.body.end)
    : `{\n  return ${src.slice(fn.body.start, fn.body.end)};\n}`;
  return `${head}${typeParams}(${params})${ret} ${body}`;
}

// Every named function in one file: declarations (exported or not, nested or
// not), class/object methods with a body, and arrow/function expressions
// assigned to a variable. One entry per function: { name, kind, code, jsx }.
function extractFunctions(src) {
  const ast = parser.parse(src, { sourceType: 'module', plugins: TS_PLUGINS, errorRecovery: false });
  const fns = [];
  const push = (name, kind, code, node) => {
    if (!parses(code, kind)) return;
    fns.push({ name, kind, code, jsx: containsJsx(node) });
  };
  traverse(ast, {
    FunctionDeclaration(p) {
      const n = p.node;
      if (!n.body) return;
      push(n.id ? n.id.name : '(anonymous)', 'function', src.slice(n.start, n.end), n);
    },
    'ClassMethod|ClassPrivateMethod|ObjectMethod'(p) {
      const n = p.node;
      if (!n.body || (n.decorators && n.decorators.length)) return;
      const name = n.key && (n.key.name || n.key.value || (n.key.id && n.key.id.name));
      push(name || '(computed)', 'method', src.slice(n.start, n.end), n);
    },
    'ArrowFunctionExpression|FunctionExpression'(p) {
      const parent = p.parent;
      if (parent.type !== 'VariableDeclarator' || parent.id.type !== 'Identifier' || parent.init !== p.node) return;
      push(parent.id.name, 'function', asDeclaration(src, parent.id.name, p.node), p.node);
    },
  });
  return fns;
}

function loadCorpus(roots = defaultRoots()) {
  const files = collectFiles(roots);
  const functions = [];
  const unparsedFiles = [];
  const sources = [];
  for (const file of files) {
    const src = fs.readFileSync(file, 'utf8');
    let fns;
    try {
      fns = extractFunctions(src);
    } catch {
      unparsedFiles.push(file);
      continue;
    }
    sources.push({ file, src });
    fns.forEach((f) => functions.push({ ...f, file }));
  }
  return { roots, files, sources, functions, unparsedFiles };
}

function emptyBucket() {
  return {
    functions: 0, throws: 0, clean: 0, steps: 0, chips: 0, placeholders: 0,
    byKind: Object.fromEntries(PLACEHOLDER_KINDS.map((k) => [k, 0])), byType: {},
  };
}

function addTo(bucket, r) {
  bucket.functions++;
  if (r.threw) { bucket.throws++; return; }
  bucket.steps += r.steps;
  bucket.chips += r.chips;
  bucket.placeholders += r.misses.length;
  if (!r.misses.length) bucket.clean++;
  for (const m of r.misses) {
    bucket.byKind[m.kind] = (bucket.byKind[m.kind] || 0) + 1;
    bucket.byType[m.type] = (bucket.byType[m.type] || 0) + 1;
  }
}

function finish(bucket) {
  const rendered = bucket.functions - bucket.throws;
  return {
    ...bucket,
    // placeholders per chip emitted -- the golden test's threshold metric.
    placeholderRate: bucket.chips ? bucket.placeholders / bucket.chips : 0,
    // share of functions that rendered with zero placeholders and no throw.
    cleanRate: bucket.functions ? bucket.clean / bucket.functions : 0,
    throwRate: bucket.functions ? bucket.throws / bucket.functions : 0,
    rendered,
    byType: Object.fromEntries(Object.entries(bucket.byType).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))),
  };
}

// `describe(fn) -> { threw, steps, chips, misses: [{kind, type}] }` is the
// implementation adapter (see impls below), so the same measure() works for
// the pinned toEnglish and the current one.
function measure(functions, describe) {
  const all = emptyBucket();
  const logic = emptyBucket();
  const jsx = emptyBucket();
  for (const fn of functions) {
    const r = describe(fn);
    addTo(all, r);
    addTo(fn.jsx ? jsx : logic, r);
  }
  return { overall: finish(all), logic: finish(logic), jsx: finish(jsx) };
}

// Adapter for the current to-english.js: misses come straight from the
// structured `unhandled` list toEnglish now returns.
function currentDescriber(toEnglish, options = {}) {
  return (fn) => {
    try {
      const res = toEnglish(fn.code, fn.kind, options);
      const chips = res.steps.reduce((n, s) => n + s.tokens.length, 0);
      return { threw: false, steps: res.steps.length, chips, misses: res.unhandled.map((u) => ({ kind: u.kind, type: u.type })) };
    } catch {
      return { threw: true };
    }
  };
}

module.exports = {
  TS_PLUGINS,
  PLACEHOLDER_KINDS,
  DEFAULT_CONSTRUCT,
  defaultRoots,
  collectFiles,
  extractFunctions,
  loadCorpus,
  measure,
  currentDescriber,
};
