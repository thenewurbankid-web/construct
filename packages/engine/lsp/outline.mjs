// #950 -- one file's outline for the persistent index (lsp/store): its exported signatures and its references (the
// imports it makes, resolved inside the project). Syntactic plus module resolution, no type checker, so it is cheap
// enough to run on every file the background indexer touches, and deterministic for a given (file, content).
//
//   exportsOf(rel, text)                       -> [{ name, kind, signature }]   one line per exported declaration
//   refsOf(root, rel, text, options)           -> [{ from, names, file }]       file: the resolved project file or null
//   directImportsOf(refs)                      -> [rel]                          the project files a file imports
import path from 'node:path';
import { ts, inside } from './host.mjs';

const MAX_SIG = 200;
const posix = (p) => p.split(path.sep).join('/');
const kindOfScript = (rel) => (/\.tsx$/.test(rel) ? ts.ScriptKind.TSX : /\.jsx$/.test(rel) ? ts.ScriptKind.JSX : /\.(m|c)?js$/.test(rel) ? ts.ScriptKind.JS : ts.ScriptKind.TS);
const oneLine = (s) => s.replace(/\s+/g, ' ').trim().slice(0, MAX_SIG);
const exported = (st) => !!ts.getCombinedModifierFlags(st) && (ts.getCombinedModifierFlags(st) & ts.ModifierFlags.Export) !== 0;

/** The declaration's text up to its body (a function's signature, a class's heading, a const's declared type). */
function headOf(sf, node, body) {
  const start = node.getStart(sf);
  const end = body ? body.getStart(sf) : node.getEnd();
  return oneLine(sf.text.slice(start, end).replace(/^export\s+(default\s+)?/, '').replace(/[{=]\s*$/, ''));
}

/**
 * Every exported declaration of a file as one line: functions with their signature, classes/interfaces/types/enums
 * with their heading, consts with their declared type (or `= <arrow signature>`), re-exports as `export * from`.
 * @param {string} rel Root-relative file (its extension picks TS/TSX/JS).
 * @param {string} text Its content.
 * @returns {{name: string, kind: string, signature: string}[]}
 */
export function exportsOf(rel, text) {
  const sf = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true, kindOfScript(rel));
  const out = [];
  for (const st of sf.statements) {
    if (ts.isExportDeclaration(st)) {
      const from = st.moduleSpecifier && ts.isStringLiteral(st.moduleSpecifier) ? st.moduleSpecifier.text : null;
      if (st.exportClause && ts.isNamedExports(st.exportClause)) for (const e of st.exportClause.elements) out.push({ name: e.name.text, kind: 'reexport', signature: oneLine(`export { ${e.propertyName ? `${e.propertyName.text} as ` : ''}${e.name.text} }${from ? ` from '${from}'` : ''}`) });
      else if (from) out.push({ name: '*', kind: 'reexport', signature: `export * from '${from}'` });
      continue;
    }
    if (ts.isExportAssignment(st)) { out.push({ name: 'default', kind: 'default', signature: oneLine(`export default ${st.expression.getText(sf)}`) }); continue; }
    if (!exported(st)) continue;
    const isDefault = (ts.getCombinedModifierFlags(st) & ts.ModifierFlags.Default) !== 0;
    if (ts.isFunctionDeclaration(st)) out.push({ name: isDefault ? 'default' : st.name?.text ?? 'default', kind: 'function', signature: headOf(sf, st, st.body) });
    else if (ts.isClassDeclaration(st)) out.push({ name: isDefault ? 'default' : st.name?.text ?? 'default', kind: 'class', signature: oneLine(headOf(sf, st, st.members[0] ?? null).replace(/\{.*$/, '')) });
    else if (ts.isInterfaceDeclaration(st)) out.push({ name: st.name.text, kind: 'interface', signature: oneLine(headOf(sf, st, null)) });
    else if (ts.isTypeAliasDeclaration(st)) out.push({ name: st.name.text, kind: 'type', signature: oneLine(headOf(sf, st, null)) });
    else if (ts.isEnumDeclaration(st)) out.push({ name: st.name.text, kind: 'enum', signature: oneLine(`enum ${st.name.text}`) });
    else if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) {
        if (!ts.isIdentifier(d.name)) continue;
        const init = d.initializer;
        let sig = `const ${d.name.text}`;
        if (d.type) sig += `: ${d.type.getText(sf)}`;
        else if (init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))) sig += ` = ${oneLine(sf.text.slice(init.getStart(sf), init.body.getStart(sf))).replace(/=>\s*$/, '=>')} ...`;
        out.push({ name: d.name.text, kind: init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) ? 'function' : 'const', signature: oneLine(sig) });
      }
    }
  }
  return out;
}

