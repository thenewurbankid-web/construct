// English -> atoms training set, corpus part (training-data/DESIGN.md, "One record").
// Each non-JSX corpus function goes through the checked converter (bench/atoms/checked.js);
// the English is toEnglish() of the ORIGINAL JavaScript, the program is the converted body.
//
//   recordFor(fn, { converter, types, runs, seed, runtime, origin, allowUntranslated })
//     -> { record } | { dropped: reason, detail }
//   buildDataset({ runs, allowUntranslated }) -> { records, dropped, summary }
//
// A function is kept only when (DESIGN.md, "Corpus rules"):
//   - the check says `same` and at least one rewrite was made
//   - at least half the runs were exercised (the original returned rather than threw)
//   - nothing is left untranslated except syntax the atoms do not cover by design
//     (template literals, optional calls, loops with break: BY_DESIGN)
//   - every atom is called by its own name (a function that is itself named `merged`
//     makes the transform write `mergedAtom`, which is not a catalog name)
//   - every atom form it uses is also right on its own, every argument of its declared
//     type (converter.alone): the whole-function check cannot see a wrong atom that later
//     code hides
//   - toEnglish said every part of it
//   - no earlier record has the same English and program (fixture folders copy files, components repeat handlers)
// The first rule that fails is the reason it is dropped.
//
// `origin` ({repo, file, name}) names the source function, so splits can keep every
// phrasing of one function on the same side.
//
// CLI: node bench/atoms/dataset.js [--runs 40]
//   writes training-data/corpus-atoms.jsonl and training-data/corpus-atoms.summary.json
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const parser = require('@babel/parser');
const { toEnglish } = require('../../to-english');

const PARSE_OPTS = { sourceType: 'module', plugins: ['typescript', 'jsx'] };
const BY_DESIGN = ['TemplateLiteral', 'OptionalCallExpression'];
const LOOPS = new Set(['ForStatement', 'ForOfStatement', 'ForInStatement', 'WhileStatement', 'DoWhileStatement']);
const REASONS = ['not same', 'no rewrite', 'few runs exercised', 'untranslated', 'atom renamed', 'fails alone', 'english incomplete', 'duplicate'];

const byDesign = (u, allow) => allow.includes(u.type) || (LOOPS.has(u.type) && /\bbreak\b/.test(u.reason || ''));

// The function node of `code` (a declaration, or a method lifted out of its class).
function functionOf(code, kind) {
  const wrapped = kind === 'method' ? `class __W__ {\n${code}\n}` : code;
  const ast = parser.parse(wrapped, PARSE_OPTS);
  const first = ast.program.body[0];
  const fn = kind === 'method' ? first.body.body[0] : first.type === 'ExportNamedDeclaration' ? first.declaration : first;
  return { wrapped, fn };
}

// Header as written, up to the body: `function next(state: S): S`, `async load(id)`.
function signatureOf(code, kind) {
  const { wrapped, fn } = functionOf(code, kind);
  return wrapped.slice(fn.start, fn.body.start).trim();
}

// The body's statements without the braces, dedented.
function programOf(code, kind) {
  const { wrapped, fn } = functionOf(code, kind);
  const stmts = fn.body.body;
  if (!stmts.length) return '';
  const indent = stmts[0].loc.start.column;
  return wrapped
    .slice(stmts[0].start, stmts[stmts.length - 1].end)
    .split('\n')
    .map((line, i) => (i === 0 ? line : line.replace(new RegExp(`^ {0,${indent}}`), '')))
    .join('\n');
}

function recordFor(fn, { converter, types, runs = 40, seed = 1, runtime, origin = null, allowUntranslated = BY_DESIGN, paramTypes = null }) {
  const res = converter.convert(fn.code, { kind: fn.kind, types, runs, seed, paramTypes });
  const { status, exercised = 0 } = res.check;
  if (status !== 'same') return { dropped: 'not same', detail: res.check.why || status };
  if (!res.converted) return { dropped: 'no rewrite' };
  if (exercised * 2 < runs) return { dropped: 'few runs exercised', detail: `${exercised} of ${runs}` };
  const left = res.untranslated.filter((u) => !byDesign(u, allowUntranslated));
  if (left.length) return { dropped: 'untranslated', detail: [...new Set(left.map((u) => (u.reason ? `${u.form} (${u.reason})` : u.form)))].join('; ') };
  const renamed = Object.entries(res.atoms).filter(([atom, local]) => atom !== local);
  if (renamed.length) return { dropped: 'atom renamed', detail: renamed.map(([atom, local]) => `${atom} as ${local}`).join(', ') };
  const forms = [...new Map(res.sites.filter((x) => x.atom).map((x) => [`${x.atom}:${x.form}`, x])).values()];
  const failing = forms.map((x) => ({ ...x, alone: converter.alone(x.atom, x.form) })).filter((x) => x.alone.status === 'different');
  if (failing.length) return { dropped: 'fails alone', detail: failing.map((x) => `${x.atom} (${x.alone.cause}) on ${x.alone.probe.input}`).join('; ') };
  const english = toEnglish(fn.code, fn.kind);
  if (english.unhandled.length) return { dropped: 'english incomplete', detail: english.unhandled.map((u) => u.type).join(', ') };
  const program = programOf(res.body, fn.kind);
  return {
    record: {
      id: crypto.createHash('sha1').update(`${english.english}\n${program}`).digest('hex'),
      english: english.english,
      signature: signatureOf(fn.code, fn.kind),
      program,
      atoms: Object.keys(res.atoms).sort(),
      source: 'corpus',
      origin,
      englishKind: 'mechanical',
      check: { status, runs, exercised },
      runtime,
    },
  };
}

