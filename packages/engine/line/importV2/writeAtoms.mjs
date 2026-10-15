// Line Import v2, line.import.writeAtoms (owner, 2026-10-14, option C): write one converted function of the static
// breakdown (line/atoms.json) into its app file, through Construct's writer as a plan step. The step counts only after
// its behaviour test passes: the function as written, read back from the file, run against the original in QuickJS on
// the breakdown's generated inputs (the same check, same seed). The test runs twice: on the planned file before anything
// is written (a different result refuses the step) and on the file as the writer left it (the step's `tests` check).
//
// The app gets the atoms through @line/atoms: the change also copies the pinned functional atoms (packages/line-atoms
// functional/, generated) into <library>/atoms/line/ once, and gives the folder's tsconfig.json the alias
// `@line/atoms` -> that copy. Nothing is published; LINE-ATOM does not read the atoms kind.
//
// The written function also gets its read-only English view (ENGLISH-RULES step 6, fluent plan T2.4, englishView.mjs):
// each atom call as its fluent sentence. The app keeps the typed code; the view is generated from it, shown with the
// planned change (`english`) and recorded on the unit with `written` once the behaviour test passes.
//
//   planWriteAtoms(folderRoot, {folder, file, name}, tester)  -> StagedChange & {behaviour}   (pure, but for tester)
//   runAtomsBehaviour(folderRoot, behaviour, tester)          -> {ok, sentence}   the test on the written file
//   markWritten(folderRoot, {folder, file, name}, sentence, tester?)  records the passed test and the English view on the
//                                                             unit in line/atoms.json
//   createAtomsTester(o)                                      -> {ok: true, behaves, english} | {ok: false, reason}, once per process
import fs from 'node:fs';
import path from 'node:path';
import { ts } from '@construct/ast';
import { loadConfig } from '@line/construct-core/config';
import { normalizeLineConfig } from '@line/construct-core/profiles/line/contract';
import { resolveLayout } from '@line/construct-core/profiles/line/checks';
import { functionalFiles } from '@line/atoms/runtime';
import { writeLineState } from '../../transactionalWriter.mjs';
import { LineOpError, assertStagedChange } from '../contract.mjs';
import { ATOMS_FILE, ATOMS_PACKAGE, assertAtomBreakdown } from './contract.mjs';
import { createStaticBreakdown, functionOf, functionStatement } from './breakdown.mjs';
import { englishViewOf, englishWriter } from './englishView.mjs';

/** The folder of the library's atoms kind the functional atoms are copied into. */
export const ATOMS_COPY_DIR = 'line';
const TSCONFIG = 'tsconfig.json';

const one = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const lower = (s) => s.charAt(0).toLowerCase() + s.slice(1);

/** The folder's Line layout (its library and features folders); defaults when it has no config. */
function layoutOf(root) {
  let line;
  try { line = normalizeLineConfig(/** @type {any} */ (loadConfig(root)).line); } catch { line = normalizeLineConfig(undefined); }
  return resolveLayout(root, line);
}

const readOrNull = (abs) => { try { return fs.readFileSync(abs, 'utf8'); } catch { return null; } };

/** The folder's breakdown, or a NO_BREAKDOWN refusal. */
function breakdownOf(folderRoot) {
  const text = readOrNull(path.join(folderRoot, ATOMS_FILE));
  if (text === null) throw new LineOpError('This import folder has no breakdown into atoms yet, so there is nothing to write; run the import up to classify first.', 'NO_BREAKDOWN');
  return JSON.parse(text);
}

/** The folder-relative path of a project-relative file, or an UNKNOWN_FILE refusal. */
function inFolder(folder, file) {
  const f = String(file ?? '');
  const rel = folder && f.startsWith(`${folder}/`) ? f.slice(folder.length + 1) : null;
  if (!rel || rel.split('/').some((s) => s === '' || s === '.' || s === '..')) throw new LineOpError(`${f || 'The file'} is not a file inside the import folder ${folder}.`, 'UNKNOWN_FILE');
  return rel;
}

