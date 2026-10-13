#!/usr/bin/env node
// #944 (part of #940) -- Smith coverage on permissive OSS React/TS. A first data probe toward a native Line model:
// how much of real, MIT-licensed React/TypeScript does Smith (atomic-codemod's deterministic to-english, no model)
// put into words, and how many (code, English) pairs pass System 1's 0.5 placeholder rule?
//
//   node bench/smith-oss/measure.mjs --repos DIR [--out bench/smith-oss]
//
// DIR holds shallow clones named taxonomy/, commerce/, query/ (see REPOS). Their files are only read and parsed:
// nothing is installed, built or run inside them. Output: <out>/results.json and <out>/RESULTS.md, counts only
// (plus each repo's commit SHA and licence) -- no third-party code is written. Two runs over the same clones give
// byte-identical output.
//
// Reuses packages/tools/smith-system1: toJs (types out, JSX kept), functionsOf (top-level functions, the
// arrow-to-function rewrite), smithInput (JSX -> React.createElement, since Smith's parser has no JSX) and
// smithEmptyReason (the 0.5 placeholder cutoff). The one addition: a top-level `const X = forwardRef((..) => ..)`
// (or memo/React.forwardRef/React.memo/cache) is unwrapped into `function X(..)` too, since OSS component kits are
// written that way and functionsOf alone would not see them (counted in `unwrapped`).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { functionsOf, smithEmptyReason, smithInput, toJs } from '../../packages/tools/smith-system1/sources.mjs';
import { normalizeCode, sortKeys, ts } from '../../packages/tools/smith-system1/lib.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** The three repos the owner approved, each read from `<repos>/<name>/<subdir>`. */
export const REPOS = Object.freeze([
  { name: 'taxonomy', url: 'https://github.com/shadcn-ui/taxonomy', subdir: '.' },
  { name: 'commerce', url: 'https://github.com/vercel/commerce', subdir: '.' },
  // examples/ holds angular, lit, preact, react, solid, svelte and vue; only the React ones are React/TS.
  { name: 'query', url: 'https://github.com/TanStack/query', subdir: 'examples/react' },
]);
export const KINDS = Object.freeze(['hook', 'component', 'util', 'store', 'server']);
export const RESULTS = Object.freeze(['full', 'placeholder', 'empty', 'parseError']);
const MAX_BYTES = 64 * 1024;
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'out', '.next', '.git', '__tests__', '__mocks__', 'e2e', 'test', 'tests', 'generated', '__generated__', 'coverage']);
const WRAPPERS = new Set(['forwardRef', 'memo', 'cache', 'React.forwardRef', 'React.memo', 'React.cache']);
const HTTP = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);

// ---------- files ----------

/** Is this file in scope: TS/TSX, not a test, .d.ts, config or generated file. */
export function inScope(rel, text) {
  if (!/\.(ts|tsx)$/.test(rel) || /\.d\.ts$/.test(rel)) return false;
  if (/\.(test|spec|stories)\.|\.gen\.|\.generated\.|(^|\/)[\w.-]+\.config\.ts$/.test(rel)) return false;
  return !/@generated|auto-?generated|do not edit/i.test(text.slice(0, 600));
}

/** Sorted recursive list of in-scope files under `root` (paths relative to it), plus the skip counts. */
export function listFiles(root) {
  const files = [];
  const skipped = { outOfScope: 0, tooBig: 0 };
  const go = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      if (e.name.startsWith('.') || e.isSymbolicLink()) continue;
      const f = path.join(dir, e.name);
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) go(f); continue; }
      if (!/\.(ts|tsx)$/.test(e.name)) continue;
      const rel = path.relative(root, f).split(path.sep).join('/');
      if (fs.statSync(f).size > MAX_BYTES) { skipped.tooBig += 1; continue; }
      const text = fs.readFileSync(f, 'utf8');
      if (!inScope(rel, text)) { skipped.outOfScope += 1; continue; }
      files.push({ rel, text });
    }
  };
  go(root);
  return { files, skipped };
}

