// #940 Smith System 1 -- the collectors: each reads one source from the repo (read-only) and returns candidate pairs
// (lib.mjs makePair) plus its own counts. Sources:
//   atoms            packages/line-atoms: each atom's `english` + its entry function's code (en->js)
//   typed-contracts  packages/core/typed-contracts/examples: each define<Layer>() unit, English from the factory
//                    call and its leading comment (js->en); the deliberately non-compiling `*invalid*` files skipped
//   probe            bench/lending/results/context-probe-r1.json: the step text -> the code of every sample that
//                    passed tsc and was useful (en->js). Read-only: context-probe.mjs is never imported (it calls Ollama)
//   smith            Smith's own non-empty translations (packages/summarize/links.mjs summarizeCode, atomic-codemod's
//                    to-english) of every top-level function in the fixture/example roots below (js->en)
//   ledger           the held-out eval set: the hand-written ledger facts of the probe's winning contexts (L+tools,
//                    CL), each paired with the code its citation names (js->en)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makePair, normalizeCode, sha256, ts } from './lib.mjs';

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const rel = (f) => path.relative(REPO, f).split(path.sep).join('/');
const read = (f) => fs.readFileSync(f, 'utf8');

/** Fixture/example roots Smith translates. Sorted walk, node_modules/.next/dist skipped. */
export const SMITH_ROOTS = Object.freeze([
  'bench/ecommerce/starter', 'bench/ecommerce/starter-plain', 'bench/lending/starter', 'bench/lending/starter-plain',
  'example', 'examples', 'packages/core/profiles/line/fixtures', 'packages/core/rules/fixtures',
  'packages/line-atoms/atoms', 'test/fixtures', 'trace/examples',
]);
export const PROBE_JSON = 'bench/lending/results/context-probe-r1.json';
export const PROBE_MD = 'bench/lending/CONTEXT-PROBE.md';
export const CONTRACT_EXAMPLES = 'packages/core/typed-contracts/examples';
/** The probe's project was a copy of this starter: library files resolve here. */
export const LENDING_STARTER = 'bench/lending/starter';
const CODE_EXT = /\.(ts|tsx|js|jsx|mjs)$/;
const MAX_BYTES = 64 * 1024;

// ---------- code helpers ----------

/** TS/TSX/JS -> JS with JSX kept (types removed). */
export function toJs(code, fileName = 'x.tsx') {
  const jsx = /\.(tsx|jsx)$/.test(fileName) || /\.m?js$/.test(fileName);
  return ts.transpileModule(code, {
    fileName: jsx ? fileName.replace(/\.(m?js)$/, '.jsx') : fileName,
    compilerOptions: { jsx: ts.JsxEmit.Preserve, target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext, removeComments: false },
    reportDiagnostics: false,
  }).outputText;
}

const stripExport = (s) => s.replace(/^export\s+(default\s+)?/, '');

/**
 * The top-level functions of a JS (JSX kept) file, as standalone code: function declarations as written, a
 * `const f = (..) => ..` / `const f = function (..) {..}` rewritten as `function f(..) {..}`, class methods as the method.
 * @param {string} js
 * @returns {{name: string, kind: 'function'|'method', code: string, fromArrow?: boolean}[]}
 */
