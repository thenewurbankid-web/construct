// Line Import v2, the static breakdown (owner, 2026-10-14): each pure function the fit put in a domain block is rewritten
// into calls of the atom runtime, and a rewrite counts only when running old and new on the same generated inputs says
// they behave the same. No model: what the static rewrite leaves untranslated is a refusal for construct.repair (the
// one repair loop, packages/core/line-decide.mjs repairLoop), never a second loop here.
//
//   breakdownLinks()                 where the codemod and the atom runtime stand, one sentence each
//   functionOf(source, name)         a top-level function of a file as one declaration (an arrow bound to a const too)
//   createStaticBreakdown(o)         the linked converter: {breakDown(fn), check(fn, body), dispose} or {ok: false, reason}
//   breakDownImport(root, fit, o)    every domain function of a FitProposal -> AtomBreakdown, its refusals, the check
//                                    repairLoop runs on a repaired body, and `settle` for repairLoop's answer
//
// Both sources are linked like to-english (packages/line-links): atomic-codemod's atoms-transform branch
// (atomic-codemod-atoms.json: toAtoms, the checked converter, its runtime and type readers) and the atom runtime
// (smith-functional.json), each a pinned commit with no source copy. The runtime is never imported in Node: the
// codemod's runtime.js snapshots the pinned commit (`git archive`, into the codemod's git-ignored bench/atoms/.runtime)
// and the check runs it in QuickJS. When either link is down, nothing is broken down and one sentence says so; the
// import carries on without it (the static path).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ts } from '@construct/ast';
import { importLinked, linkStatus, readLinks } from '../../../line-links/index.mjs';
import { ATOMS_PACKAGE, ATOMS_TOOL, assertAtomBreakdown } from './contract.mjs';

const LINKS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'line-links');
/** The two link tables, beside cu1's links.json. */
export const BREAKDOWN_TABLE_FILES = Object.freeze({
  codemod: path.join(LINKS_DIR, 'atomic-codemod-atoms.json'),
  runtime: path.join(LINKS_DIR, 'smith-functional.json'),
});
/** Generated inputs per check (the codemod's corpus default). */
export const BREAKDOWN_RUNS = 25;
/** The rule a refusal is reported under. */
export const BREAKDOWN_RULE = 'LINE-ATOMS';
/**
 * After this many refused repairs of one function, its refusals carry the parts' syntax trees for the model to reason
 * from (owner, 2026-10-14: "use ast as a reference for reasoning"). One, not two: repairLoop stops when an attempt fixes
 * no more parts than the one before, so a tree given after two failures would rarely reach a third attempt.
 */
export const AST_AFTER_FAILURES = 1;
/** The longest syntax-tree reference a refusal carries. */
const AST_MAX = 400;

const one = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const end = (s) => { const t = one(s); return /[.?!]$/.test(t) ? t : `${t}.`; };
const plural = (n, word, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;
const short = (sha) => (sha ? sha.slice(0, 7) : null);
const hash = (s) => [...s].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 7);

/** @type {Map<string, any>} */
const tables = new Map();
/** @param {'codemod'|'runtime'} which */
const tableOf = (which) => {
  if (!tables.has(which)) tables.set(which, readLinks(BREAKDOWN_TABLE_FILES[which]));
  return tables.get(which);
};

/**
 * Where the codemod and the atom runtime stand. Never throws.
 * @param {{env?: NodeJS.ProcessEnv}} [options]
 * @returns {{codemod: import('../../../line-links/index.mjs').LinkStatus, runtime: import('../../../line-links/index.mjs').LinkStatus}}
 */
export function breakdownLinks(options = {}) {
  return { codemod: linkStatus({ ...options, table: tableOf('codemod') }), runtime: linkStatus({ ...options, table: tableOf('runtime') }) };
}

// ------------------------------------------------------------------------------------------------- reading a function