/** The names a module declares or imports at the top level. */
function topLevelNames(sf) {
  const names = new Set();
  const add = (n) => { if (n && ts.isIdentifier(n)) names.add(n.text); };
  for (const st of sf.statements) {
    if (ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st) || ts.isEnumDeclaration(st) || ts.isInterfaceDeclaration(st) || ts.isTypeAliasDeclaration(st)) add(st.name);
    else if (ts.isVariableStatement(st)) for (const d of st.declarationList.declarations) add(d.name);
    else if (ts.isImportDeclaration(st) && st.importClause) {
      const c = st.importClause;
      add(c.name);
      if (c.namedBindings && ts.isNamespaceImport(c.namedBindings)) add(c.namedBindings.name);
      if (c.namedBindings && ts.isNamedImports(c.namedBindings)) for (const e of c.namedBindings.elements) add(e.name);
    }
  }
  return names;
}

/**
 * The file with the atoms imported from @line/atoms: merged into an existing (value) import of it, else a new import
 * after the last import (or after the directive prologue, e.g. 'use client'). Pure.
 * @param {string} source
 * @param {string[]} atoms
 * @param {string} file
 * @returns {string}
 */
export function withAtomsImport(source, atoms, file = 'x.ts') {
  if (!atoms.length) return source;
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, /\.[jt]sx$/.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const imports = sf.statements.filter(ts.isImportDeclaration);
  const ours = imports.find((d) => ts.isStringLiteral(d.moduleSpecifier) && d.moduleSpecifier.text === ATOMS_PACKAGE && !d.importClause?.isTypeOnly && !d.importClause?.name && d.importClause?.namedBindings && ts.isNamedImports(d.importClause.namedBindings));
  if (ours) {
    const have = /** @type {any} */ (ours.importClause.namedBindings).elements.map((e) => e.getText(sf));
    const names = [...new Set([...have, ...atoms])].sort();
    return `${source.slice(0, ours.getStart(sf))}import { ${names.join(', ')} } from '${ATOMS_PACKAGE}';${source.slice(ours.end)}`;
  }
  const decl = `import { ${[...atoms].sort().join(', ')} } from '${ATOMS_PACKAGE}';`;
  const last = imports.at(-1);
  if (last) return `${source.slice(0, last.end)}\n${decl}${source.slice(last.end)}`;
  const prologue = sf.statements.filter((st, i) => sf.statements.slice(0, i + 1).every((x) => ts.isExpressionStatement(x) && ts.isStringLiteral(x.expression))).at(-1);
  if (prologue) return `${source.slice(0, prologue.end)}\n${decl}${source.slice(prologue.end)}`;
  return `${decl}\n${source}`;
}

/**
 * The folder's tsconfig.json with `@line/atoms` aliased to the copy, or null when it already is. Paths are relative to
 * `baseUrl` when one is set, else to the tsconfig. Comments in an existing tsconfig are not kept (the file is rewritten
 * as JSON).
 * @param {string|null} text The current tsconfig.json, or null when there is none.
 * @param {string} entry Folder-relative path of the copy's index.ts.
 * @returns {string|null}
 */
export function withAtomsAlias(text, entry) {
  const parsed = text === null ? { config: {} } : ts.parseConfigFileTextToJson(TSCONFIG, text);
  if (parsed.error || !parsed.config || typeof parsed.config !== 'object') throw new LineOpError(`${TSCONFIG} of the import folder does not parse, so Line cannot give it the ${ATOMS_PACKAGE} alias; fix it first.`, 'BAD_CONFIG');
  const cfg = parsed.config;
  const co = (cfg.compilerOptions ??= {});
  const base = typeof co.baseUrl === 'string' ? co.baseUrl : '.';
  let rel = path.posix.relative(path.posix.normalize(base), entry);
  if (!rel.startsWith('.')) rel = `./${rel}`;
  if (Array.isArray(co.paths?.[ATOMS_PACKAGE]) && co.paths[ATOMS_PACKAGE].length === 1 && co.paths[ATOMS_PACKAGE][0] === rel) return null;
  co.paths = { ...(co.paths ?? {}), [ATOMS_PACKAGE]: [rel] };
  return `${JSON.stringify(cfg, null, 2)}\n`;
}