export function functionsOf(js) {
  const sf = ts.createSourceFile('x.jsx', js, ts.ScriptTarget.ES2020, true, ts.ScriptKind.JSX);
  const out = [];
  for (const st of sf.statements) {
    if (ts.isFunctionDeclaration(st) && st.body) {
      out.push({ name: st.name?.text ?? 'default', kind: 'function', code: stripExport(st.getText(sf)) });
    } else if (ts.isVariableStatement(st) && st.declarationList.declarations.length === 1) {
      const d = st.declarationList.declarations[0];
      const init = d.initializer;
      if (!ts.isIdentifier(d.name) || !init || !(ts.isArrowFunction(init) || ts.isFunctionExpression(init))) continue;
      const isAsync = init.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword);
      const params = init.parameters.map((p) => p.getText(sf)).join(', ');
      const body = ts.isBlock(init.body) ? init.body.getText(sf) : `{\n  return ${init.body.getText(sf)};\n}`;
      out.push({ name: d.name.text, kind: 'function', code: `${isAsync ? 'async ' : ''}function ${d.name.text}(${params}) ${body}`, fromArrow: true });
    } else if (ts.isClassDeclaration(st)) {
      for (const m of st.members) {
        if (ts.isMethodDeclaration(m) && m.body && ts.isIdentifier(m.name)) out.push({ name: `${st.name?.text ?? 'Class'}.${m.name.text}`, kind: 'method', code: m.getText(sf) });
      }
    }
  }
  return out;
}

/** What Smith reads: the same function with JSX turned into React.createElement (Smith's parser has no JSX). */
export function smithInput(fn) {
  const wrap = fn.kind === 'method' ? `class __W__ {\n${fn.code}\n}` : fn.code;
  const out = ts.transpileModule(wrap, { fileName: 'x.jsx', compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext }, reportDiagnostics: false }).outputText.trim();
  if (fn.kind !== 'method') return out;
  const sf = ts.createSourceFile('x.js', out, ts.ScriptTarget.ES2020, true, ts.ScriptKind.JS);
  const cls = sf.statements.find(ts.isClassDeclaration);
  return cls?.members[0]?.getText(sf) ?? out;
}

/** Sorted recursive list of code files under a root (repo-relative paths). */
export function walk(root) {
  const abs = path.join(REPO, root);
  if (!fs.existsSync(abs)) return [];
  const out = [];
  const go = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      if (e.name.startsWith('.') || ['node_modules', 'dist', 'build', 'out'].includes(e.name)) continue;
      const f = path.join(dir, e.name);
      if (e.isDirectory()) go(f);
      else if (CODE_EXT.test(e.name) && !/\.d\.ts$|\.test\.|\.spec\./.test(e.name) && fs.statSync(f).size <= MAX_BYTES) out.push(rel(f));
    }
  };
  go(abs);
  return out;
}

// ---------- atoms ----------

export async function atomPairs() {
  const { listAtoms, ATOMS_DIR } = await import('../../line-atoms/index.mjs');
  const pairs = [];
  const missing = [];
  for (const a of listAtoms()) {
    const file = path.join(ATOMS_DIR, a.id, 'index.ts');
    const fn = fs.existsSync(file) ? functionsOf(toJs(read(file), 'index.ts')).find((f) => f.name === a.name) : null;
    if (!fn) { missing.push(a.id); continue; }
    pairs.push(makePair({ source: 'atoms', direction: 'en->js', code: fn.code, english: a.english, meta: { atom: a.id, file: rel(file), name: a.name, role: a.role } }));
  }
  return { pairs, counts: { atoms: listAtoms().length, atomsWithoutEntryFunction: missing } };
}

// ---------- typed-contract examples ----------

