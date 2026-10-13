#!/usr/bin/env node
// Smith coverage harness: how much of a real TS/TSX corpus can toEnglish()
// say in plain English, and where does it fall back to a placeholder?
//
// Counts three placeholder shapes per node type:
//   expr    -- an expression rendered as "(...)"
//   stmt    -- a statement rendered as "(a step that does not translate cleanly)"
//   pattern -- a param/binding pattern rendered as "?"
// plus functions toEnglish threw on (or found nothing to describe in).
//
// Usage (from this repo's root):
//   node bench/coverage.mjs                    # current to-english.js
//   node bench/coverage.mjs --impl=pin         # the pinned 885b32e to-english.js, as shipped
//   node bench/coverage.mjs --impl=pin-ts      # the pin, with only its parse switched to TS+JSX
//   node bench/coverage.mjs --json             # machine-readable summary
//   SMITH_CORPUS=/path/to/construct node bench/coverage.mjs
//
// Read-only on the corpus; no model calls; deterministic.
import { createRequire, Module } from 'node:module';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const corpus = require('./corpus.js');
const PIN = '885b32e6c7105eab317ae9f1e5e6ae9643da010b';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, v] = a.replace(/^--/, '').split('=');
  return [k, v === undefined ? true : v];
}));
const impl = args.impl || 'current';

// The pinned to-english.js, loaded from git and instrumented: each of its
// three fallback branches records (kind, node.type) before returning the
// same placeholder it always did. Its own output is otherwise unchanged.
function pinDescriber(withTs) {
  let src = execFileSync('git', ['-C', ROOT, 'show', `${PIN}:to-english.js`], { encoding: 'utf8' });
  const swaps = [
    ["    default:\n      return '(...)';", "    default:\n      __miss('expr', node);\n      return '(...)';"],
    ["      return '(a step that does not translate cleanly)';", "      __miss('stmt', node);\n      return '(a step that does not translate cleanly)';"],
    ["  return '?';\n}", "  __miss('pattern', id);\n  return '?';\n}"],
  ];
  for (const [from, to] of swaps) {
    if (!src.includes(from)) throw new Error(`pin instrumentation anchor missing: ${from}`);
    src = src.replace(from, to);
  }
  src = src.replaceAll("params = path.node.params.map((p) => p.name || '?');", "params = path.node.params.map((p) => p.name || (__miss('pattern', p), '?'));");
  if (withTs) {
    const from = "const ast = parser.parse(wrapped, { sourceType: 'module' });\n  let name = null;";
    if (!src.includes(from)) throw new Error('pin parse anchor missing');
    src = src.replace(from, "const ast = parser.parse(wrapped, { sourceType: 'module', plugins: ['typescript', 'jsx'] });\n  let name = null;");
  }
  src = `let __misses = [];\nfunction __miss(kind, node) { __misses.push({ kind, type: node ? node.type : 'unknown' }); }\n${src}\nmodule.exports.__take = () => { const m = __misses; __misses = []; return m; };\n`;
  const filename = path.join(ROOT, 'to-english.pin.js');
  const mod = new Module(filename);
  mod.filename = filename;
  mod.paths = Module._nodeModulePaths(ROOT);
  mod._compile(src, filename);
  const pin = mod.exports;
  return (fn) => {
    pin.__take();
    try {
      const res = pin.toEnglish(fn.code, fn.kind);
      const misses = pin.__take();
      if (res.title === null) return { threw: true };
      const chips = res.steps.reduce((n, s) => n + s.tokens.length, 0);
      return { threw: false, steps: res.steps.length, chips, misses };
    } catch {
      pin.__take();
      return { threw: true };
    }
  };
}

function describer() {
  if (impl === 'pin') return pinDescriber(false);
  if (impl === 'pin-ts') return pinDescriber(true);
  const { toEnglish } = require(path.join(ROOT, 'to-english.js'));
  return corpus.currentDescriber(toEnglish);
}

const { roots, files, functions, unparsedFiles } = corpus.loadCorpus(args.corpus ? corpus.defaultRoots(args.corpus) : corpus.defaultRoots());
if (!files.length) {
  console.error('no corpus found -- set SMITH_CORPUS or --corpus=<construct checkout>');
  process.exit(2);
}
const result = corpus.measure(functions, describer());
const summary = {
  impl,
  corpus: { roots, files: files.length, unparsedFiles: unparsedFiles.length, functions: functions.length },
  ...result,
};

if (args.json) {
  console.log(JSON.stringify(summary, null, 2));
} else {
  const pct = (x) => `${(x * 100).toFixed(2)}%`;
  console.log(`impl=${impl}  files=${files.length} (unparsed ${unparsedFiles.length})  functions=${functions.length}`);
  for (const scope of ['overall', 'logic', 'jsx']) {
    const b = result[scope];
    console.log(`\n[${scope}] functions=${b.functions} throws=${b.throws} clean=${b.clean} (${pct(b.cleanRate)}) steps=${b.steps} chips=${b.chips}`);
    console.log(`  placeholders=${b.placeholders} rate=${pct(b.placeholderRate)} per chip  expr=${b.byKind.expr} stmt=${b.byKind.stmt} pattern=${b.byKind.pattern}`);
    const top = Object.entries(b.byType).slice(0, Number(args.top || 12));
    for (const [type, n] of top) console.log(`    ${String(n).padStart(6)}  ${type}`);
  }
}
