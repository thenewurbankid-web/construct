// Reads TypeScript's own lib.es5 .. lib.es2023 declaration files through the TypeScript 7
// compiler API (typescript/unstable/sync) and returns every interface member, global
// function and namespace function as plain data. Deterministic: sorted, no network.
import { API } from 'typescript/unstable/sync';
import { SyntaxKind } from 'typescript/unstable/ast';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';

const LIB_FILE = /^lib\.es(5|20(1[5-9]|2[0-3]))(\.[a-z0-9]+)*\.d\.ts$/;

function stripTrivia(text) {
  let s = text;
  for (;;) {
    const before = s;
    s = s.replace(/^\s+/, '').replace(/^\/\*[\s\S]*?\*\//, '').replace(/^\/\/[^\n]*\n?/, '');
    if (s === before) return s.trim();
  }
}

function leadingDoc(text) {
  const m = text.match(/^(\s*(\/\*[\s\S]*?\*\/|\/\/[^\n]*\n))*/);
  return m ? m[0] : '';
}

export function extractLib(root) {
  const dir = mkdtempSync(join(tmpdir(), 'smith-lib-'));
  writeFileSync(join(dir, 'empty.ts'), 'export {};\n');
  writeFileSync(join(dir, 'tsconfig.json'), JSON.stringify({ compilerOptions: { lib: ['es2023'], noEmit: true, types: [] }, files: ['empty.ts'] }));
  const api = new API({ cwd: root });
  try {
    const snapshot = api.updateSnapshot({ openProjects: [join(dir, 'tsconfig.json')] });
    const program = snapshot.getProjects()[0].program;
    const files = program.getSourceFileNames().filter((f) => LIB_FILE.test(basename(f))).sort();
    const interfaces = new Map(); // name -> { typeParams, members: [] }
    const globals = []; // declare function f(...)
    const namespaces = new Map(); // name -> members
    const vars = new Map(); // declare var X: Y
    for (const file of files) {
      const sf = program.getSourceFile(file);
      const text = sf.text;
      const t = (node) => (node ? stripTrivia(text.slice(node.pos, node.end)) : undefined);
      const lib = basename(file);
      const sig = (node, kind) => {
        const raw = text.slice(node.pos, node.end);
        const params = (node.parameters ?? []).map((p) => ({
          name: t(p.name),
          type: t(p.type) ?? 'any',
          optional: Boolean(p.questionToken) || Boolean(p.initializer),
          rest: Boolean(p.dotDotDotToken),
        }));
        return {
          kind,
          typeParams: (node.typeParameters ?? []).map(t),
          params,
          returns: t(node.type) ?? 'void',
          deprecated: /@deprecated/.test(leadingDoc(raw)),
          lib,
        };
      };
      const memberOf = (m) => {
        switch (m.kind) {
          case SyntaxKind.MethodSignature:
          case SyntaxKind.MethodDeclaration:
            return m.name.kind === SyntaxKind.ComputedPropertyName
              ? { name: t(m.name), computed: true, ...sig(m, 'method') }
              : { name: t(m.name), ...sig(m, 'method') };
          case SyntaxKind.PropertySignature:
            return { name: t(m.name), kind: 'property', computed: m.name.kind === SyntaxKind.ComputedPropertyName, type: t(m.type), deprecated: /@deprecated/.test(leadingDoc(text.slice(m.pos, m.end))), lib };
          case SyntaxKind.CallSignature:
            return { name: '()', ...sig(m, 'call') };
          case SyntaxKind.ConstructSignature:
            return { name: 'new', ...sig(m, 'construct') };
          case SyntaxKind.IndexSignature:
            return { name: '[index]', kind: 'index', lib };
          default:
            return { name: `?${SyntaxKind[m.kind]}`, kind: 'other', lib };
        }
      };
      for (const st of sf.statements) {
        if (st.kind === SyntaxKind.InterfaceDeclaration) {
          const name = st.name.text;
          const entry = interfaces.get(name) ?? { typeParams: [], members: [] };
          if (entry.typeParams.length === 0 && st.typeParameters) entry.typeParams = st.typeParameters.map(t);
          for (const m of st.members) entry.members.push(memberOf(m));
          interfaces.set(name, entry);
        } else if (st.kind === SyntaxKind.FunctionDeclaration && st.name) {
          globals.push({ name: st.name.text, ...sig(st, 'global') });
        } else if (st.kind === SyntaxKind.ModuleDeclaration) {
          const name = t(st.name);
          const list = namespaces.get(name) ?? [];
          const body = st.body;
          for (const inner of body?.statements ?? []) {
            if (inner.kind === SyntaxKind.FunctionDeclaration && inner.name) list.push({ name: inner.name.text, ...sig(inner, 'method') });
            else list.push({ name: inner.name ? t(inner.name) : '?', kind: 'other', lib });
          }
          namespaces.set(name, list);
        } else if (st.kind === SyntaxKind.VariableStatement) {
          for (const d of st.declarationList.declarations) vars.set(t(d.name), t(d.type));
        }
      }
    }
    return { files: files.map((f) => basename(f)), interfaces, globals, namespaces, vars };
  } finally {
    api.close();
    rmSync(dir, { recursive: true, force: true });
  }
}
