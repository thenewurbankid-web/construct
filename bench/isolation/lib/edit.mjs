// Edit-format appliers for the isolation harness (#941): declaration splice, search/replace, FIM assembly,
// and the signature-only view of a context file. Pure functions over strings; TypeScript's parser does the work.
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('typescript');

export { ts };
export const fencedBlocks = (reply) => [...reply.matchAll(/```[\w.+-]*[ \t]*\n([\s\S]*?)```/g)].map((m) => m[1]);
const longest = (xs) => xs.reduce((a, b) => (b.length > a.length ? b : a), '');
export const parse = (text, path = 'x.tsx') => ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

export function declName(st) {
  if (ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st) || ts.isTypeAliasDeclaration(st) || ts.isInterfaceDeclaration(st)) return st.name?.text ?? null;
  if (ts.isVariableStatement(st)) { const d = st.declarationList.declarations[0]; return d && ts.isIdentifier(d.name) ? d.name.text : null; }
  return null;
}
export const isDirective = (st) => ts.isExpressionStatement(st) && ts.isStringLiteral(st.expression) && /^use (client|server)$/.test(st.expression.text);

function mergeImport(existing, incoming) {
  // Union of named bindings; keep a default/namespace binding if either side has one.
  const names = new Set();
  let head = null;
  for (const st of [existing, incoming]) {
    const c = st.importClause;
    if (!c) continue;
    if (c.name) head = c.name.text;
    if (c.namedBindings && ts.isNamedImports(c.namedBindings)) for (const e of c.namedBindings.elements) names.add(e.getText());
    if (c.namedBindings && ts.isNamespaceImport(c.namedBindings)) return incoming.getText();
  }
  const typeOnly = existing.importClause?.isTypeOnly && incoming.importClause?.isTypeOnly ? 'type ' : '';
  const parts = [head, names.size ? `{ ${[...names].join(', ')} }` : null].filter(Boolean).join(', ');
  return `import ${typeOnly}${parts} from ${existing.moduleSpecifier.getText()};`;
}