/** A comment's text, cleaned: markers, separator rules and issue refs removed. */
function commentText(src, pos) {
  const ranges = ts.getLeadingCommentRanges(src, pos) ?? [];
  const lines = [];
  for (const r of ranges) {
    for (let line of src.slice(r.pos, r.end).split('\n')) {
      line = line.replace(/^\s*(\/\/+|\/\*+|\*+\/?|\*)\s?/, '').replace(/\*\/\s*$/, '').trim();
      if (!line || /^[-=]{2,}/.test(line) || /^-+\s*\w+\s*-+$/.test(line)) continue;
      lines.push(line);
    }
  }
  return lines.join(' ').replace(/#\d+(\/#\d+)*\s*/g, '').replace(/\s+/g, ' ').trim();
}

export function contractPairs() {
  const dir = path.join(REPO, CONTRACT_EXAMPLES);
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.ts')).sort();
  const pairs = [];
  const skipped = [];
  for (const f of files) {
    if (/invalid/.test(f)) { skipped.push(f); continue; }
    const src = read(path.join(dir, f));
    const sf = ts.createSourceFile(f, src, ts.ScriptTarget.ES2020, true, ts.ScriptKind.TS);
    for (const st of sf.statements) {
      if (!ts.isVariableStatement(st) || st.declarationList.declarations.length !== 1) continue;
      const d = st.declarationList.declarations[0];
      const call = d.initializer;
      if (!ts.isIdentifier(d.name) || !call || !ts.isCallExpression(call) || !ts.isIdentifier(call.expression)) continue;
      const m = /^define([A-Z]\w*)$/.exec(call.expression.text);
      if (!m) continue;
      const layer = m[1].toLowerCase();
      const unit = call.arguments[0] && ts.isStringLiteral(call.arguments[0]) ? call.arguments[0].text : d.name.text;
      const [props, ret] = (call.typeArguments ?? []).map((t) => t.getText(sf).replace(/\s+/g, ' '));
      const comment = commentText(src, st.getFullStart());
      const english = [
        `Define the ${layer} unit "${unit}"${props ? ` with props ${props}` : ''}${ret ? `, returning ${ret}` : ''}.`,
        comment,
      ].filter(Boolean).join(' ');
      const code = stripExport(toJs(st.getText(sf), 'unit.ts').trim());
      pairs.push(makePair({ source: 'typed-contracts', direction: 'js->en', code, english, meta: { file: `${CONTRACT_EXAMPLES}/${f}`, layer, name: unit } }));
    }
  }
  return { pairs, counts: { contractFiles: files.length, contractFilesSkippedInvalid: skipped } };
}

// ---------- context probe (read-only) ----------

export const readProbe = () => JSON.parse(read(path.join(REPO, PROBE_JSON)));

/** The probe's markdown tables as row objects keyed by header. */
export function probeTables(md = read(path.join(REPO, PROBE_MD))) {
  const rows = [];
  let header = null;
  for (const line of md.split('\n')) {
    if (!line.startsWith('|')) { header = null; continue; }
    const cells = line.split('|').slice(1, -1).map((c) => c.trim());
    if (cells.every((c) => /^-+$/.test(c))) continue;
    if (!header) { header = cells; continue; }
    rows.push(Object.fromEntries(header.map((h, i) => [h, cells[i]])));
  }
  return rows;
}

const x5 = (s) => Number(/^(\d)\/5$/.exec(s ?? '')?.[1] ?? -1);

/**
 * The contexts that won the probe, read from its markdown: L+tools (case 1, useful pass) and CL (case 2, ListPage
 * pick), each with its best score. Throws if the markdown no longer says they won (>= 4/5), so the eval set cannot
 * silently drift from the probe's result.
 */
export function probeWinners(md) {
  const rows = probeTables(md);
  const best = (variant, col) => Math.max(...rows.filter((r) => r.variant === variant && col in r).map((r) => x5(r[col])));
  const won = { 'L+tools': best('L+tools', 'useful pass x/5'), CL: best('CL', 'ListPage pick (valid plan_add) x/5') };
  for (const [v, n] of Object.entries(won)) if (!(n >= 4)) throw new Error(`probe: ${v} no longer wins (${n}/5) in ${PROBE_MD}`);
  return won;
}

/** Every ```tsx block the probe's prompts show under a file path (JSON-escaped tool contents included), first wins. */
export function probeCodeBlocks(probe) {
  const blocks = new Map();
  const keys = Object.keys(probe.prompts).sort((a, b) => (a.startsWith('L@') ? -1 : 0) - (b.startsWith('L@') ? -1 : 0) || (a < b ? -1 : a > b ? 1 : 0));
  for (const k of keys) {
    const t = probe.prompts[k].last;
    for (const text of [t, t.replace(/\\\\/g, '\u0000').replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\u0000/g, '\\')]) {
      for (const m of text.matchAll(/([\w/.-]+\.tsx)[^\n`]*:\n```tsx\n([\s\S]*?)```/g)) if (!blocks.has(m[1])) blocks.set(m[1], { code: m[2], prompt: k });
    }
  }
  return blocks;
}

/** The "Facts so far" ledger of one prompt: [{fact, cite}]. */
export function ledgerOf(text) {
  const start = text.indexOf('Facts so far');
  if (start < 0) return [];
  const block = text.slice(start).split('\n\n')[0];
  return block.split('\n').slice(1).map((l) => /^- (.*) \[([^\]]*)\]$/.exec(l)).filter(Boolean).map((m) => ({ fact: m[1], cite: m[2] }));
}

/**
 * Held-out eval: the ledger facts of the winning L and CL prompts. A fact gets code when it (or its citation) names
 * .tsx files we have (slice `ledger-probe`): library files from the lending starter, feature files from the probe's
 * own prompts; a citation of the `library/pages` folder means its three pages. A fact that names no existing code
 * takes its hand-written target from eval-facts.json (slice `ledger-written`). Throws when eval-facts.json holds a
 * fact the probe does not have (the two drifted apart).
 */
export function ledgerEval(probe = readProbe(), md = undefined) {
  const won = probeWinners(md);
  const blocks = probeCodeBlocks(probe);
  const written = new Map(JSON.parse(read(path.join(REPO, EVAL_FACTS_FILE))).facts.map((f) => [f.fact, f]));
  const used = new Set();
  const resolve = (p) => {
    const starter = path.join(REPO, LENDING_STARTER, p);
    if (p.startsWith('library/') && fs.existsSync(starter)) return { code: read(starter), from: `${LENDING_STARTER}/${p}` };
    const b = blocks.get(p);
    return b ? { code: b.code, from: `${PROBE_JSON}#prompts.${b.prompt}` } : null;
  };
  const pairs = [];
  const unresolved = [];
  const ledgers = [['L', 'L@qwen2.5-coder:7b', 'L+tools'], ['CL', 'CL@qwen2.5-coder:7b', 'CL']];
  for (const [name, key, winner] of ledgers) {
    for (const { fact, cite } of ledgerOf(probe.prompts[key].last)) {
      let files = [...new Set([...`${fact} ${cite}`.matchAll(/(?:features|library)\/[\w/.-]+\.tsx/g)].map((m) => m[0]))];
      if (!files.length && /(^|;\s*)library\/pages$/.test(cite)) files = ['library/pages/ListPage.tsx', 'library/pages/DetailPage.tsx', 'library/pages/FormPage.tsx'];
      const got = files.map(resolve);
      if (!files.length || got.some((g) => !g)) {
        const w = written.get(fact);
        if (!w) { unresolved.push({ ledger: name, fact }); continue; }
        used.add(fact);
        const js = toJs(w.code.join('\n'), path.basename(w.file).replace(/\.js$/, '.jsx')).trim();
        const fns = functionsOf(js);
        pairs.push(makePair({
          source: 'ledger', direction: 'js->en', code: js, english: fact,
          meta: { cite, files: [w.file], from: [EVAL_FACTS_FILE], ledger: name, names: fns.map((f) => f.name), parts: fns.map((f) => f.code), slice: 'ledger-written', wonBy: `${winner} ${won[winner]}/5` },
        }));
        continue;
      }
      const parts = got.map((g, i) => toJs(g.code, path.basename(files[i])).trim());
      const fnParts = parts.flatMap((js) => functionsOf(js).map((f) => f.code));
      pairs.push(makePair({
        source: 'ledger', direction: 'js->en', code: parts.join('\n\n'), english: fact,
        meta: { cite, files, from: got.map((g) => g.from), ledger: name, names: parts.flatMap((js) => functionsOf(js).map((f) => f.name)), parts: [...parts, ...fnParts], slice: 'ledger-probe', wonBy: `${winner} ${won[winner]}/5` },
      }));
    }
  }
  const stray = [...written.keys()].filter((f) => !used.has(f));
  if (stray.length) throw new Error(`${EVAL_FACTS_FILE}: not a codeless probe ledger fact: ${stray.join(' | ')}`);
  return { pairs, counts: { ledgerFacts: pairs.length + unresolved.length, ledgerFactsWithoutCode: unresolved.length }, unresolvedFacts: unresolved.map((u) => u.fact) };
}

export const EVAL_FACTS_FILE = 'packages/tools/smith-system1/eval-facts.json';

/** The React-page eval slice from eval-pages.json (slice `pages`): a page/component Smith left empty -> hand-written English. */
export function pagesEval() {
  const doc = JSON.parse(read(path.join(REPO, EVAL_PAGES_FILE)));
  const pairs = doc.pages.map((p) => makePair({
    source: 'ledger', direction: 'js->en', code: p.code, english: p.english,
    meta: { files: [p.file], from: [EVAL_PAGES_FILE], names: [p.name], parts: [p.code], slice: 'pages' },
  }));
  return { pairs, entries: doc.pages };
}

/** Probe samples: the step's point text -> each sample's code that passed tsc and was useful. */
export function probePairs(probe = readProbe()) {
  const step = /Current step: (PCK-\d+: [^\n]*?) Write it in/.exec(probe.prompts['L@qwen2.5-coder:7b'].last)?.[1];
  const pairs = [];
  let useful = 0;
  for (const s of probe.samples) {
    if (!s.score?.usefulPass || !s.score?.tscPass || !s.score?.code || s.case !== 1) continue;
    useful += 1;
    pairs.push(makePair({ source: 'probe', direction: 'en->js', code: toJs(s.score.code, 'PicksPage.tsx').trim(), english: step, meta: { file: 'features/picks/pages/PicksPage.tsx', model: s.model, seed: s.seed, variant: s.variant } }));
  }
  return { pairs, counts: { probeSamples: probe.samples.length, probeUsefulPass: useful } };
}

// ---------- Smith ----------

/** Words left once Smith's placeholders ("(...)", "?") and punctuation are removed. */
export const contentWords = (english) => english.replace(/\(\.\.\.\)|\?/g, ' ').replace(/[^\w'\s]/g, ' ').split(/\s+/).filter(Boolean);

/** Smith's stock words: they say how the code is laid out, not what it does. */
const STOCK = new Set('it returns return and react create element nothing let be if not then the a of is works in step steps using'.split(' '));
/** An output is placeholder-dominated (empty) when it has at least this many "(...)" per meaningful word. */
export const PLACEHOLDER_EMPTY_RATIO = 0.5;

/**
 * Why a Smith output counts as empty, or null when it carries meaning: `blank` (fewer than 3 words once the
 * placeholders go) or `placeholder` (after the title sentence, at least one "(...)" per two meaningful words: e.g.
 * "Next using state works in 1 step. It returns (...)", or a React page whose every prop and child is "(...)").
 * @param {string} english
 * @returns {null|'blank'|'placeholder'}
 */
export function smithEmptyReason(english) {
  if (contentWords(english).length < 3) return 'blank';
  const body = english.split(/(?<=\.)\s+/).slice(1).join(' ');
  const placeholders = (body.match(/\(\.\.\.\)/g) ?? []).length;
  const meaningful = contentWords(body).map((w) => w.replace(/\W/g, '').toLowerCase()).filter((w) => w && !STOCK.has(w)).length;
  return placeholders > 0 && placeholders >= PLACEHOLDER_EMPTY_RATIO * Math.max(1, meaningful) ? 'placeholder' : null;
}

/**
 * Smith's translation of every top-level function under SMITH_ROOTS. Empty outputs are skipped and counted:
 * `failed` (Smith not linked, or it could not read the code), `blank` and `placeholder` (smithEmptyReason).
 * @param {{roots?: readonly string[], summarizeCode?: Function}} [o] summarizeCode is injectable for tests.
 */
export async function smithPairs(o = {}) {
  const roots = o.roots ?? SMITH_ROOTS;
  let summarizeCode = o.summarizeCode;
  let linked = true;
  let linkMessage = null;
  if (!summarizeCode) {
    const links = await import('../../summarize/links.mjs');
    const st = links.smithLinks().codemod;
    linked = !!st.ok;
    linkMessage = st.message ?? null;
    summarizeCode = links.summarizeCode;
  }
  const counts = { smithFiles: 0, smithFunctions: 0, smithEmpty: { failed: 0, blank: 0, placeholder: 0, total: 0 }, smithNonEmpty: 0, smithLinked: linked, smithLink: linkMessage };
  const pairs = [];
  const skipped = [];
  if (!linked) return { pairs, counts, skipped };
  for (const root of roots) {
    for (const file of walk(root)) {
      counts.smithFiles += 1;
      let fns;
      try { fns = functionsOf(toJs(read(path.join(REPO, file)), path.basename(file))); } catch { continue; }
      for (const fn of fns) {
        counts.smithFunctions += 1;
        const s = await summarizeCode(smithInput(fn), { kind: fn.kind });
        const english = (s.sentences ?? []).join(' ').trim();
        if (s.via === 'static' && s.details?.some((d) => d.label === 'Why')) { counts.smithEmpty.failed += 1; continue; }
        const empty = smithEmptyReason(english);
        if (empty) { counts.smithEmpty[empty] += 1; skipped.push({ file, name: fn.name, kind: fn.kind, code: fn.code, reason: empty }); continue; }
        counts.smithNonEmpty += 1;
        pairs.push(makePair({ source: 'smith', direction: 'js->en', code: fn.code, english, meta: { file, fromArrow: !!fn.fromArrow, kind: fn.kind, name: fn.name, placeholders: (english.match(/\(\.\.\.\)/g) ?? []).length } }));
      }
    }
  }
  counts.smithEmpty.total = counts.smithEmpty.failed + counts.smithEmpty.blank + counts.smithEmpty.placeholder;
  return { pairs, counts, skipped };
}

// ---------- React-page eval slice ----------

export const EVAL_PAGES_FILE = 'packages/tools/smith-system1/eval-pages.json';
/** Longest page/component code the slice takes (chars): a hand-written English target stays one short paragraph. */
export const PAGE_MAX_CHARS = 2000;

/**
 * The deterministic pick for the React-page eval slice, from the functions Smith left empty: components (capitalized
 * name, JSX in the body, at most PAGE_MAX_CHARS), one per normalized code, spread across folders: folders in
 * sha256 order, one function per folder per round (sha256 of its normalized code), until `n`.
 * @param {{file: string, name: string, kind: string, code: string}[]} skipped smithPairs().skipped
 */
export function pickPages(skipped, n = 15) {
  const seen = new Set();
  const groups = new Map();
  for (const s of skipped) {
    if (s.kind !== 'function' || !/^[A-Z]/.test(s.name) || !/<[A-Za-z>]/.test(s.code) || s.code.length > PAGE_MAX_CHARS) continue;
    const key = normalizeCode(s.code);
    if (seen.has(key)) continue;
    seen.add(key);
    const g = path.posix.dirname(s.file);
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push({ ...s, h: sha256(key) });
  }
  const order = [...groups.keys()].sort((a, b) => (sha256(a) < sha256(b) ? -1 : 1));
  for (const g of order) groups.get(g).sort((a, b) => (a.h < b.h ? -1 : 1));
  const out = [];
  for (let round = 0; out.length < n; round += 1) {
    const before = out.length;
    for (const g of order) if (out.length < n && groups.get(g)[round]) out.push(groups.get(g)[round]);
    if (out.length === before) break;
  }
  return out.map(({ h, ...s }) => s);
}
