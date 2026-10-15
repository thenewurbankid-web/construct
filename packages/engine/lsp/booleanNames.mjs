// NAME-002 (owner rule): a function whose return type is boolean, or a boolean type guard (`x is T`), is named with
// one of the prefixes is / has / can / should / does (a hook: useIs..., useHas..., ...). The return type comes from the
// TypeScript language service (lsp/host.mjs: the checker's signature of the declaration, and quickInfo for the line a
// person reads), never from the name. Each finding carries a typed fix: the rename (`withinPath` -> `isWithinPath`)
// and every edit it needs across the project (findRenameLocations), not applied.
//
//   booleanNameProblems(root, rel, {text})    -> [{ name, line, returns, suggested, guard }]   one file
//   renameEdits(root, rel, name, to, {text})  -> [{ file, start, end, newText }]               the rename, not applied
//   validateBooleanNames(root, opts)          the enforcer `construct validate` runs (severity: rules NAME-002)
//   booleanNameOf(rel, source, fn, {root})    one function, for atomicGate (with a root: the project's types)
//
// Severity (architecture.yml `rules: NAME-002`): `severity` for existing code (default warning), `generated` for code
// Line generates (default error; atomicGate). Either may be off, warning or error.
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from '@line/construct-core/config';
import { makeViolation } from '@line/construct-core/diagnostics';
import { ts, openProject, withOverlay, inside, tsLibDir } from './host.mjs';

export const BOOLEAN_PREFIXES = Object.freeze(['is', 'has', 'can', 'should', 'does']);
export const NAME_002 = 'NAME-002';
export const NAME_002_DEFAULTS = Object.freeze({ severity: 'warning', generated: 'error' });
const PREFIXED = new RegExp(`^[_$]*(?:(?:${BOOLEAN_PREFIXES.join('|')})|use(?:${BOOLEAN_PREFIXES.map((p) => p[0].toUpperCase() + p.slice(1)).join('|')}))(?=[A-Z0-9_$]|$)`);
const WHY = 'A boolean answers a yes/no question; an is/has/can/should/does name says so at every call site (`if (isWithinPath(a, b))` reads as the question it asks), without opening the function.';

/**
 * Whether a name carries a boolean prefix.
 * @param {string} name
 * @returns {boolean}
 */
export const hasBooleanPrefix = (name) => PREFIXED.test(String(name));

/**
 * The name NAME-002 suggests: `is` + the name (`withinPath` -> `isWithinPath`); a hook keeps `use` first (`useMobile` ->
 * `useIsMobile`).
 * @param {string} name
 * @returns {string}
 */
export function suggestBooleanName(name) {
  const lead = /^[_$]*/.exec(name)[0];
  const rest = name.slice(lead.length);
  if (/^use[A-Z]/.test(rest)) return `${lead}useIs${rest.slice(3)}`;
  return `${lead}is${rest[0].toUpperCase()}${rest.slice(1)}`;
}