/** The clone's commit, read from .git without running anything. */
export function headSha(repoDir) {
  const head = fs.readFileSync(path.join(repoDir, '.git', 'HEAD'), 'utf8').trim();
  if (!head.startsWith('ref: ')) return head;
  const ref = head.slice(5);
  const loose = path.join(repoDir, '.git', ref);
  if (fs.existsSync(loose)) return fs.readFileSync(loose, 'utf8').trim();
  const packed = fs.readFileSync(path.join(repoDir, '.git', 'packed-refs'), 'utf8');
  return packed.split('\n').find((l) => l.endsWith(` ${ref}`))?.split(' ')[0] ?? null;
}

/** The licence at the repo root: its file name and type ('MIT' when the text says so). */
export function licenseOf(repoDir) {
  const file = fs.readdirSync(repoDir).sort().find((f) => /^licen[sc]e(\.md|\.txt)?$/i.test(f));
  if (!file) return { file: null, type: 'none' };
  const text = fs.readFileSync(path.join(repoDir, file), 'utf8');
  const type = /\bMIT License\b/i.test(text) && /Permission is hereby granted, free of charge/.test(text) ? 'MIT' : 'other';
  return { file, type };
}

// ---------- functions ----------

/** functionsOf plus a top-level `const X = forwardRef/memo/cache((..) => ..)` unwrapped into `function X(..)`. */
export function ossFunctionsOf(js) {
  const out = functionsOf(js).map((f) => ({ ...f, unwrapped: false }));
  const sf = ts.createSourceFile('x.jsx', js, ts.ScriptTarget.ES2020, true, ts.ScriptKind.JSX);
  for (const st of sf.statements) {
    if (!ts.isVariableStatement(st) || st.declarationList.declarations.length !== 1) continue;
    const d = st.declarationList.declarations[0];
    let init = d.initializer;
    if (!ts.isIdentifier(d.name) || !init || !ts.isCallExpression(init)) continue;
    // forwardRef(memo(fn)) and the like: peel wrappers until a function argument appears.
    while (init && ts.isCallExpression(init) && WRAPPERS.has(init.expression.getText(sf)) && init.arguments[0] && ts.isCallExpression(init.arguments[0])) init = init.arguments[0];
    if (!init || !ts.isCallExpression(init) || !WRAPPERS.has(init.expression.getText(sf))) continue;
    const fn = init.arguments[0];
    if (!fn || !(ts.isArrowFunction(fn) || ts.isFunctionExpression(fn))) continue;
    const isAsync = fn.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword);
    const params = fn.parameters.map((p) => p.getText(sf)).join(', ');
    const body = ts.isBlock(fn.body) ? fn.body.getText(sf) : `{\n  return ${fn.body.getText(sf)};\n}`;
    out.push({ name: d.name.text, kind: 'function', code: `${isAsync ? 'async ' : ''}function ${d.name.text}(${params}) ${body}`, fromArrow: true, unwrapped: true });
  }
  return out;
}

/** The function node of a standalone function/method code (JS, JSX kept). */
function fnNode(code, kind) {
  const src = kind === 'method' ? `class __W__ {\n${code}\n}` : code;
  const sf = ts.createSourceFile('x.jsx', src, ts.ScriptTarget.ES2020, true, ts.ScriptKind.JSX);
  const st = sf.statements[0];
  const node = st && ts.isClassDeclaration(st) ? st.members[0] : st;
  return { sf, node };
}

const isJsx = (n) => ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n) || ts.isJsxFragment(n);
function hasJsx(node) {
  let found = false;
  const visit = (n) => { if (found) return; if (isJsx(n)) { found = true; return; } ts.forEachChild(n, visit); };
  visit(node);
  return found;
}
const unparen = (e) => { while (e && ts.isParenthesizedExpression(e)) e = e.expression; return e; };