/**
 * A top-level function of a file as one declaration, the way atomic-codemod's corpus reads one: a function declaration
 * without its `export`, or an arrow or function expression bound to a const, written as the equivalent declaration.
 * Null when the name is not a top-level function with a body. Pure.
 * @param {string} source
 * @param {string} name
 * @param {string} [file] Only for the parser's file kind (.tsx parses JSX).
 * @returns {{code: string, line: number, exact: boolean} | null} `exact`: `code` is the file's own text (the checker's
 *   parameter types can find it).
 */
export function functionOf(source, name, file = 'x.ts') {
  const kind = /\.[jt]sx$/.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, kind);
  const lineOf = (pos) => sf.getLineAndCharacterOfPosition(pos).line + 1;
  for (const st of sf.statements) {
    if (ts.isFunctionDeclaration(st) && st.body && st.name?.text === name) {
      const text = source.slice(st.getStart(sf), st.end);
      const code = text.replace(/^export\s+(default\s+)?/, '');
      return { code, line: lineOf(st.getStart(sf)), exact: true };
    }
    if (!ts.isVariableStatement(st)) continue;
    for (const d of st.declarationList.declarations) {
      if (!ts.isIdentifier(d.name) || d.name.text !== name || !d.initializer) continue;
      const fn = d.initializer;
      if (!ts.isArrowFunction(fn) && !ts.isFunctionExpression(fn)) return null;
      const isAsync = (ts.getModifiers(fn) ?? []).some((m) => m.kind === ts.SyntaxKind.AsyncKeyword);
      const star = ts.isFunctionExpression(fn) && fn.asteriskToken ? '*' : '';
      const tps = fn.typeParameters ? `<${fn.typeParameters.map((t) => t.getText(sf)).join(', ')}>` : '';
      const params = fn.parameters.map((p) => p.getText(sf)).join(', ');
      const ret = fn.type ? `: ${fn.type.getText(sf)}` : '';
      const body = ts.isBlock(fn.body) ? fn.body.getText(sf) : `{\n  return ${fn.body.getText(sf)};\n}`;
      return { code: `${isAsync ? 'async ' : ''}function${star} ${name}${tps}(${params})${ret} ${body}`, line: lineOf(fn.getStart(sf)), exact: false };
    }
  }
  return null;
}

/**
 * Where a top-level function of a file sits, for writing it back: the whole statement (an arrow bound to a const is its
 * `const` statement) and the `export` it carries. Null when the name is not a top-level function with a body, or when it
 * shares its `const` statement with other names. Pure.
 * @param {string} source
 * @param {string} name
 * @param {string} [file] Only for the parser's file kind.
 * @returns {{start: number, end: number, prefix: string} | null} `prefix`: '', 'export ' or 'export default '.
 */
export function functionStatement(source, name, file = 'x.ts') {
  const kind = /\.[jt]sx$/.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, kind);
  const prefixOf = (st) => {
    const mods = (ts.getModifiers(st) ?? []).map((m) => m.kind);
    return mods.includes(ts.SyntaxKind.ExportKeyword) ? (mods.includes(ts.SyntaxKind.DefaultKeyword) ? 'export default ' : 'export ') : '';
  };
  for (const st of sf.statements) {
    if (ts.isFunctionDeclaration(st) && st.body && st.name?.text === name) return { start: st.getStart(sf), end: st.end, prefix: prefixOf(st) };
    if (!ts.isVariableStatement(st)) continue;
    const decls = st.declarationList.declarations;
    const d = decls.find((x) => ts.isIdentifier(x.name) && x.name.text === name);
    if (!d) continue;
    if (decls.length !== 1 || !d.initializer || !(ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer))) return null;
    return { start: st.getStart(sf), end: st.end, prefix: prefixOf(st) };
  }
  return null;
}

/**
 * A compact syntax tree of a piece of code, for a model to reason from: node kinds with their names, operators and
 * literals, e.g. `TemplateExpression(head " ", span(BinaryExpression(n + m), " items"))`. Pure; never throws.
 * @param {string} text
 * @param {number} [max]
 * @returns {string}
 */
