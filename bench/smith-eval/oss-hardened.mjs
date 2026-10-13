#!/usr/bin/env node
// Smith OSS coverage rerun on the hardened Smith (atomic-codemod smith-hardening). Same 3 MIT repos, same commits,
// same function set as bench/smith-oss/measure.mjs (functions found on the transpiled JS, so kinds, templates and
// denominators match the pinned run), but Smith reads each function's own TS/TSX source directly (no transpile, no
// JSX -> React.createElement): the hardened to-english parses both.
//
//   node bench/smith-eval/oss-hardened.mjs --repos DIR [--out bench/smith-eval]
//
// Gaps: "(...)" (expression), "(a step that does not translate cleanly)" (statement) and a bare "?" (pattern) all
// count. Two bars:
//   full   System 1's 0.5 placeholder rule with all three gap kinds counted as placeholders (the pinned run counted
//          only "(...)", so this is the stricter reading of the same rule)
//   clean  no gap at all anywhere in the English (title included)
// Output: <out>/oss-hardened.json and <out>/OSS-HARDENED.md, counts only, no third-party code. Deterministic.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { KINDS, REPOS, headSha, isTemplate, kindOf, licenseOf, listFiles, ossFunctionsOf } from '../smith-oss/measure.mjs';
import { smithEmptyReason, toJs } from '../../packages/tools/smith-system1/sources.mjs';
import { normalizeCode, sortKeys, ts } from '../../packages/tools/smith-system1/lib.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WRAPPERS = new Set(['forwardRef', 'memo', 'cache', 'React.forwardRef', 'React.memo', 'React.cache']);
const RESULTS = ['full', 'placeholder', 'empty', 'parseError'];

/** The pinned run's numbers (bench/smith-oss/results.json, atomic-codemod 885b32e). */
export const PINNED = Object.freeze({ overall: 57.5, logicOnly: 75.4 });

/** Every gap Smith leaves in its English: "(...)", the untranslated-step phrase, a bare "?". */
export const GAP_RE = /\(\.\.\.\)|\(a step that does not translate cleanly\)|(?<![\w'"`])\?(?![\w'"`])/g;
export const gapCount = (english) => (english.match(GAP_RE) ?? []).length;
/** System 1's 0.5 rule, with all three gap kinds read as placeholders. */
export const hardenedEmptyReason = (english) => smithEmptyReason(english.replace(GAP_RE, '(...)'));

/**
 * The same top-level functions ossFunctionsOf finds, but taken from the typed source (TS or TSX) itself, by name.
 * Parsed with the file's own script kind; the code keeps its types and JSX.
 */
export function tsFunctionsByName(text, rel) {
  const kind = /\.tsx$/.test(rel) ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(path.basename(rel), text, ts.ScriptTarget.ES2020, true, kind);
  const out = new Map();
  const strip = (s) => s.replace(/^export\s+(default\s+)?/, '');
  const asFn = (name, fn) => {
    const isAsync = fn.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword);
    const tps = fn.typeParameters ? `<${fn.typeParameters.map((p) => p.getText(sf)).join(', ')}>` : '';
    const params = fn.parameters.map((p) => p.getText(sf)).join(', ');
    const ret = fn.type ? `: ${fn.type.getText(sf)}` : '';
    const body = ts.isBlock(fn.body) ? fn.body.getText(sf) : `{\n  return ${fn.body.getText(sf)};\n}`;
    return `${isAsync ? 'async ' : ''}function ${name}${tps}(${params})${ret} ${body}`;
  };
  for (const st of sf.statements) {
    if (ts.isFunctionDeclaration(st) && st.body) out.set(st.name?.text ?? 'default', { kind: 'function', code: strip(st.getText(sf)) });
    else if (ts.isVariableStatement(st) && st.declarationList.declarations.length === 1) {
      const d = st.declarationList.declarations[0];
      let init = d.initializer;
      if (!ts.isIdentifier(d.name) || !init) continue;
      while (init && (ts.isAsExpression(init) || ts.isSatisfiesExpression?.(init) || ts.isParenthesizedExpression(init))) init = init.expression;
      if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) { out.set(d.name.text, { kind: 'function', code: asFn(d.name.text, init) }); continue; }
      while (init && ts.isCallExpression(init) && WRAPPERS.has(init.expression.getText(sf)) && init.arguments[0] && ts.isCallExpression(init.arguments[0])) init = init.arguments[0];
      if (!init || !ts.isCallExpression(init) || !WRAPPERS.has(init.expression.getText(sf))) continue;
      const fn = init.arguments[0];
      if (fn && (ts.isArrowFunction(fn) || ts.isFunctionExpression(fn)) && !out.has(d.name.text)) out.set(d.name.text, { kind: 'function', code: asFn(d.name.text, fn) });
    } else if (ts.isClassDeclaration(st)) {
      for (const m of st.members) if (ts.isMethodDeclaration(m) && m.body && ts.isIdentifier(m.name)) out.set(`${st.name?.text ?? 'Class'}.${m.name.text}`, { kind: 'method', code: m.getText(sf) });
    }
  }
  return out;
}

