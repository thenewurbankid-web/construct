// Coverage of the JS -> atoms codemod over the JavaScript reference (task t2-3a-coverage,
// docs/line/FLUENT-PLAN-2026-10-15.md "Wave 2 leaves"). Deterministic, no model.
//
//   coverage({ sections, limit, entries }) -> {   (an entry with `source` skips the map.json lookup)
//     total, converts, refused, untranslated,
//     bySection: { <section>: { total, converts, refused, untranslated } },
//     results: [{ id, key, section, outcome, converted, untranslated, reasons }]
//   }
//
// For each C1 entry (reference.json `entries[]`): map.json (keyed by entry `key`, unique per overload) gives the file under input/ and
// the function name; that function's declaration (without `export`) is cut out of the file
// and passed to toAtoms (line-codemod atoms-transform.js) with the Smith catalog
// (packages/line-smith/src/atoms/catalog.json via atoms-catalog.js loadCatalog), kind 'module'.
//
// Outcome rule, from toAtoms' result shape {converted, untranslated: [{type, form, reason?}]},
// first match wins:
//   refused       toAtoms throws, OR the entry has no reference function (not in map.json,
//                 or the function is not found in its file), OR any `untranslated` item
//                 carries a `reason` (toAtoms recognised the form but declined it: 'mutates',
//                 'no copy-returning atom', 'ambiguous type', 'inside an optional chain',
//                 'labeled statement', a statement it cannot restructure, ...).
//   untranslated  `untranslated` is non-empty (only items without a reason: JS with no
//                 catalog entry is left as it is), OR `converted === 0` (no atom call in the
//                 result: nothing was rewritten, e.g. an empty body or a bare return).
//   converts      `converted > 0` and `untranslated` is empty: atom calls, no JS left.
// Plain syntax that toAtoms keeps by design (return, function, destructuring, literals,
// identifiers) is not "JS left": toAtoms does not record it, so it does not count against.
//
// CLI: node packages/line-fluent/coverage/coverage.mjs [--section X]... [--limit N] [--out FILE]
// prints a table and writes packages/line-fluent/coverage/latest.json (totals + bySection;
// git-ignored: a local run result, not a recorded baseline).

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');
const CODEMOD = path.join(ROOT, 'packages', 'line-codemod');
const REF_DIR = path.join(CODEMOD, 'bench', 'atoms', 'js-reference');
const CATALOG_PATH = path.join(ROOT, 'packages', 'line-smith', 'src', 'atoms', 'catalog.json');

const parser = createRequire(path.join(CODEMOD, 'package.json'))('@babel/parser');
const { toAtoms } = require(path.join(CODEMOD, 'atoms-transform.js'));
const { loadCatalog } = require(path.join(CODEMOD, 'atoms-catalog.js'));

export const OUTCOMES = ['converts', 'refused', 'untranslated'];

let cache = null;
function load() {
  if (cache) return cache;
  const reference = JSON.parse(fs.readFileSync(path.join(REF_DIR, 'reference.json'), 'utf8'));
  const { map } = JSON.parse(fs.readFileSync(path.join(REF_DIR, 'map.json'), 'utf8'));
  cache = { entries: reference.entries, map, catalog: loadCatalog(CATALOG_PATH), files: new Map() };
  return cache;
}

// file -> Map(fnName -> function declaration source)
function functionsOf(file) {
  const { files } = load();
  if (files.has(file)) return files.get(file);
  const src = fs.readFileSync(path.join(REF_DIR, 'input', file), 'utf8');
  const ast = parser.parse(src, { sourceType: file.endsWith('.cjs') ? 'script' : 'module', errorRecovery: true });
  const fns = new Map();
  for (const st of ast.program.body) {
    const d = st.type === 'ExportNamedDeclaration' ? st.declaration : st;
    if (d && d.type === 'FunctionDeclaration' && d.id) fns.set(d.id.name, src.slice(d.start, d.end));
    // CommonJS (sloppy.cjs): exports.name = function () { ... };
    const a = st.type === 'ExpressionStatement' && st.expression.type === 'AssignmentExpression' ? st.expression : null;
    if (a && a.left.type === 'MemberExpression' && a.left.object.name === 'exports' && /Function/.test(a.right.type)) {
      fns.set(a.left.property.name, src.slice(st.start, st.end));
    }
  }
  files.set(file, fns);
  return fns;
}