/** Named function-like declarations in a source file: declarations, `const f = () =>` / function expressions, methods. */
function namedFunctions(sf) {
  const out = [];
  const visit = (n) => {
    if (ts.isFunctionDeclaration(n) && n.name && n.body) out.push({ decl: n, nameNode: n.name });
    else if (ts.isMethodDeclaration(n) && ts.isIdentifier(n.name) && n.body) out.push({ decl: n, nameNode: n.name });
    else if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer && (ts.isArrowFunction(n.initializer) || ts.isFunctionExpression(n.initializer))) out.push({ decl: n.initializer, nameNode: n.name });
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

/** Whether a signature returns boolean, or is a boolean type guard (`x is T`, `this is T`; not `asserts x`). */
function booleanReturn(checker, decl) {
  const sig = checker.getSignatureFromDeclaration(decl);
  if (!sig) return null;
  const pred = checker.getTypePredicateOfSignature(sig);
  if (pred && (pred.kind === ts.TypePredicateKind.Identifier || pred.kind === ts.TypePredicateKind.This)) return { guard: true };
  const ret = checker.getReturnTypeOfSignature(sig);
  const isBool = (t) => !!(t.flags & ts.TypeFlags.BooleanLike);
  if (isBool(ret) || (ret.isUnion() && ret.types.length > 0 && ret.types.every(isBool))) return { guard: false };
  return null;
}

/** Problems of one parsed file against a checker (and, when given, the language service for quickInfo). */
function problemsIn(sf, checker, svc, abs) {
  const out = [];
  for (const { decl, nameNode } of namedFunctions(sf)) {
    const name = nameNode.text;
    if (hasBooleanPrefix(name)) continue;
    const b = booleanReturn(checker, decl);
    if (!b) continue;
    const q = svc?.getQuickInfoAtPosition(abs, nameNode.getStart(sf));
    const returns = q ? ts.displayPartsToString(q.displayParts).replace(/\s+/g, ' ').slice(0, 200) : `${name}(): boolean`;
    out.push({ name, line: sf.getLineAndCharacterOfPosition(nameNode.getStart(sf)).line + 1, pos: nameNode.getStart(sf), returns, guard: b.guard, suggested: suggestBooleanName(name) });
  }
  return out;
}

/**
 * NAME-002 problems of one project file, read through the project's language service.
 * @param {string} root Project root (with a tsconfig.json; without one nothing is checked).
 * @param {string} rel Root-relative file.
 * @param {{text?: string}} [o] `text`: an unsaved buffer for the file.
 * @returns {{name: string, line: number, pos: number, returns: string, guard: boolean, suggested: string}[]}
 */
export function booleanNameProblems(root, rel, o = {}) {
  const r = path.resolve(root);
  const abs = path.resolve(r, rel);
  const proj = openProject(r);
  if (proj.ok === false) return [];
  return withOverlay(proj.entry, abs, o.text, () => {
    const program = proj.service.getProgram();
    const sf = program?.getSourceFile(abs);
    return sf ? problemsIn(sf, program.getTypeChecker(), proj.service, abs) : [];
  });
}

/**
 * Every edit renaming `name` (declared in `rel`) to `to`, across the project (findRenameLocations), not applied.
 * @param {string} root Project root.
 * @param {string} rel Root-relative file that declares it.
 * @param {string} name The current name.
 * @param {string} to The new name.
 * @param {{text?: string}} [o]
 * @returns {{file: string, start: number, end: number, newText: string}[]}
 */
export function renameEdits(root, rel, name, to, o = {}) {
  const r = path.resolve(root);
  const abs = path.resolve(r, rel);
  const proj = openProject(r);
  if (proj.ok === false) return [];
  return withOverlay(proj.entry, abs, o.text, () => {
    const sf = proj.service.getProgram()?.getSourceFile(abs);
    const hit = sf && namedFunctions(sf).find((f) => f.nameNode.text === name);
    if (!hit) return [];
    const locs = proj.service.findRenameLocations(abs, hit.nameNode.getStart(sf), false, false, { providePrefixAndSuffixTextForRename: true }) ?? [];
    return locs.filter((l) => inside(r, path.resolve(l.fileName))).map((l) => ({
      file: path.relative(r, path.resolve(l.fileName)).split(path.sep).join('/'),
      start: l.textSpan.start, end: l.textSpan.start + l.textSpan.length, newText: `${l.prefixText ?? ''}${to}${l.suffixText ?? ''}`,
    })).sort((a, b) => a.file.localeCompare(b.file) || a.start - b.start);
  });
}

/**
 * NAME-002's two severities for a project: `severity` (existing code) and `generated` (code Line generates).
 * @param {string} root
 * @returns {{severity: string, generated: string}}
 */
export function name002Severity(root) {
  let raw;
  try { raw = loadConfig(root).rules?.[NAME_002]; } catch { raw = null; }
  if (typeof raw === 'string') return { ...NAME_002_DEFAULTS, severity: raw };
  return { severity: raw?.severity ?? NAME_002_DEFAULTS.severity, generated: raw?.generated ?? NAME_002_DEFAULTS.generated };
}

/** One NAME-002 finding as a violation, with its typed rename fix. */
function violationOf(root, rel, p, severity) {
  const v = makeViolation({
    rule: NAME_002, module: 'readability', severity, file: rel, line: p.line,
    message: `${p.name} ${p.guard ? 'is a boolean type guard' : 'returns boolean'} (${p.returns}) but its name does not start with ${BOOLEAN_PREFIXES.join(', ')}.`,
    why: WHY, expected: [p.suggested], suggestedFix: `Rename ${p.name} to ${p.suggested} (every reference is renamed with it).`,
  });
  const edits = renameEdits(root, rel, p.name, p.suggested);
  return { ...v, fixes: [{ id: `${NAME_002}/rename:${p.suggested}`, sentence: `Rename ${p.name} to ${p.suggested} (${edits.length} edit${edits.length === 1 ? '' : 's'}: the declaration and every reference).`, step: { tool: 'lsp.rename', args: { file: rel, from: p.name, to: p.suggested } }, edits }] };
}

const CODE = /\.(tsx?|mts|cts)$/;
/** TypeScript's lib files, parsed once for every one-file program (they never change in a process). */
const LIB_CACHE = new Map();
/**
 * The NAME-002 enforcer: every TypeScript file of the project (or `opts.files`), through one language service.
 * @param {string} root Project root.
 * @param {{files?: string[], generated?: boolean}} [opts] `generated`: the code is Line's own output (its severity).
 * @returns {{violations: object[]}}
 */
export function validateBooleanNames(root, opts = {}) {
  const r = path.resolve(root);
  const sev = name002Severity(r);
  const severity = opts.generated ? sev.generated : sev.severity;
  if (severity === 'off' || !fs.existsSync(path.join(r, 'tsconfig.json'))) return { violations: [] };
  const proj = openProject(r);
  if (proj.ok === false) return { violations: [] };
  const rels = (opts.files ?? proj.files.map((f) => path.relative(r, f).split(path.sep).join('/'))).filter((f) => CODE.test(f) && !/\.d\.ts$/.test(f));
  const program = proj.service.getProgram();
  if (!program) return { violations: [] };
  const checker = program.getTypeChecker();
  const violations = [];
  for (const rel of rels) {
    const abs = path.resolve(r, rel);
    const sf = program.getSourceFile(abs);
    if (!sf) continue;
    for (const p of problemsIn(sf, checker, proj.service, abs)) violations.push(violationOf(r, rel, p, severity));
  }
  return { violations };
}

/**
 * NAME-002 for one function, for atomicGate: with a root, through the project's language service (its imports'
 * types); without one, a one-file program (explicit annotations, guards and local inference).
 * @param {string} rel Root-relative file.
 * @param {string} source Its text.
 * @param {string} fn The function's name.
 * @param {{root?: string|null}} [o]
 * @returns {{name: string, line: number, returns: string, guard: boolean, suggested: string} | null} The problem, or null.
 */
export function booleanNameOf(rel, source, fn, o = {}) {
  if (o.root && fs.existsSync(path.join(o.root, 'tsconfig.json'))) return booleanNameProblems(o.root, rel, { text: source }).find((p) => p.name === fn) ?? null;
  const file = path.resolve('/__gate__', rel);
  const options = { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.Preserve, strict: true, noEmit: true, lib: ['lib.es2020.d.ts', 'lib.dom.d.ts'] };
  const host = ts.createCompilerHost(options);
  const base = { ...host };
  const lib = (f, lang) => { if (!LIB_CACHE.has(f)) LIB_CACHE.set(f, base.getSourceFile(f, lang)); return LIB_CACHE.get(f); };
  host.getSourceFile = (f, lang) => (path.resolve(f) === file ? ts.createSourceFile(f, source, lang, true, /\.tsx$/.test(rel) ? ts.ScriptKind.TSX : ts.ScriptKind.TS) : f.startsWith(tsLibDir()) || /lib\..*\.d\.ts$/.test(f) ? lib(f, lang) : undefined);
  host.fileExists = (f) => path.resolve(f) === file || base.fileExists(f);
  host.readFile = (f) => (path.resolve(f) === file ? source : base.readFile(f));
  const program = ts.createProgram([file], options, host);
  const sf = program.getSourceFile(file);
  return sf ? problemsIn(sf, program.getTypeChecker(), null, file).find((p) => p.name === fn) ?? null : null;
}