const blank = () => Object.fromEntries(RESULTS.map((r) => [r, 0]));
const cov = (c) => { const n = RESULTS.reduce((a, r) => a + c[r], 0); return { n, full: c.full, pct: n ? Math.round((1000 * c.full) / n) / 10 : null }; };
const covClean = (c) => ({ n: c.n, full: c.clean, pct: c.n ? Math.round((1000 * c.clean) / c.n) / 10 : null });
function summarize(table, clean) {
  const out = Object.fromEntries(KINDS.map((k) => [k, { full: cov(table[k]), clean: covClean(clean[k]) }]));
  const all = blank(); const allClean = { n: 0, clean: 0 };
  for (const k of KINDS) { for (const r of RESULTS) all[r] += table[k][r]; allClean.n += clean[k].n; allClean.clean += clean[k].clean; }
  out.all = { full: cov(all), clean: covClean(allClean) };
  return out;
}

/**
 * Measure one repo. `summarizeCode` is links.mjs's; `unhandledOf(code, kind)` returns to-english's `unhandled`
 * list (both injectable for tests).
 */
export async function measureRepo(repo, reposDir, { summarizeCode, unhandledOf }) {
  const root = path.join(reposDir, repo.name, repo.subdir);
  const { files, skipped } = listFiles(root);
  const table = Object.fromEntries(KINDS.map((k) => [k, blank()]));
  const logic = Object.fromEntries(KINDS.map((k) => [k, blank()]));
  const clean = Object.fromEntries(KINDS.map((k) => [k, { n: 0, clean: 0 }]));
  const logicClean = Object.fromEntries(KINDS.map((k) => [k, { n: 0, clean: 0 }]));
  const counts = { files: files.length, filesSkipped: skipped, fileParseErrors: 0, functions: 0, templates: 0, tsSourceFound: 0, gaps: { expr: 0, stmt: 0, pattern: 0 }, unhandledTypes: {} };
  const pairs = [];
  for (const { rel, text } of files) {
    let fns; let tsFns;
    try { fns = ossFunctionsOf(toJs(text, path.basename(rel))); tsFns = tsFunctionsByName(text, rel); } catch { counts.fileParseErrors += 1; continue; }
    for (const fn of fns) {
      counts.functions += 1;
      const kind = kindOf(fn, rel, text);
      const template = isTemplate(fn.code, fn.kind);
      if (template) counts.templates += 1;
      const tsFn = tsFns.get(fn.name);
      if (tsFn) counts.tsSourceFound += 1;
      const input = tsFn?.code ?? fn.code;
      let result; let isClean = false;
      try {
        const s = await summarizeCode(input, { kind: fn.kind });
        const english = (s.sentences ?? []).join(' ').trim();
        if (s.via === 'static' && s.details?.some((d) => d.label === 'Why')) result = 'parseError';
        else {
          const why = hardenedEmptyReason(english);
          result = why === 'placeholder' ? 'placeholder' : why === 'blank' ? 'empty' : 'full';
          const g = gapCount(english);
          counts.gaps.expr += (english.match(/\(\.\.\.\)/g) ?? []).length;
          counts.gaps.stmt += (english.match(/\(a step that does not translate cleanly\)/g) ?? []).length;
          counts.gaps.pattern += g - (english.match(/\(\.\.\.\)|\(a step that does not translate cleanly\)/g) ?? []).length;
          isClean = result === 'full' && g === 0;
          if (result === 'full') pairs.push({ code: normalizeCode(fn.code), clean: isClean });
          for (const u of (unhandledOf ? unhandledOf(input, fn.kind) : [])) counts.unhandledTypes[`${u.kind}:${u.type}`] = (counts.unhandledTypes[`${u.kind}:${u.type}`] ?? 0) + 1;
        }
      } catch { result = 'parseError'; }
      table[kind][result] += 1;
      clean[kind].n += 1; if (isClean) clean[kind].clean += 1;
      if (!template) { logic[kind][result] += 1; logicClean[kind].n += 1; if (isClean) logicClean[kind].clean += 1; }
    }
  }
  return { table, logic, clean, logicClean, counts, pairs };
}