/**
 * Plan writing one converted function into its app file. Pure but for `tester` (the QuickJS behaviour test).
 * @param {string} folderRoot The import folder (the writer's root).
 * @param {{folder?: string, file?: string, name?: string}} req `file`: project-relative, as the breakdown names it.
 * @param {undefined | {ok: false, reason: string} | {ok: true, behaves: (fn: any, written: string) => {ok: boolean, sentence: string}}} [tester]
 *   undefined: plan only (a preview, a gap); otherwise the behaviour test must run and pass before anything is written.
 * @returns {import('../contract.mjs').StagedChange & {behaviour: {file: string, name: string, code: string}, english: import('./contract.mjs').EnglishView}}
 * @throws {LineOpError} NO_BREAKDOWN, UNKNOWN_FILE, UNKNOWN_ITEM, NOT_CONVERTED, STALE, NAME_TAKEN, BAD_CONFIG,
 *   NOT_CHECKED (the test cannot run) or BEHAVIOUR (the planned function behaves differently).
 */
export function planWriteAtoms(folderRoot, req = {}, tester) {
  const folder = String(req.folder ?? '');
  const name = String(req.name ?? '');
  const rel = inFolder(folder, req.file);
  const b = breakdownOf(folderRoot);
  const unit = (b.units ?? []).find((u) => u.file === req.file && u.name === name);
  if (!unit) throw new LineOpError(`The breakdown has no function ${name} in ${req.file}.`, 'UNKNOWN_ITEM');
  if (unit.status !== 'converted') throw new LineOpError(`${name} is not all atom calls yet (${unit.status}), so there is nothing to write; its parts with no atom need the repair step or a person first.`, 'NOT_CONVERTED');
  const source = readOrNull(path.join(folderRoot, rel));
  if (source === null) throw new LineOpError(`There is no file ${req.file} in the import folder.`, 'UNKNOWN_FILE');
  const now = functionOf(source, name, rel);
  const at = functionStatement(source, name, rel);
  if (!now || !at) throw new LineOpError(`${name} is not a top-level function of ${req.file} any more, so Line cannot write it.`, 'STALE');
  if (one(now.code) !== one(unit.code)) throw new LineOpError(`${name} in ${req.file} changed since it was broken down into atoms; run the breakdown again before writing it.`, 'STALE');
  const sf = ts.createSourceFile(rel, source, ts.ScriptTarget.Latest, true, /\.[jt]sx$/.test(rel) ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const taken = topLevelNames(sf);
  const ownImport = sf.statements.filter(ts.isImportDeclaration).filter((d) => ts.isStringLiteral(d.moduleSpecifier) && d.moduleSpecifier.text === ATOMS_PACKAGE).flatMap((d) => (d.importClause?.namedBindings && ts.isNamedImports(d.importClause.namedBindings) ? d.importClause.namedBindings.elements.map((e) => e.name.text) : []));
  const clash = unit.atoms.filter((a) => a === name || (taken.has(a) && !ownImport.includes(a)));
  if (clash.length) throw new LineOpError(`${req.file} already has ${clash.join(', ')}, the name of ${clash.length === 1 ? 'an atom' : 'atoms'} ${name} calls; rename it first.`, 'NAME_TAKEN');

  const replaced = `${source.slice(0, at.start)}${at.prefix}${unit.body}${source.slice(at.end)}`;
  const content = withAtomsImport(replaced, unit.atoms, rel);
  const written = functionOf(content, name, rel);
  if (tester !== undefined) {
    if (!tester.ok) throw new LineOpError(`The behaviour test cannot run (${lower(one(/** @type {any} */ (tester).reason).replace(/\.$/, ''))}), so ${name} is not written.`, 'NOT_CHECKED');
    const r = tester.behaves({ name, code: unit.code, source: content }, written?.code ?? '');
    if (!r.ok) throw new LineOpError(`${name} is not written: ${lower(r.sentence)}`, 'BEHAVIOUR');
  }

  const { library } = layoutOf(folderRoot);
  const dir = `${library}/atoms/${ATOMS_COPY_DIR}`;
  const copies = functionalFiles().map((f) => ({ path: `${dir}/${f.rel}`, content: f.content }));
  const alias = withAtomsAlias(readOrNull(path.join(folderRoot, TSCONFIG)), `${dir}/index.ts`);
  const english = englishOf(unit, tester);
  const change = {
    summary: `Writes ${name} as atom calls into ${req.file}, importing ${unit.atoms.join(', ')} from ${ATOMS_PACKAGE} (the pinned atoms copied into ${dir}, aliased in ${TSCONFIG}). ${english.sentence}`,
    files: [{ path: rel, content }, ...copies, ...(alias ? [{ path: TSCONFIG, content: alias }] : [])],
    behaviour: { file: rel, name, code: unit.code },
    english,
  };
  assertStagedChange(change);
  return change;
}

/** The read-only English view of the unit's body as written, through the tester's English writer (off without one). */
const englishOf = (unit, tester) => englishViewOf({ name: unit.name, body: unit.body, atoms: unit.atoms }, tester?.ok ? /** @type {any} */ (tester).english : tester);

/**
 * The behaviour test on the file as the writer left it: the function read back from disk against the original.
 * @param {string} folderRoot
 * @param {{file: string, name: string, code: string}} behaviour From the planned change.
 * @param {undefined | {ok: false, reason: string} | {ok: true, behaves: (fn: any, written: string) => {ok: boolean, sentence: string}}} tester
 * @returns {{ok: boolean, sentence: string}}
 */
export function runAtomsBehaviour(folderRoot, behaviour, tester) {
  if (!tester?.ok) return { ok: false, sentence: `The behaviour test could not run${tester && !tester.ok ? ` (${lower(one(/** @type {any} */ (tester).reason).replace(/\.$/, ''))})` : ''}, so ${behaviour.name} is not confirmed.` };
  const abs = path.join(folderRoot, behaviour.file);
  const source = readOrNull(abs);
  const fn = source === null ? null : functionOf(source, behaviour.name, behaviour.file);
  if (!fn) return { ok: false, sentence: `${behaviour.name} is not in ${behaviour.file} as written, so its behaviour test failed.` };
  return tester.behaves({ name: behaviour.name, code: behaviour.code, source, abs }, fn.code);
}

/**
 * Record on the unit that it was written and its behaviour test passed (line/atoms.json, through writeLineState), with
 * the read-only English view of the body as written.
 * @param {string} folderRoot
 * @param {{folder?: string, file?: string, name?: string}} req
 * @param {string} sentence The passed test's sentence.
 * @param {any} [tester] The run's tester; its `english` writer makes the view (off without one).
 * @returns {boolean} False when the breakdown has no such unit.
 */
export function markWritten(folderRoot, req, sentence, tester) {
  const b = breakdownOf(folderRoot);
  const unit = (b.units ?? []).find((u) => u.file === req.file && u.name === req.name);
  if (!unit) return false;
  unit.written = { file: String(req.file), sentence };
  unit.english = englishOf(unit, tester);
  assertAtomBreakdown(b);
  writeLineState(folderRoot, ATOMS_FILE, `${JSON.stringify(b)}\n`);
  return true;
}

/** @type {Map<string, Promise<any>>} */
const testers = new Map();

/**
 * The behaviour tester: the linked static breakdown's `behaves`, created once per process (QuickJS stays loaded).
 * Never throws: links down -> {ok: false, reason}.
 * @param {{env?: NodeJS.ProcessEnv, create?: typeof createStaticBreakdown}} [o] `create`: tests pass the mock's.
 * @returns {Promise<{ok: true, behaves: (fn: any, written: string) => {ok: boolean, sentence: string}, english: ReturnType<typeof englishWriter>} | {ok: false, reason: string}>}
 */
export function createAtomsTester(o = {}) {
  if (o.create) return /** @type {Promise<any>} */ (o.create(o).then(toTester));
  const key = JSON.stringify([o.env?.SMITH_FUNCTIONAL_SOURCE_DIR ?? process.env.SMITH_FUNCTIONAL_SOURCE_DIR ?? '', o.env?.ATOMS_CODEMOD_SOURCE_DIR ?? process.env.ATOMS_CODEMOD_SOURCE_DIR ?? '']);
  if (!testers.has(key)) testers.set(key, createStaticBreakdown(o).then(toTester).catch((e) => ({ ok: false, reason: one(e?.message ?? e) || 'the atom runtime could not be prepared' })));
  return /** @type {Promise<any>} */ (testers.get(key));
}
// The English writer reads the same catalog the breakdown converted with; a breakdown may hand its own (`english`).
const toTester = (sb) => (sb.ok ? { ok: true, behaves: sb.behaves, english: sb.english ?? englishWriter(sb.catalog) } : { ok: false, reason: sb.reason });