// The corpus repository's name from its origin remote (`construct`), else its folder name.
function repoName(dir) {
  try {
    const url = require('child_process').execFileSync('git', ['-C', dir, 'config', '--get', 'remote.origin.url'], { encoding: 'utf8' }).trim();
    if (url) return path.basename(url).replace(/\.git$/, '');
  } catch {}
  return path.basename(dir);
}

async function buildDataset({ runs = 40, allowUntranslated = BY_DESIGN } = {}) {
  const { createCheckedConverter } = require('./checked');
  const { typesOfSource } = require('./equivalence');
  const { typesOfRuntime } = require('./diagnose');
  const { snapshotRuntime, catalogFor, bundleRuntime } = require('./runtime');
  const { loadCorpus } = require('../corpus');
  const snap = snapshotRuntime();
  const runtime = snap.sha.slice(0, 7);
  const { compiled } = catalogFor(snap.dir, snap.sha);
  const converter = await createCheckedConverter({ compiled, bundle: bundleRuntime(snap.dir), runtimeTypes: typesOfRuntime(snap.dir) });
  const corpus = loadCorpus();
  const checker = require('./checker-types').createCheckerTypes();
  const base = corpus.roots.length ? path.dirname(corpus.roots[0]) : '';
  const repo = repoName(base);
  const sources = new Map(corpus.sources.map((s) => [s.file, s.src]));
  const envs = new Map();
  const typesFor = (file) => {
    if (!envs.has(file)) envs.set(file, typesOfSource(sources.get(file) || ''));
    return envs.get(file);
  };
  // same seed per function as checkedCorpus, so both see the same inputs
  const hash = (s) => [...s].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 7);
  const records = [];
  const dropped = [];
  const ids = new Set();
  let jsx = 0;
  try {
    for (const f of corpus.functions) {
      if (f.jsx) { jsx++; continue; }
      const where = { name: f.name, file: path.relative(base, f.file) };
      const out = recordFor(f, { converter, types: typesFor(f.file), runs, seed: hash(f.name), runtime, origin: { repo, file: where.file, name: where.name }, allowUntranslated, paramTypes: checker.paramTypes(f.file, f.code) });
      if (out.dropped) dropped.push({ ...where, reason: out.dropped, detail: out.detail });
      else if (ids.has(out.record.id)) dropped.push({ ...where, reason: 'duplicate', detail: out.record.id });
      else { ids.add(out.record.id); records.push(out.record); }
    }
  } finally {
    converter.dispose();
  }
  const byReason = Object.fromEntries(REASONS.map((r) => [r, dropped.filter((d) => d.reason === r).length]).filter(([, n]) => n));
  const summary = { runtime, runs, allowUntranslated, functions: records.length + dropped.length, jsxSkipped: jsx, kept: records.length, dropped: dropped.length, byReason };
  return { records, dropped, summary };
}

if (require.main === module) {
  const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : fallback; };
  const dir = path.join(__dirname, '..', '..', 'training-data');
  buildDataset({ runs: Number(arg('--runs', 40)) }).then(({ records, dropped, summary }) => {
    fs.writeFileSync(path.join(dir, 'corpus-atoms.jsonl'), records.map((r) => JSON.stringify(r)).join('\n') + '\n');
    fs.writeFileSync(path.join(dir, 'corpus-atoms.summary.json'), `${JSON.stringify({ summary, dropped }, null, 1)}\n`);
    console.log(JSON.stringify(summary, null, 1));
  });
}

module.exports = { recordFor, buildDataset, signatureOf, programOf, BY_DESIGN };