/**
 * A template under the owner's logic/template split: the body is only `return <jsx>` (parenthesized or not), with
 * at most plain destructuring of a parameter or identifier before it. Everything else holds logic.
 */
export function isTemplate(code, kind) {
  const { node } = fnNode(code, kind);
  const body = node?.body;
  if (!body || !ts.isBlock(body) || !body.statements.length) return false;
  return body.statements.every((s, i, all) => {
    if (i === all.length - 1) return ts.isReturnStatement(s) && !!s.expression && isJsx(unparen(s.expression));
    return ts.isVariableStatement(s) && s.declarationList.declarations.every((d) => !ts.isIdentifier(d.name) && d.initializer && ts.isIdentifier(d.initializer));
  });
}

/**
 * The function's kind, first match wins:
 *   hook       its name is use<Capital>
 *   store      a context provider/reducer/store by name, a store/context/reducer/state file, or it calls createContext
 *   component  its body contains JSX (pages, layouts, components)
 *   server     an HTTP route handler, middleware, a Next.js metadata/static-params function, a 'use server' action,
 *              or any function in an app/api, pages/api or server-only file (next/headers, next/server, server-only)
 *   util       everything else (pure helpers, fetchers, formatters)
 */
export function kindOf(fn, file, fileText) {
  const short = fn.name.split('.').pop();
  if (/^use[A-Z0-9]/.test(short)) return 'hook';
  const base = path.posix.basename(file).replace(/\.(ts|tsx)$/, '');
  const dirs = path.posix.dirname(file).split('/');
  if (/(Provider|Reducer|Store)$|^create\w*Store$/.test(short) || /^(store|context|reducer|state|slice|atoms?)$|-(store|context|reducer)$/i.test(base) || dirs.some((d) => /^(stores?|contexts?|reducers?|state)$/i.test(d)) || /\bcreateContext\s*\(/.test(fn.code)) return 'store';
  const { node } = fnNode(fn.code, fn.kind);
  if (node && hasJsx(node)) return 'component';
  if (HTTP.has(short) || /^(middleware|generateMetadata|generateStaticParams|generateSitemaps|revalidate)$/.test(short)) return 'server';
  if (/(^|\/)(app|pages)\/api\//.test(file) || /^(route|middleware|actions?)$/.test(base)) return 'server';
  if (/^\s*(['"])use server\1/m.test(fileText) || /['"]use server['"]/.test(fn.code.slice(0, 200))) return 'server';
  if (/from\s+['"](server-only|next\/headers|next\/server)['"]|import\s+['"]server-only['"]/.test(fileText)) return 'server';
  return 'util';
}

// ---------- why Smith says "(...)" ----------

/**
 * Every construct in Smith's input that its to-english step renders as "(...)" (an expression it has no words for)
 * or as "(a step that does not translate cleanly)" (a statement it has no words for). A mirror of to-english.js's
 * exprToEnglish/stmtToEnglish traversal over the TypeScript AST: it walks exactly the children Smith walks and
 * names whatever falls to Smith's default branch. `inJsx` marks a construct inside a React.createElement call (JSX).
 * @returns {{reason: string, node: import('typescript').Node}[]}
 */
export function untranslated(code, kind) {
  const { node } = fnNode(code, kind);
  const out = [];
  const add = (reason, n, inJsx) => out.push({ reason: inJsx ? `${reason} in JSX` : reason, node: n });
  const isCreateElement = (e) => ts.isCallExpression(e) && /^React\.createElement$/.test(e.expression.getText());
  const expr = (e, inJsx) => {
    e = unparen(e);
    if (!e) return;
    if (ts.isIdentifier(e) || e.kind === ts.SyntaxKind.ThisKeyword || ts.isStringLiteral(e) || ts.isNumericLiteral(e) || e.kind === ts.SyntaxKind.TrueKeyword || e.kind === ts.SyntaxKind.FalseKeyword || e.kind === ts.SyntaxKind.NullKeyword) return;
    if (ts.isPropertyAccessExpression(e)) {
      if (e.questionDotToken) return add('optional chaining (a?.b)', e, inJsx);
      if (ts.isPrivateIdentifier(e.name)) return add('private field (#x)', e, inJsx);
      return expr(e.expression, inJsx);
    }
    if (ts.isElementAccessExpression(e)) {
      if (e.questionDotToken) return add('optional chaining (a?.b)', e, inJsx);
      expr(e.expression, inJsx); return expr(e.argumentExpression, inJsx);
    }
    if (ts.isPrefixUnaryExpression(e)) {
      if (e.operator === ts.SyntaxKind.PlusPlusToken || e.operator === ts.SyntaxKind.MinusMinusToken) return add('increment/decrement (++/--)', e, inJsx);
      return expr(e.operand, inJsx);
    }
    if (ts.isTypeOfExpression(e) || ts.isVoidExpression(e) || ts.isDeleteExpression(e)) return expr(e.expression, inJsx);
    if (ts.isPostfixUnaryExpression(e)) return add('increment/decrement (++/--)', e, inJsx);
    if (ts.isCallExpression(e)) {
      if (e.questionDotToken || (ts.isPropertyAccessExpression(e.expression) && e.expression.questionDotToken)) return add('optional chaining (a?.b)', e, inJsx);
      if (e.expression.kind === ts.SyntaxKind.ImportKeyword) return add('dynamic import()', e, inJsx);
      const jsx = inJsx || isCreateElement(e);
      if (ts.isPropertyAccessExpression(e.expression)) expr(e.expression.expression, jsx);
      else if (!ts.isIdentifier(e.expression)) expr(e.expression, jsx);
      e.arguments.forEach((a, i) => {
        if (isCreateElement(e) && i === 1 && ts.isObjectLiteralExpression(a)) return add('JSX props', a, false);
        expr(a, jsx);
      });
      return;
    }
    if (ts.isArrowFunction(e)) return ts.isBlock(e.body) ? block(e.body, inJsx) : expr(e.body, inJsx);
    if (ts.isNewExpression(e)) { (e.arguments ?? []).forEach((a) => expr(a, inJsx)); return; }
    if (ts.isBinaryExpression(e)) {
      const op = e.operatorToken.kind;
      if (op === ts.SyntaxKind.AmpersandAmpersandToken || op === ts.SyntaxKind.BarBarToken || op === ts.SyntaxKind.QuestionQuestionToken) return add('logical && / || / ??', e, inJsx);
      if (op === ts.SyntaxKind.CommaToken) return add('comma expression', e, inJsx);
      expr(e.left, inJsx); return expr(e.right, inJsx);
    }
    if (ts.isConditionalExpression(e)) return add('ternary (a ? b : c)', e, inJsx);
    if (ts.isObjectLiteralExpression(e)) return add('object literal', e, inJsx);
    if (ts.isArrayLiteralExpression(e)) return add('array literal', e, inJsx);
    if (ts.isTemplateExpression(e) || ts.isNoSubstitutionTemplateLiteral(e) || ts.isTaggedTemplateExpression(e)) return add('template literal', e, inJsx);
    if (ts.isAwaitExpression(e)) return add('await', e, inJsx);
    if (ts.isFunctionExpression(e)) return add('function expression', e, inJsx);
    if (ts.isSpreadElement(e)) return add('spread (...x)', e, inJsx);
    if (ts.isRegularExpressionLiteral(e)) return add('regex literal', e, inJsx);
    return add(`other expression (${ts.SyntaxKind[e.kind]})`, e, inJsx);
  };
  const stmt = (s, inJsx) => {
    if (ts.isReturnStatement(s)) return s.expression && expr(s.expression, inJsx);
    if (ts.isExpressionStatement(s)) return expr(s.expression, inJsx);
    if (ts.isVariableStatement(s)) { s.declarationList.declarations.forEach((d) => d.initializer && expr(d.initializer, inJsx)); return; }
    if (ts.isIfStatement(s)) { expr(s.expression, inJsx); stmt(s.thenStatement, inJsx); if (s.elseStatement) stmt(s.elseStatement, inJsx); return; }
    if (ts.isForOfStatement(s) || ts.isForInStatement(s)) { expr(s.expression, inJsx); return stmt(s.statement, inJsx); }
    if (ts.isBlock(s)) return block(s, inJsx);
    const name = ts.isTryStatement(s) ? 'try/catch' : ts.isThrowStatement(s) ? 'throw' : ts.isSwitchStatement(s) ? 'switch' : (ts.isForStatement(s) || ts.isWhileStatement(s) || ts.isDoStatement(s)) ? 'for/while loop' : ts.isFunctionDeclaration(s) ? 'nested function declaration' : `other statement (${ts.SyntaxKind[s.kind]})`;
    return add(`statement: ${name}`, s, false);
  };
  const block = (b, inJsx) => b.statements.forEach((s) => stmt(s, inJsx));
  if (node?.body && ts.isBlock(node.body)) block(node.body, false);
  return out;
}

/** A construct's anonymised shape: identifiers -> a, b, c.. (stable per shape), strings -> "s", numbers -> 0. */
export function shapeOf(text, max = 64) {
  const sc = ts.createScanner(ts.ScriptTarget.Latest, true, ts.LanguageVariant.Standard, text);
  const names = new Map();
  const parts = [];
  for (let k = sc.scan(); k !== ts.SyntaxKind.EndOfFileToken; k = sc.scan()) {
    const t = sc.getTokenText();
    if (k === ts.SyntaxKind.Identifier) {
      if (/^(React|createElement|Fragment)$/.test(t)) { parts.push(t); continue; }
      if (!names.has(t)) names.set(t, String.fromCharCode(97 + (names.size % 26)) + (names.size >= 26 ? Math.floor(names.size / 26) : ''));
      parts.push(names.get(t));
    } else if (k === ts.SyntaxKind.StringLiteral) parts.push('"s"');
    else if (k === ts.SyntaxKind.NumericLiteral) parts.push('0');
    else if (k === ts.SyntaxKind.NoSubstitutionTemplateLiteral || k === ts.SyntaxKind.TemplateHead) { parts.push('`…`'); if (k === ts.SyntaxKind.TemplateHead) break; }
    else parts.push(t);
  }
  let s = parts.join(' ').replace(/\s+([,.;:)\]}])/g, '$1').replace(/([([{.])\s+/g, '$1').replace(/\s+\(/g, '(').replace(/\s+(\[|\?\.)\s*/g, '$1').replace(/!\s+/g, '!').replace(/\{\s*/g, '{ ').replace(/\s*\}/g, ' }');
  if (s.length > max) s = `${s.slice(0, max - 1)}…`;
  return s;
}

// ---------- measure ----------

const blankCell = () => Object.fromEntries(RESULTS.map((r) => [r, 0]));
const cov = (c) => { const n = RESULTS.reduce((a, r) => a + c[r], 0); return { n, full: c.full, pct: n ? Math.round((1000 * c.full) / n) / 10 : null }; };

/**
 * Measure one repo. `summarizeCode` is packages/summarize/links.mjs's (injectable for tests).
 */
export async function measureRepo(repo, reposDir, summarizeCode) {
  const dir = path.join(reposDir, repo.name);
  const root = path.join(dir, repo.subdir);
  const { files, skipped } = listFiles(root);
  const table = Object.fromEntries(KINDS.map((k) => [k, blankCell()]));
  const logic = Object.fromEntries(KINDS.map((k) => [k, blankCell()]));
  const counts = { files: files.length, filesSkipped: skipped, filesWithoutFunctions: 0, fileParseErrors: 0, functions: 0, unwrapped: 0, templates: 0, fullWithUntranslatedStep: 0 };
  const gaps = [];
  const pairs = [];
  for (const { rel, text } of files) {
    let fns;
    try { fns = ossFunctionsOf(toJs(text, path.basename(rel))); } catch { counts.fileParseErrors += 1; continue; }
    if (!fns.length) counts.filesWithoutFunctions += 1;
    for (const fn of fns) {
      counts.functions += 1;
      if (fn.unwrapped) counts.unwrapped += 1;
      const kind = kindOf(fn, rel, text);
      const template = isTemplate(fn.code, fn.kind);
      if (template) counts.templates += 1;
      let result;
      let input = null;
      try {
        input = smithInput(fn);
        const s = await summarizeCode(input, { kind: fn.kind });
        const english = (s.sentences ?? []).join(' ').trim();
        if (s.via === 'static' && s.details?.some((d) => d.label === 'Why')) result = 'parseError';
        else {
          const why = smithEmptyReason(english);
          result = why === 'placeholder' ? 'placeholder' : why === 'blank' ? 'empty' : 'full';
          if (result === 'full') {
            if (/does not translate cleanly/.test(english)) counts.fullWithUntranslatedStep += 1;
            pairs.push({ code: normalizeCode(fn.code), strict: !/does not translate cleanly/.test(english) });
          }
        }
      } catch { result = 'parseError'; }
      table[kind][result] += 1;
      if (!template) logic[kind][result] += 1;
      if (result === 'placeholder' || result === 'empty') {
        const found = input ? untranslated(input, fn.kind) : [];
        gaps.push({ kind, reasons: found.map((u) => ({ reason: u.reason, shape: shapeOf(u.node.getText()) })) });
      }
    }
  }
  return { table, logic, counts, gaps, pairs };
}

/** Rank the gap reasons: functions affected (each counted once per reason), then total occurrences; top shapes. */
export function rankReasons(gaps, top = 5) {
  const by = new Map();
  for (const g of gaps) {
    const seen = new Set();
    for (const { reason, shape } of g.reasons) {
      if (!by.has(reason)) by.set(reason, { reason, functions: 0, occurrences: 0, shapes: new Map() });
      const r = by.get(reason);
      r.occurrences += 1;
      r.shapes.set(shape, (r.shapes.get(shape) ?? 0) + 1);
      if (!seen.has(reason)) { seen.add(reason); r.functions += 1; }
    }
  }
  const noReason = gaps.filter((g) => !g.reasons.length).length;
  const ranked = [...by.values()].sort((a, b) => b.functions - a.functions || b.occurrences - a.occurrences || (a.reason < b.reason ? -1 : 1));
  const fmt = (r) => ({ reason: r.reason, functions: r.functions, occurrences: r.occurrences, examples: [...r.shapes.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, 2).map(([s]) => s) });
  return { top: ranked.slice(0, top).map(fmt), all: ranked.map((r) => ({ reason: r.reason, functions: r.functions, occurrences: r.occurrences })), gapFunctions: gaps.length, gapFunctionsWithNoFoundReason: noReason };
}

export async function measure({ reposDir, summarizeCode }) {
  const repos = [];
  const allGaps = [];
  const allPairs = [];
  const total = { table: Object.fromEntries(KINDS.map((k) => [k, blankCell()])), logic: Object.fromEntries(KINDS.map((k) => [k, blankCell()])) };
  for (const repo of REPOS) {
    const dir = path.join(reposDir, repo.name);
    const license = licenseOf(dir);
    if (license.type !== 'MIT') throw new Error(`${repo.name}: licence is ${license.type}, not MIT; refusing to measure it`);
    const r = await measureRepo(repo, reposDir, summarizeCode);
    for (const k of KINDS) for (const res of RESULTS) { total.table[k][res] += r.table[k][res]; total.logic[k][res] += r.logic[k][res]; }
    allGaps.push(...r.gaps);
    allPairs.push(...r.pairs);
    repos.push({
      name: repo.name, url: repo.url, subdir: repo.subdir, sha: headSha(dir), license,
      counts: r.counts, table: r.table, logic: r.logic,
      coverage: summarize(r.table), logicCoverage: summarize(r.logic),
      pairs: pairStats(r.pairs),
      reasons: rankReasons(r.gaps).top.map((x) => ({ reason: x.reason, functions: x.functions })),
    });
  }
  return sortKeys({
    issue: 944, parent: 940,
    smith: { placeholderCutoff: 0.5, atomicCodemod: '885b32e', smith: 'f70eecf' },
    repos,
    overall: {
      table: total.table, logic: total.logic,
      coverage: summarize(total.table), logicCoverage: summarize(total.logic),
      pairs: pairStats(allPairs),
      reasons: rankReasons(allGaps),
    },
  });
}

/** Passing pairs, distinct by normalized code, and the strict count (no "does not translate cleanly" step). */
const pairStats = (ps) => ({ passing: ps.length, uniqueCode: new Set(ps.map((p) => p.code)).size, strictUniqueCode: new Set(ps.filter((p) => p.strict).map((p) => p.code)).size });

/** Per kind and overall coverage of a kind x result table. */
function summarize(table) {
  const out = Object.fromEntries(KINDS.map((k) => [k, cov(table[k])]));
  const all = blankCell();
  for (const k of KINDS) for (const r of RESULTS) all[r] += table[k][r];
  out.all = cov(all);
  return out;
}

// ---------- report ----------

const pct = (c) => (c.n ? `${c.pct}% (${c.full}/${c.n})` : '-');

export function renderMarkdown(res) {
  const L = [];
  const o = res.overall;
  L.push('# Smith coverage on permissive OSS React/TS (#944, part of #940)', '');
  L.push('How much real, MIT-licensed React/TypeScript does Smith (atomic-codemod\'s deterministic to-english, no model) put into words? Generated by `node bench/smith-oss/measure.mjs --repos DIR`; numbers only, no third-party code is kept. Smith: atomic-codemod 885b32e, smith f70eecf, System 1\'s 0.5 placeholder cutoff.', '');
  L.push('## Sources', '', '| repo | commit | licence | scope | files | functions |', '| --- | --- | --- | --- | --- | --- |');
  for (const r of res.repos) L.push(`| [${r.name}](${r.url}) | \`${r.sha.slice(0, 12)}\` | ${r.license.type} (${r.license.file}) | \`${r.subdir}\` | ${r.counts.files} | ${r.counts.functions} |`);
  L.push('', 'Scope: `.ts`/`.tsx` only; tests, stories, `.d.ts`, `*.config.ts`, generated files and files over 64 KB skipped. Functions are the top-level ones System 1 extracts (declarations, `const f = () => ..` rewritten as `function f`, class methods), plus a top-level `forwardRef`/`memo`/`cache`-wrapped arrow unwrapped the same way. TanStack Query: only `examples/react` (its `examples/` also holds Angular, Lit, Preact, Solid, Svelte and Vue).', '');
  L.push('## Coverage (full / all) per repo and kind', '', `| repo | ${KINDS.join(' | ')} | all |`, `| --- | ${KINDS.map(() => '---').join(' | ')} | --- |`);
  for (const r of res.repos) L.push(`| ${r.name} | ${KINDS.map((k) => pct(r.coverage[k])).join(' | ')} | **${pct(r.coverage.all)}** |`);
  L.push(`| **overall** | ${KINDS.map((k) => pct(o.coverage[k])).join(' | ')} | **${pct(o.coverage.all)}** |`, '');
  L.push('Our own repo (System 1 run, 2026-10-13): 62% (233/377), pages the weak spot.', '');
  L.push('## Result split (overall)', '', `| kind | ${RESULTS.join(' | ')} |`, `| --- | ${RESULTS.map(() => '---').join(' | ')} |`);
  for (const k of KINDS) L.push(`| ${k} | ${RESULTS.map((x) => o.table[k][x]).join(' | ')} |`);
  L.push('', '`full`: passes the 0.5 rule. `placeholder`: after the title sentence, at least one `(...)` per two meaningful words. `empty`: fewer than 3 words once placeholders go. `parseError`: Smith could not read the code.', '');
  L.push('## Logic-only coverage (pure-JSX templates excluded)', '', 'Under the logic/template split, a template (a body that is only `return <jsx>`, after at most plain prop destructuring) does not need Smith.', '');
  L.push(`| repo | templates excluded | ${KINDS.join(' | ')} | all |`, `| --- | --- | ${KINDS.map(() => '---').join(' | ')} | --- |`);
  for (const r of res.repos) L.push(`| ${r.name} | ${r.counts.templates} | ${KINDS.map((k) => pct(r.logicCoverage[k])).join(' | ')} | **${pct(r.logicCoverage.all)}** |`);
  const tmpl = res.repos.reduce((a, r) => a + r.counts.templates, 0);
  L.push(`| **overall** | ${tmpl} | ${KINDS.map((k) => pct(o.logicCoverage[k])).join(' | ')} | **${pct(o.logicCoverage.all)}** |`, '');
  L.push('## Top 5 reasons Smith leaves a function placeholder-dominated or empty', '', `Counted over the ${o.reasons.gapFunctions} non-full functions: each construct Smith's to-english renders as \`(...)\` or "a step that does not translate cleanly", found by mirroring its traversal. "in JSX" means inside a \`React.createElement\` call (JSX, converted before Smith reads it). Shapes are anonymised.`, '');
  L.push('| # | reason | functions | occurrences | example shapes |', '| --- | --- | --- | --- | --- |');
  o.reasons.top.forEach((x, i) => L.push(`| ${i + 1} | ${x.reason} | ${x.functions} | ${x.occurrences} | ${x.examples.map((e) => `\`${e.replace(/\|/g, '\\|')}\``).join('<br>')} |`));
  L.push('', `${o.reasons.gapFunctionsWithNoFoundReason} non-full functions had none of these constructs.`, '');
  L.push('## Pair yield', '', `${o.pairs.passing} (code, English) pairs pass the 0.5 rule (${o.pairs.uniqueCode} with distinct normalized code), out of ${o.coverage.all.n} functions; ${o.pairs.strictUniqueCode} distinct when pairs with an untranslated step are also dropped.`, '');
  L.push('| repo | passing | distinct code | distinct, no untranslated step |', '| --- | --- | --- | --- |');
  for (const r of res.repos) L.push(`| ${r.name} | ${r.pairs.passing} | ${r.pairs.uniqueCode} | ${r.pairs.strictUniqueCode} |`);
  const flagged = res.repos.reduce((a, r) => a + r.counts.fullWithUntranslatedStep, 0);
  L.push('', `Caveat: ${flagged} of the passing pairs contain Smith's "a step that does not translate cleanly" (a try, throw, switch or loop); those words count as meaningful under the 0.5 rule, so the rule passes them. The last column drops them.`, '');
  return `${L.join('\n')}\n`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
  const reposDir = arg('--repos');
  if (!reposDir) { console.error('usage: node bench/smith-oss/measure.mjs --repos DIR [--out DIR]'); process.exit(2); }
  const out = path.resolve(arg('--out', HERE));
  const links = await import('../../packages/summarize/links.mjs');
  const st = links.smithLinks().codemod;
  if (!st.ok) { console.error(`atomic-codemod is not linked: ${st.message ?? 'unknown reason'}`); process.exit(1); }
  const res = await measure({ reposDir: path.resolve(reposDir), summarizeCode: links.summarizeCode });
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'results.json'), `${JSON.stringify(res, null, 2)}\n`);
  fs.writeFileSync(path.join(out, 'RESULTS.md'), renderMarkdown(res));
  console.log(`overall ${pct(res.overall.coverage.all)}, logic-only ${pct(res.overall.logicCoverage.all)}, pairs ${res.overall.pairs.passing}; wrote ${out}`);
}