const hosts = new Map();
/** Module resolution that only ever looks inside the project (host.mjs's containment): nothing outside is probed. */
function containedHost(root) {
  if (!hosts.has(root)) {
    const ok = (p) => inside(root, path.resolve(p));
    hosts.set(root, {
      fileExists: (p) => ok(p) && ts.sys.fileExists(p),
      readFile: (p) => (ok(p) ? ts.sys.readFile(p) : undefined),
      directoryExists: (p) => ok(p) && ts.sys.directoryExists(p),
      realpath: (p) => p,
      getCurrentDirectory: () => root,
      getDirectories: (p) => (ok(p) ? ts.sys.getDirectories(p) : []),
    });
  }
  return hosts.get(root);
}

/**
 * The file's imports (import/export-from/require/dynamic import), each resolved with the project's compiler options;
 * `file` is the root-relative target when it resolves inside the project (never node_modules), else null.
 * @param {string} root Project root.
 * @param {string} rel Root-relative file.
 * @param {string} text Its content.
 * @param {any} options Compiler options (host.readOptions(root).options).
 * @returns {{from: string, names: string[], file: string|null}[]}
 */
export function refsOf(root, rel, text, options) {
  const abs = path.join(root, rel);
  const names = new Map(); // specifier -> imported names
  try {
    const sf = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, false, kindOfScript(rel));
    for (const st of sf.statements) {
      if (!(ts.isImportDeclaration(st) || ts.isExportDeclaration(st)) || !st.moduleSpecifier || !ts.isStringLiteral(st.moduleSpecifier)) continue;
      const list = names.get(st.moduleSpecifier.text) ?? [];
      if (ts.isImportDeclaration(st) && st.importClause) {
        if (st.importClause.name) list.push('default');
        const nb = st.importClause.namedBindings;
        if (nb && ts.isNamedImports(nb)) for (const e of nb.elements) list.push((e.propertyName ?? e.name).text);
        else if (nb) list.push('*');
      } else if (ts.isExportDeclaration(st)) {
        if (st.exportClause && ts.isNamedExports(st.exportClause)) for (const e of st.exportClause.elements) list.push((e.propertyName ?? e.name).text);
        else list.push('*');
      }
      names.set(st.moduleSpecifier.text, list);
    }
  } catch { /* unparsable: preProcessFile below still finds the specifiers */ }
  const out = [];
  const seen = new Set();
  for (const im of ts.preProcessFile(text, true, true).importedFiles) {
    if (seen.has(im.fileName)) continue;
    seen.add(im.fileName);
    let file = null;
    if (options) {
      const r = ts.resolveModuleName(im.fileName, abs, options, containedHost(root)).resolvedModule?.resolvedFileName;
      const a = r ? path.resolve(r) : null;
      if (a && inside(root, a) && !a.includes(`${path.sep}node_modules${path.sep}`)) file = posix(path.relative(root, a));
    }
    out.push({ from: im.fileName, names: [...new Set(names.get(im.fileName) ?? [])], file });
  }
  return out;
}

/**
 * The project files a file imports, from its refs.
 * @param {{file: string|null}[]} refs refsOf().
 * @returns {string[]}
 */
export const directImportsOf = (refs) => [...new Set((refs ?? []).map((r) => r.file).filter(Boolean))];