// Splices every top-level declaration in the reply's (longest) fenced block into the file by name: a same-named
// declaration is replaced, a new one goes before the first function (or at the end). Import lines are merged by
// module, a 'use client' directive is put first. Returns { ok, body, detail }.
export function spliceDeclarations(file, reply, { requireDecl = true } = {}) {
  const block = longest(fencedBlocks(reply));
  if (!block.trim()) return { ok: false, detail: /```/.test(reply) ? 'unclosed code fence' : 'no code fence' };
  const src = parse(file);
  const inc = parse(block);
  const decls = inc.statements.filter((s) => declName(s));
  if (!decls.length && requireDecl) return { ok: false, detail: 'no named declaration in the reply' };
  let text = file;
  // Replace from the end so earlier offsets stay valid.
  const edits = [];
  const appended = [];
  for (const d of decls) {
    const name = declName(d);
    const old = src.statements.find((s) => declName(s) === name);
    if (old) edits.push({ start: old.getStart(src, true), end: old.getEnd(), text: d.getFullText(inc).replace(/^\s+/, '') });
    else appended.push(d.getFullText(inc).replace(/^\s+/, ''));
  }
  for (const imp of inc.statements.filter(ts.isImportDeclaration)) {
    const spec = imp.moduleSpecifier.text;
    const old = src.statements.find((s) => ts.isImportDeclaration(s) && s.moduleSpecifier.text === spec);
    if (old) edits.push({ start: old.getStart(src), end: old.getEnd(), text: mergeImport(old, imp) });
    else {
      const lastImport = [...src.statements].reverse().find(ts.isImportDeclaration);
      const at = lastImport ? lastImport.getEnd() : 0;
      edits.push({ start: at, end: at, text: (at ? '\n' : '') + imp.getText(inc) + (at ? '' : '\n') });
    }
  }
  if (appended.length) {
    const firstFn = src.statements.find((s) => ts.isFunctionDeclaration(s) || (ts.isVariableStatement(s) && /=>|function/.test(s.getText(src))));
    const at = firstFn ? firstFn.getStart(src, true) : text.length;
    edits.push({ start: at, end: at, text: appended.join('\n\n') + (firstFn ? '\n\n' : '\n') });
  }
  edits.sort((a, b) => b.start - a.start || b.end - a.end);
  for (const e of edits) text = text.slice(0, e.start) + e.text + text.slice(e.end);
  const wantsClient = inc.statements.some(isDirective) && !parse(text).statements.some(isDirective);
  if (wantsClient) text = `'use client';\n${text}`;
  return { ok: true, body: text.endsWith('\n') ? text : text + '\n' };
}

// Applies aider-style SEARCH/REPLACE blocks. An exact match is tried first, then a match that ignores each
// line's leading/trailing whitespace. Any block that matches nothing fails the whole edit (format).
export function applySearchReplace(file, reply) {
  const re = /<{5,9} ?SEARCH[^\n]*\n([\s\S]*?)\n?={5,9}[^\n]*\n([\s\S]*?)\n?>{5,9} ?REPLACE/g;
  const blocks = [...reply.matchAll(re)].map((m) => ({ search: m[1], replace: m[2] }));
  if (!blocks.length) return { ok: false, detail: 'no SEARCH/REPLACE block' };
  let text = file;
  for (const [i, b] of blocks.entries()) {
    if (!b.search.trim()) { text = text.replace(/\s*$/, '\n') + b.replace + '\n'; continue; }
    if (text.includes(b.search)) { text = text.replace(b.search, () => b.replace); continue; }
    const lines = text.split('\n');
    const want = b.search.split('\n').map((l) => l.trim()).filter((l, j, a) => !(l === '' && (j === 0 || j === a.length - 1)));
    let hit = -1;
    for (let s = 0; s + want.length <= lines.length && hit < 0; s++) if (want.every((w, k) => lines[s + k].trim() === w)) hit = s;
    if (hit < 0) return { ok: false, detail: `SEARCH block ${i + 1} not found in the file` };
    lines.splice(hit, want.length, ...b.replace.split('\n'));
    text = lines.join('\n');
  }
  return { ok: true, body: text.endsWith('\n') ? text : text + '\n' };
}

export const FILL = '/*FILL*/';
// Splits a driver-written skeleton at the FILL marker (the line holding it is dropped).
export function splitSkeleton(reply) {
  const block = longest(fencedBlocks(reply));
  const i = block.indexOf(FILL);
  if (i < 0) return { ok: false, detail: 'driver skeleton has no /*FILL*/ marker' };
  const lineStart = block.lastIndexOf('\n', i) + 1;
  const lineEnd = block.indexOf('\n', i);
  return { ok: true, prefix: block.slice(0, lineStart), suffix: lineEnd < 0 ? '' : block.slice(lineEnd + 1) };
}

// Signature-only view of a context file: exported types/interfaces in full, functions and constants as their
// signature with the body elided. Keeps a worker's context small while inlining the exact prop types.
export function signatures(path, text) {
  const sf = parse(text, path);
  const out = [];
  for (const st of sf.statements) {
    if (isDirective(st) || ts.isImportDeclaration(st)) continue;
    const exported = st.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
    if (!exported) continue;
    if (ts.isTypeAliasDeclaration(st) || ts.isInterfaceDeclaration(st)) out.push(st.getText(sf));
    else if (ts.isFunctionDeclaration(st) && st.body) out.push(text.slice(st.getStart(sf), st.body.getStart(sf)).trimEnd() + ' { ... }');
    else if (ts.isVariableStatement(st)) out.push(st.getText(sf).split('\n')[0] + (st.getText(sf).includes('\n') ? ' ...' : ''));
  }
  return out.join('\n\n');
}