const pairStats = (ps) => ({ passing: ps.length, uniqueCode: new Set(ps.map((p) => p.code)).size, cleanUniqueCode: new Set(ps.filter((p) => p.clean).map((p) => p.code)).size });

export async function measure({ reposDir, summarizeCode, unhandledOf, smith }) {
  const repos = [];
  const tot = { table: Object.fromEntries(KINDS.map((k) => [k, blank()])), logic: Object.fromEntries(KINDS.map((k) => [k, blank()])), clean: Object.fromEntries(KINDS.map((k) => [k, { n: 0, clean: 0 }])), logicClean: Object.fromEntries(KINDS.map((k) => [k, { n: 0, clean: 0 }])) };
  const allPairs = []; const gaps = { expr: 0, stmt: 0, pattern: 0 }; const unhandled = {};
  for (const repo of REPOS) {
    const dir = path.join(reposDir, repo.name);
    const license = licenseOf(dir);
    if (license.type !== 'MIT') throw new Error(`${repo.name}: licence is ${license.type}, not MIT; refusing to measure it`);
    const r = await measureRepo(repo, reposDir, { summarizeCode, unhandledOf });
    for (const k of KINDS) {
      for (const x of RESULTS) { tot.table[k][x] += r.table[k][x]; tot.logic[k][x] += r.logic[k][x]; }
      for (const t of ['clean', 'logicClean']) { tot[t][k].n += r[t][k].n; tot[t][k].clean += r[t][k].clean; }
    }
    for (const g of Object.keys(gaps)) gaps[g] += r.counts.gaps[g];
    for (const [t, n] of Object.entries(r.counts.unhandledTypes)) unhandled[t] = (unhandled[t] ?? 0) + n;
    allPairs.push(...r.pairs);
    repos.push({ name: repo.name, url: repo.url, subdir: repo.subdir, sha: headSha(dir), license, counts: r.counts, table: r.table, logic: r.logic, coverage: summarize(r.table, r.clean), logicCoverage: summarize(r.logic, r.logicClean), pairs: pairStats(r.pairs) });
  }
  return sortKeys({
    parent: 944, smith, pinned: PINNED, repos,
    overall: { table: tot.table, logic: tot.logic, coverage: summarize(tot.table, tot.clean), logicCoverage: summarize(tot.logic, tot.logicClean), pairs: pairStats(allPairs), gaps, unhandledTypes: unhandled },
  });
}

const pct = (c) => (c.n ? `${c.pct}% (${c.full}/${c.n})` : '-');