export function syntaxTreeOf(text, max = AST_MAX) {
  let sf;
  try { sf = ts.createSourceFile('part.ts', `(${text});`, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS); } catch { return ''; }
  // A statement (a loop, an assignment) does not parse as one expression: read it as it is.
  if (/** @type {any} */ (sf).parseDiagnostics?.length) sf = ts.createSourceFile('part.ts', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const show = (n, depth) => {
    if (depth > 6) return '...';
    if (ts.isIdentifier(n) || ts.isPrivateIdentifier(n)) return n.text;
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)) return JSON.stringify(n.text);
    if (ts.isNumericLiteral(n)) return n.text;
    if (n.kind === ts.SyntaxKind.TrueKeyword || n.kind === ts.SyntaxKind.FalseKeyword || n.kind === ts.SyntaxKind.NullKeyword || n.kind === ts.SyntaxKind.ThisKeyword) return n.getText(sf);
    if (ts.isBinaryExpression(n)) return `BinaryExpression(${show(n.left, depth + 1)} ${n.operatorToken.getText(sf)} ${show(n.right, depth + 1)})`;
    if (ts.isParenthesizedExpression(n) || ts.isExpressionStatement(n)) return show(n.expression, depth);
    const kids = [];
    n.forEachChild((c) => { kids.push(show(c, depth + 1)); });
    const kind = ts.SyntaxKind[n.kind] === 'TemplateSpan' ? 'span' : ts.SyntaxKind[n.kind];
    return kids.length ? `${kind}(${kids.join(', ')})` : kind;
  };
  const parts = sf.statements.map((st) => show(st, 0)).join('; ');
  return parts.length > max ? `${parts.slice(0, max - 3)}...` : parts;
}

// ------------------------------------------------------------------------------------------------- the linked converter

/** @type {Map<string, Promise<any>>} */
const linkedOnce = new Map();
/** importLinked once per process per source folder (the link check reads git files and may run `git diff`). */
function linked(name, options = {}) {
  const table = tableOf('codemod');
  const env = options.env ?? process.env;
  const key = [name, env[table.source.env] ?? '', env.LINE_LINKS_ALLOW_DRIFT ?? ''].join('\0');
  if (!linkedOnce.has(key)) linkedOnce.set(key, importLinked(name, { ...options, table }));
  return /** @type {Promise<any>} */ (linkedOnce.get(key));
}
const exportsOf = (mod) => mod.default ?? mod;