export function referenceSource(key) {
  const { map } = load();
  const m = map[key];
  if (!m) return null;
  return functionsOf(m.file).get(m.fn) || null;
}

// One source string -> {outcome, converted, untranslated, reasons}.
export function classify(source) {
  if (source == null) return { outcome: 'refused', converted: 0, untranslated: 0, reasons: ['no reference function'] };
  let res;
  try {
    res = toAtoms(source, { catalog: load().catalog });
  } catch (err) {
    return { outcome: 'refused', converted: 0, untranslated: 0, reasons: [`threw: ${err.message.split('\n')[0]}`] };
  }
  const reasons = [...new Set(res.untranslated.filter((u) => u.reason).map((u) => u.reason))];
  const left = res.untranslated.length;
  let outcome;
  if (reasons.length) outcome = 'refused';
  else if (left || res.converted === 0) outcome = 'untranslated';
  else outcome = 'converts';
  return { outcome, converted: res.converted, untranslated: left, reasons };
}

const zero = () => ({ total: 0, converts: 0, refused: 0, untranslated: 0 });

export function coverage({ sections = null, limit = null, entries = null } = {}) {
  let list = entries || load().entries;
  if (sections && sections.length) {
    const want = new Set(sections);
    list = list.filter((e) => want.has(e.section));
  }
  if (limit != null) list = list.slice(0, limit);
  const out = { ...zero(), bySection: {}, results: [] };
  for (const e of list) {
    const r = classify(e.source !== undefined ? e.source : referenceSource(e.key || e.id));
    const s = (out.bySection[e.section] ||= zero());
    out.total++; s.total++;
    out[r.outcome]++; s[r.outcome]++;
    out.results.push({ id: e.id, key: e.key, section: e.section, ...r });
  }
  return out;
}

function table(res) {
  const rows = [['section', 'total', 'converts', 'refused', 'untranslated']];
  for (const [name, s] of Object.entries(res.bySection).sort((a, b) => b[1].total - a[1].total || a[0].localeCompare(b[0]))) {
    rows.push([name, s.total, s.converts, s.refused, s.untranslated]);
  }
  rows.push(['TOTAL', res.total, res.converts, res.refused, res.untranslated]);
  const w = rows[0].map((_, i) => Math.max(...rows.map((r) => String(r[i]).length)));
  return rows.map((r) => r.map((c, i) => (i ? String(c).padStart(w[i]) : String(c).padEnd(w[i]))).join('  ')).join('\n');
}

// coverage() result -> the latest.json record (no per-entry results).
export function record(res, filter = { sections: [], limit: null }) {
  const { results, ...summary } = res;
  const reasons = {};
  for (const r of results) for (const why of r.reasons) reasons[why] = (reasons[why] || 0) + 1;
  return { $comment: 'GENERATED by coverage.mjs: toAtoms outcome per C1 reference entry. Rule in the module header.', filter, ...summary, refusalReasons: reasons };
}

export function writeRecord(res, filter, file = path.join(HERE, 'latest.json')) {
  fs.writeFileSync(file, `${JSON.stringify(record(res, filter), null, 2)}\n`);
  return file;
}

export { table };

function main(argv) {
  const sections = [];
  let limit = null;
  let out;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--section') sections.push(argv[++i]);
    else if (argv[i] === '--limit') limit = Number(argv[++i]);
    else if (argv[i] === '--out') out = argv[++i];
    else throw new Error(`unknown argument: ${argv[i]} (use --section X, --limit N, --out FILE)`);
  }
  const res = coverage({ sections, limit });
  console.log(table(res));
  writeRecord(res, { sections, limit }, out);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