export function renderMarkdown(res, pinned) {
  const L = [];
  const o = res.overall;
  const pin = (name, which) => pinned?.repos.find((r) => r.name === name)?.[which];
  L.push('# Smith OSS coverage on the hardened Smith', '');
  L.push(`Rerun of bench/smith-oss on the same repos and commits. Smith: atomic-codemod ${res.smith.atomicCodemod}, smith ${res.smith.smith}; TS/TSX fed directly. Gaps: "(...)", "does not translate cleanly" and a bare "?". \`full\` = 0.5 rule with every gap kind counted; \`clean\` = no gap at all. Pinned (885b32e, only "(...)" counted): ${PINNED.overall}% overall, ${PINNED.logicOnly}% logic-only.`, '');
  L.push('| repo | commit | functions | TS source found |', '| --- | --- | --- | --- |');
  for (const r of res.repos) L.push(`| ${r.name} | \`${r.sha.slice(0, 12)}\` | ${r.counts.functions} | ${r.counts.tsSourceFound} |`);
  for (const [title, key, pinKey] of [['All functions', 'coverage', 'coverage'], ['Logic only (templates excluded)', 'logicCoverage', 'logicCoverage']]) {
    L.push('', `## ${title}`, '', `| repo | bar | ${KINDS.join(' | ')} | all | pinned all |`, `| --- | --- | ${KINDS.map(() => '---').join(' | ')} | --- | --- |`);
    for (const r of [...res.repos, { name: 'overall', ...o }]) {
      const p = r.name === 'overall' ? pinned?.overall?.[pinKey]?.all : pin(r.name, pinKey)?.all;
      for (const bar of ['full', 'clean']) L.push(`| ${r.name} | ${bar} | ${KINDS.map((k) => pct(r[key][k][bar])).join(' | ')} | **${pct(r[key].all[bar])}** | ${bar === 'full' && p ? pct(p) : ''} |`);
    }
  }
  L.push('', '## Pairs', '', '| repo | full | distinct code | clean distinct |', '| --- | --- | --- | --- |');
  for (const r of res.repos) L.push(`| ${r.name} | ${r.pairs.passing} | ${r.pairs.uniqueCode} | ${r.pairs.cleanUniqueCode} |`);
  L.push(`| overall | ${o.pairs.passing} | ${o.pairs.uniqueCode} | ${o.pairs.cleanUniqueCode} |`);
  L.push('', `Gap occurrences: ${o.gaps.expr} "(...)", ${o.gaps.stmt} "does not translate cleanly", ${o.gaps.pattern} "?". to-english \`unhandled\`: ${Object.entries(o.unhandledTypes).sort((a, b) => b[1] - a[1]).map(([t, n]) => `${t} ${n}`).join(', ') || 'none'}.`, '');
  return `${L.join('\n')}\n`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
  const reposDir = arg('--repos');
  if (!reposDir) { console.error('usage: node bench/smith-eval/oss-hardened.mjs --repos DIR [--out DIR]'); process.exit(2); }
  const out = path.resolve(arg('--out', HERE));
  const links = await import('../../packages/summarize/links.mjs');
  const { importLinked, readLinks } = await import('../../packages/line-links/index.mjs');
  const st = links.smithLinks();
  if (!st.codemod.ok) { console.error(`atomic-codemod is not linked: ${st.codemod.message}`); process.exit(1); }
  const te = await importLinked('@smith/to-english', { table: readLinks(links.SMITH_TABLE_FILES.codemod) });
  const toEnglish = te.module.toEnglish ?? te.module.default?.toEnglish;
  const unhandledOf = (code, kind) => { try { return toEnglish(code, kind).unhandled ?? []; } catch { return []; } };
  const smith = { atomicCodemod: st.codemod.head.slice(0, 7), smith: st.smith.ok ? st.smith.head.slice(0, 7) : null, placeholderCutoff: 0.5 };
  const res = await measure({ reposDir: path.resolve(reposDir), summarizeCode: links.summarizeCode, unhandledOf, smith });
  const pinned = JSON.parse(fs.readFileSync(path.join(HERE, '..', 'smith-oss', 'results.json'), 'utf8'));
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'oss-hardened.json'), `${JSON.stringify(res, null, 2)}\n`);
  fs.writeFileSync(path.join(out, 'OSS-HARDENED.md'), renderMarkdown(res, pinned));
  const a = res.overall;
  console.log(`full ${pct(a.coverage.all.full)}, clean ${pct(a.coverage.all.clean)}; logic full ${pct(a.logicCoverage.all.full)}, clean ${pct(a.logicCoverage.all.clean)}; clean pairs ${a.pairs.cleanUniqueCode}; wrote ${out}`);
}