/** The names of the atoms a body calls, from the catalog. */
const atomsCalled = (body, atomNames) => [...new Set([...body.matchAll(/\b([A-Za-z_$][\w$]*)\s*\(/g)].map((m) => m[1]).filter((n) => atomNames.has(n)))].sort();
/**
 * The import of the atoms a body calls: from @line/atoms (owner, 2026-10-14), the one package an app depends on for them.
 * @param {string[]} atoms
 * @returns {string}
 */
export const importOf = (atoms) => (atoms.length ? `import { ${atoms.join(', ')} } from '${ATOMS_PACKAGE}';` : '');
/** The codemod's import (`from 'smith'`, its own runtime's name) as the app writes it: the same names, from @line/atoms. */
const fromPackage = (decl) => (decl ? decl.replace(/\s+from\s+(['"])[^'"]*\1;?\s*$/, ` from '${ATOMS_PACKAGE}';`) : decl);

/**
 * The linked static breakdown: atomic-codemod's checked converter over the pinned atom runtime. Never throws: when a
 * link is down or the runtime cannot be prepared, `{ok: false, reason}` with one sentence, and the caller keeps its
 * static path (no breakdown).
 * @param {{env?: NodeJS.ProcessEnv, runs?: number}} [options]
 * @returns {Promise<{ok: false, reason: string} | {ok: true, codemod: string|null, runtime: string|null, breakDown: (fn: any) => any, check: (fn: any, body: string) => {ok: boolean, refusal: any, passed: number}, behaves: (fn: any, written: string) => {ok: boolean, compared: number, sentence: string}, atomsIn: (body: string) => string[], dispose: () => void}>}
 */
export async function createStaticBreakdown(options = {}) {
  const runs = options.runs ?? BREAKDOWN_RUNS;
  const links = breakdownLinks(options);
  if (!links.runtime.ok) return { ok: false, reason: `The atom runtime is not linked: ${links.runtime.packages[0]?.message ?? links.runtime.message}` };
  const mods = {};
  for (const [k, name] of Object.entries({ checked: '@smith/atoms-checked', runtime: '@smith/atoms-runtime', transform: '@smith/atoms-transform', equivalence: '@smith/atoms-equivalence', types: '@smith/atoms-checker-types' })) {
    const r = await linked(name, options);
    if (!r.ok) return { ok: false, reason: r.reason };
    mods[k] = exportsOf(r.module);
  }
  let converter;
  let compiled;
  try {
    const table = tableOf('runtime');
    const snap = mods.runtime.snapshotRuntime({ repo: links.runtime.sourceDir, ref: table.source.commit });
    ({ compiled } = mods.runtime.catalogFor(snap.dir, snap.sha));
    converter = await mods.checked.createCheckedConverter({ compiled, bundle: mods.runtime.bundleRuntime(snap.dir) });
  } catch (e) {
    return { ok: false, reason: `The atom runtime could not be prepared (${one(/** @type {any} */ (e)?.message ?? e).slice(0, 160)}).` };
  }
  const atomNames = new Set(compiled.atoms.keys());
  let checker = null;
  const paramTypesOf = (fn) => {
    if (!fn.exact || !fn.abs) return null;
    try { checker ??= mods.types.createCheckerTypes(); return checker.paramTypes(fn.abs, fn.code); } catch { return null; }
  };
  /** @type {Map<string, any>} */
  const typesBySource = new Map();
  const typesOf = (source) => {
    if (!typesBySource.has(source)) { try { typesBySource.set(source, mods.equivalence.typesOfSource(source)); } catch { typesBySource.set(source, new Map()); } }
    return typesBySource.get(source);
  };
  const lineIn = (fn, at) => fn.line + (fn.code.slice(0, at).match(/\n/g)?.length ?? 0);

  /**
   * One function: convert, check, take back what changes behaviour (the codemod's checked converter).
   * @param {{file: string, name: string, block: string, code: string, line: number, source: string, abs?: string, exact?: boolean}} fn
   * @returns {import('./contract.mjs').AtomUnitResult}
   */
  function breakDown(fn) {
    const base = { file: fn.file, name: fn.name, block: fn.block, code: fn.code };
    let r;
    try {
      r = converter.convert(fn.code, { kind: 'function', types: typesOf(fn.source), runs, seed: hash(fn.name), paramTypes: paramTypesOf(fn) });
    } catch (e) {
      const why = one(/** @type {any} */ (e)?.message ?? e).slice(0, 160);
      return { ...base, status: 'unchecked', check: { status: 'unchecked', runs, compared: 0, exercised: 0, mismatchCount: 0, why }, atoms: [], rewrites: 0, takenBack: 0, body: fn.code, importDecl: '', untranslated: [], sentence: end(`${fn.name} could not be rewritten (${why}), so it stays as written`) };
    }
    const untranslated = [
      ...r.untranslated.map((u) => ({ form: u.form, text: one(fn.code.slice(u.start, u.end)).slice(0, 120), line: lineIn(fn, u.start), ...(u.reason ? { reason: u.reason } : {}) })),
      ...r.rejected.filter((x) => x.start !== undefined).map((x) => ({ form: x.form, text: one(x.source).slice(0, 120), line: lineIn(fn, x.start), reason: `taken back: ${x.diagnosis?.cause ?? 'it changed behaviour'}` })),
    ].sort((a, b) => a.line - b.line);
    const c = r.check;
    const check = { status: c.status === 'same' || c.status === 'different' ? c.status : 'unchecked', runs, compared: c.compared ?? 0, exercised: c.exercised ?? 0, mismatchCount: c.mismatchCount ?? 0, ...(c.why ? { why: one(c.why) } : {}) };
    // A rewrite counts only when the check ran it and says same.
    const counts = r.converted > 0 && check.status === 'same' && check.compared > 0;
    if (r.converted > 0 && !counts) {
      const why = check.why ?? (check.status === 'different' ? 'it still behaved differently' : 'no generated input reached it');
      return { ...base, status: 'unchecked', check: { ...check, status: check.status === 'different' ? 'different' : 'unchecked', why }, atoms: [], rewrites: 0, takenBack: r.rejected.length, body: fn.code, importDecl: '', untranslated, sentence: end(`${fn.name} stays as written: its rewrite could not be checked (${why})`) };
    }
    if (!counts) {
      return { ...base, status: 'unchanged', check, atoms: [], rewrites: 0, takenBack: r.rejected.length, body: fn.code, importDecl: '', untranslated, sentence: end(untranslated.length ? `${fn.name} has nothing an atom covers yet: ${plural(untranslated.length, 'part')} ${untranslated.length === 1 ? 'goes' : 'go'} to the repair step` : `${fn.name} has nothing to rewrite`) };
    }
    const atoms = atomsCalled(r.body, atomNames);
    const status = untranslated.length ? 'partial' : 'converted';
    const ran = `checked on ${check.compared} generated input${check.compared === 1 ? '' : 's'}`;
    return {
      ...base, status, check, atoms, rewrites: r.converted, takenBack: r.rejected.length, body: r.body, importDecl: r.importDecl ? fromPackage(r.importDecl) : importOf(atoms), untranslated,
      sentence: end(status === 'converted' ? `${fn.name} is ${plural(atoms.length, 'atom call')} now, ${ran}` : `${fn.name} is ${plural(atoms.length, 'atom')} now, ${ran}; ${plural(untranslated.length, 'part')} with no atom ${untranslated.length === 1 ? 'goes' : 'go'} to the repair step`),
    };
  }

  /**
   * Construct's check of a repaired body (repairLoop's `check`): every part an atom call (the transform finds nothing
   * left to rewrite or leave), and the same behaviour as the original on the same generated inputs. `passed`: how many
   * of the original's untranslated parts are gone, so repairLoop stops when a try does not improve.
   * @param {{code: string, name: string, source: string, untranslated: any[], abs?: string, exact?: boolean}} fn
   * @param {string} body
   * @returns {{ok: boolean, refusal: any, passed: number}}
   */
  function check(fn, body) {
    const refuse = (sentence, passed = 0) => ({ ok: false, refusal: { sentence: end(sentence), rule: BREAKDOWN_RULE, code: 'NOT_ATOMIC', finding: null, fixes: [] }, passed });
    if (typeof body !== 'string' || !body.trim()) return refuse('The repaired function is empty');
    let left;
    try { left = mods.transform.toAtoms(body, { catalog: compiled, kind: 'function' }); } catch (e) { return refuse(`The repaired function does not parse (${one(/** @type {any} */ (e)?.message ?? e).slice(0, 120)})`); }
    const before = fn.untranslated?.length ?? 0;
    const remaining = left.untranslated.length + left.converted;
    const passed = Math.max(0, before - left.untranslated.length);
    if (remaining) return refuse(`The repaired function still has ${plural(remaining, 'part')} that ${remaining === 1 ? 'is' : 'are'} not an atom call, the first: ${one(body.slice((left.untranslated[0] ?? left.sites[0]).start, (left.untranslated[0] ?? left.sites[0]).end)).slice(0, 80)}`, passed);
    const atoms = atomsCalled(body, atomNames);
    let res;
    try {
      res = converter.checkPair({ original: fn.code, converted: body, importDecl: importOf(atoms), kind: 'function', types: typesOf(fn.source), runs, seed: hash(fn.name), atomKinds: {}, paramTypes: paramTypesOf(fn) });
    } catch (e) { return refuse(`The repaired function could not be run (${one(/** @type {any} */ (e)?.message ?? e).slice(0, 120)})`, passed); }
    if (res.status !== 'same' || !res.compared) {
      const m = res.mismatches?.[0];
      return refuse(res.status === 'different' ? `The repaired function behaves differently${m ? `: on ${one(m.input).slice(0, 60)} the original gives ${one(m.original?.out).slice(0, 40)} and the repair ${one(m.converted?.out).slice(0, 40)}` : ''}` : `The repaired function could not be checked (${one(res.why ?? 'no generated input reached it')})`, passed);
    }
    return { ok: true, refusal: null, passed: before };
  }

  /**
   * The behaviour test of a written function (line.import.writeAtoms): the function as the app file now has it, run
   * against the original on the same generated inputs as the breakdown's check (same seed). Passes only when the check
   * compared at least one input and says same.
   * @param {{name: string, code: string, source?: string, abs?: string}} fn The original (`code`); `source`/`abs`: the
   *   written file's text and path (its types and the checker's parameter types).
   * @param {string} written The function as written.
   * @returns {{ok: boolean, compared: number, sentence: string}}
   */
  function behaves(fn, written) {
    let res;
    try {
      res = converter.checkPair({ original: fn.code, converted: written, importDecl: importOf(atomsCalled(written, atomNames)), kind: 'function', types: typesOf(fn.source ?? ''), runs, seed: hash(fn.name), atomKinds: {}, paramTypes: paramTypesOf({ code: written, abs: fn.abs, exact: Boolean(fn.abs) }) });
    } catch (e) { return { ok: false, compared: 0, sentence: end(`${fn.name} as written could not be run (${one(/** @type {any} */ (e)?.message ?? e).slice(0, 120)})`) }; }
    if (res.status === 'same' && res.compared > 0) return { ok: true, compared: res.compared, sentence: end(`${fn.name} as written behaves as the original on ${plural(res.compared, 'generated input')}`) };
    const m = res.mismatches?.[0];
    return {
      ok: false, compared: res.compared ?? 0,
      sentence: end(res.status === 'different' ? `${fn.name} as written behaves differently from the original${m ? `: on ${one(m.input).slice(0, 60)} the original gives ${one(m.original?.out).slice(0, 40)} and the written one ${one(m.converted?.out).slice(0, 40)}` : ''}` : `${fn.name} as written could not be checked (${one(res.why ?? 'no generated input reached it')})`),
    };
  }

  return { ok: true, codemod: links.codemod.head, runtime: links.runtime.head, catalog: compiled, breakDown, check, behaves, atomsIn: (body) => atomsCalled(body, atomNames), dispose: () => { try { converter.dispose(); } catch { /* already gone */ } } };
}

// ------------------------------------------------------------------------------------------------- an import's breakdown

const COUNT_KEYS = ['converted', 'partial', 'unchanged', 'unchecked'];

/**
 * The counts and the one sentence of a breakdown, from its units. Pure.
 * @param {import('./contract.mjs').AtomUnitResult[]} units
 * @returns {{counts: import('./contract.mjs').AtomBreakdownCounts, sentence: string}}
 */
export function breakdownCounts(units) {
  /** @type {any} */
  const counts = { functions: units.length, rewrites: 0, takenBack: 0, refused: 0, repaired: 0 };
  for (const k of COUNT_KEYS) counts[k] = units.filter((u) => u.status === k).length;
  for (const u of units) {
    counts.rewrites += u.rewrites; counts.takenBack += u.takenBack;
    if (u.untranslated.length && u.status !== 'unchecked') counts.refused += 1;
    if (u.repair?.outcome === 'repaired') counts.repaired += 1;
  }
  if (!units.length) return { counts, sentence: 'No domain function to break down into atoms.' };
  const parts = [`${counts.converted} of ${plural(units.length, 'domain function')} ${counts.converted === 1 ? 'is' : 'are'} atom calls now, each checked against the original in QuickJS`];
  if (counts.partial) parts.push(`${counts.partial} ${counts.partial === 1 ? 'is' : 'are'} partly atoms`);
  if (counts.refused) parts.push(`${counts.refused} ${counts.refused === 1 ? 'has' : 'have'} parts with no atom, sent to the repair step${counts.repaired ? ` (${counts.repaired} repaired)` : ''}`);
  if (counts.unchecked) parts.push(`${counts.unchecked} could not be checked and ${counts.unchecked === 1 ? 'stays' : 'stay'} as written`);
  if (counts.takenBack) parts.push(`${plural(counts.takenBack, 'rewrite')} changed behaviour and ${counts.takenBack === 1 ? 'was' : 'were'} taken back`);
  return { counts, sentence: end(parts.join('; ')) };
}

/**
 * The domain functions of a FitProposal: each `from` of a domain block that names a top-level function, read from disk.
 * Values and types (no function body) are left out.
 * @param {string} root
 * @param {any} fit The saved fit ({proposal, steps}).
 * @returns {{file: string, name: string, block: string, code: string, line: number, source: string, abs: string, exact: boolean}[]}
 */
export function domainFunctions(root, fit) {
  const out = [];
  for (const b of fit?.proposal?.blocks ?? []) {
    if (b.kind !== 'domain') continue;
    for (const from of b.from ?? []) {
      const at = from.lastIndexOf('#');
      if (at < 0) continue;
      const file = from.slice(0, at);
      const name = from.slice(at + 1);
      const abs = path.join(root, file);
      let source;
      try { source = fs.readFileSync(abs, 'utf8'); } catch { continue; }
      const fn = functionOf(source, name, file);
      if (fn) out.push({ file, name, block: `domain:${b.name}`, ...fn, source, abs });
    }
  }
  return out;
}

/**
 * The refusal construct.repair gets for one function with untranslated parts: the option is the function as it stands
 * (the kept rewrite), the finding lists the parts.
 * @param {import('./contract.mjs').AtomUnitResult} u
 * @returns {{option: {tool: string, args: {file: string, name: string, body: string}}, refusal: {sentence: string, rule: string, code: string, finding: string, fixes: any[]}}}
 */
export function refusalOf(u) {
  const list = u.untranslated.slice(0, 5).map((p) => `${p.text} (line ${p.line}${p.reason ? `, ${p.reason}` : ''})`).join(', ');
  return {
    option: { tool: ATOMS_TOOL, args: { file: u.file, name: u.name, body: u.body } },
    refusal: {
      sentence: end(`${plural(u.untranslated.length, 'part')} of ${u.name} ${u.untranslated.length === 1 ? 'has' : 'have'} no atom, so the function is not atom calls yet`),
      rule: BREAKDOWN_RULE, code: 'UNTRANSLATED', finding: `Rewrite with atoms the runtime has: ${list}${u.untranslated.length > 5 ? ` and ${u.untranslated.length - 5} more` : ''}.`, fixes: [],
    },
  };
}

/**
 * The static breakdown of an import's domain functions. Never throws: links down -> an `off` breakdown with one
 * sentence (the import carries on without it).
 * @param {string} root
 * @param {any} fit The saved fit ({proposal, steps}).
 * @param {{env?: NodeJS.ProcessEnv, runs?: number, create?: typeof createStaticBreakdown}} [o] `create`: the converter
 *   (tests pass the mock's).
 * @returns {Promise<{breakdown: import('./contract.mjs').AtomBreakdown, refusals: ReturnType<typeof refusalOf>[], check: (option: any) => {ok: boolean, refusal: any, passed: number}, settle: (option: any, attempt: any) => void, dispose: () => void}>}
 */
export async function breakDownImport(root, fit, o = {}) {
  const fns = domainFunctions(root, fit);
  const sb = await (o.create ?? createStaticBreakdown)(o);
  if (!sb.ok) {
    const reason = end(/** @type {any} */ (sb).reason);
    const { counts } = breakdownCounts([]);
    const breakdown = { via: /** @type {const} */ ('off'), codemod: null, runtime: null, units: [], counts: { ...counts, functions: 0 }, reason, sentence: end(`The static breakdown into atoms is off (${reason.replace(/\.$/, '')}), so the import carries on without it`) };
    assertAtomBreakdown(breakdown);
    return { breakdown, refusals: [], check: () => ({ ok: false, refusal: { sentence: reason, rule: BREAKDOWN_RULE, code: 'OFF', finding: null, fixes: [] }, passed: 0 }), settle: () => {}, dispose: () => {} };
  }
  const units = fns.map((fn) => sb.breakDown(fn));
  const fnOf = (option) => {
    const i = units.findIndex((u) => u.file === option?.args?.file && u.name === option?.args?.name);
    return i < 0 ? null : { i, fn: { ...fns[i], untranslated: units[i].untranslated } };
  };
  const breakdown = { via: /** @type {const} */ ('static'), codemod: short(sb.codemod), runtime: short(sb.runtime), units, ...breakdownCounts(units) };
  /** @type {Map<string, number>} */
  const failures = new Map();
  assertAtomBreakdown(breakdown);
  return {
    breakdown,
    refusals: units.filter((u) => u.untranslated.length && u.status !== 'unchecked').map(refusalOf),
    // Construct's check of a repaired body. From the AST_AFTER_FAILURES-th refusal of one function on, the refusal also
    // carries the syntax trees of the parts with no atom: repairLoop shows the model each earlier refusal's sentence, so
    // its next attempts reason from the tree, not only from the text.
    check: (option) => {
      const hit = fnOf(option);
      if (!hit) return { ok: false, refusal: { sentence: 'The repair names a function the breakdown does not have.', rule: BREAKDOWN_RULE, code: 'UNKNOWN', finding: null, fixes: [] }, passed: 0 };
      const res = sb.check(hit.fn, option.args.body);
      if (res.ok) return res;
      const key = `${option.args.file}#${option.args.name}`;
      const n = (failures.get(key) ?? 0) + 1;
      failures.set(key, n);
      if (n < AST_AFTER_FAILURES) return res;
      const trees = hit.fn.untranslated.slice(0, 3).map((p) => `${p.text} is ${syntaxTreeOf(p.text)}`).filter((t) => !t.endsWith(' is ')).join('; ');
      return trees ? { ...res, refusal: { ...res.refusal, sentence: end(`${res.refusal.sentence.replace(/[.?!]$/, '')}. Syntax tree of the parts with no atom: ${trees}`), ast: trees } } : res;
    },
    // repairLoop's answer: a repaired body (Construct's check passed) replaces the kept rewrite; any other outcome is
    // kept on the unit, and the parts stay for a person.
    settle: (option, attempt) => {
      const hit = fnOf(option);
      if (!hit || !attempt) return;
      const u = units[hit.i];
      const said = end(attempt.sentence ?? attempt.outcome);
      if (attempt.outcome === 'repaired' && attempt.option?.args?.body) {
        const body = attempt.option.args.body;
        const atoms = sb.atomsIn(body);
        units[hit.i] = { ...u, status: 'converted', body, atoms, importDecl: importOf(atoms), rewrites: Math.max(1, u.rewrites + u.untranslated.length), check: { ...u.check, status: 'same', compared: Math.max(1, u.check.compared) }, untranslated: [], repair: { outcome: attempt.outcome, sentence: said }, sentence: end(`${u.name} is atom calls now: the repair step rewrote ${plural(u.untranslated.length, 'part')} and the check says it behaves the same`) };
      } else units[hit.i] = { ...u, repair: { outcome: String(attempt.outcome ?? 'unknown'), sentence: said } };
      Object.assign(breakdown, breakdownCounts(units));
      assertAtomBreakdown(breakdown);
    },
    dispose: sb.dispose,
  };
}
