// spliceApplier (#941, arm H): replaces one function in a file by name, using the AST. The model's reply must hold
// exactly one complete function with the expected name (import lines and a 'use client' directive are ignored:
// the prelude already put the header in place). Anything else is rejected as failure class "fragment".
//
//   applyPrelude(file, preludeLines, path) -> new file text (imports merged by module, directive first, types added)
//   spliceFunction(file, reply, name, path) -> { ok, body } | { ok: false, failClass: 'format'|'fragment', detail }
import { ts, parse, declName, isDirective, fencedBlocks, spliceDeclarations } from '../lib/edit.mjs';

export function applyPrelude(file, lines, path = 'x.tsx') {
  if (!lines.length) return file;
  const r = spliceDeclarations(file, `\`\`\`tsx\n${lines.join('\n')}\n\`\`\``, { requireDecl: false });
  return r.ok ? r.body : file;
}

const isFunctionLike = (st) => ts.isFunctionDeclaration(st)
  || (ts.isVariableStatement(st) && st.declarationList.declarations.length === 1
    && /^(ArrowFunction|FunctionExpression)$/.test(ts.SyntaxKind[st.declarationList.declarations[0].initializer?.kind]));

export function spliceFunction(file, reply, name, path = 'x.tsx') {
  const blocks = fencedBlocks(reply);
  if (!blocks.length) return { ok: false, failClass: 'format', detail: /```/.test(reply) ? 'unclosed code fence' : 'no code fence' };
  const block = blocks.reduce((a, b) => (b.length > a.length ? b : a));
  const inc = parse(block, path);
  if (inc.parseDiagnostics?.length) return { ok: false, failClass: 'fragment', detail: `reply does not parse: ${ts.flattenDiagnosticMessageText(inc.parseDiagnostics[0].messageText, ' ')}` };
  const rest = inc.statements.filter((s) => !ts.isImportDeclaration(s) && !isDirective(s));
  if (rest.length !== 1) return { ok: false, failClass: 'fragment', detail: `reply has ${rest.length} top-level statements, expected one function (${rest.map((s) => declName(s) ?? ts.SyntaxKind[s.kind]).join(', ')})` };
  const fn = rest[0];
  if (!isFunctionLike(fn)) return { ok: false, failClass: 'fragment', detail: `reply is a ${ts.SyntaxKind[fn.kind]}, not a function` };
  if (declName(fn) !== name) return { ok: false, failClass: 'fragment', detail: `reply is function ${declName(fn)}, expected ${name}` };
  if (ts.isFunctionDeclaration(fn) && !fn.body) return { ok: false, failClass: 'fragment', detail: 'function has no body' };

  const sf = parse(file, path);
  const old = sf.statements.find((s) => declName(s) === name);
  let text = fn.getText(inc);
  const exported = (s) => s.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
  // Keep the original's export: dropping it would break every importer.
  if ((old ? exported(old) : true) && !exported(fn)) text = `export ${text}`;
  if (!old) {
    const body = file.replace(/\s*export\s*\{\s*\};?\s*$/, '\n'); // a stub's placeholder `export {}` goes away
    return { ok: true, body: `${body.replace(/\s*$/, '\n\n')}${text}\n` };
  }
  const body = file.slice(0, old.getStart(sf, false)) + text + file.slice(old.getEnd());
  return { ok: true, body };
}
