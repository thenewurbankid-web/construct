// The boolean naming rule: every exported atom that returns a boolean (or is a type guard)
// starts with is / has / can / should / does -- except the operator atoms listed in
// src/atoms/naming.json `booleanExempt`. Checked on the source AST via the TypeScript 7
// compiler API, so it covers hand-written and generated atoms alike.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { API } from 'typescript/unstable/sync';
import { SyntaxKind } from 'typescript/unstable/ast';

const root = new URL('..', import.meta.url).pathname;
const naming = JSON.parse(readFileSync(`${root}src/atoms/naming.json`, 'utf8'));
const prefix = new RegExp(`^(${naming.booleanPrefixes.join('|')})[A-Z]`);
const exempt = new Set(naming.booleanExempt);

function exportedFunctions() {
  const api = new API({ cwd: root });
  try {
    const program = api.updateSnapshot({ openProjects: [`${root}tsconfig.json`] }).getProjects()[0].program;
    const out = new Map(); // name -> { returns: [], file, untyped }
    for (const file of program.getSourceFileNames()) {
      if (!file.includes('/src/atoms/') && !file.includes('/src/fluent/')) continue;
      const sf = program.getSourceFile(file);
      for (const st of sf.statements) {
        if (st.kind !== SyntaxKind.FunctionDeclaration || !st.name) continue;
        const exported = (st.modifiers ?? []).some((m) => m.kind === SyntaxKind.ExportKeyword);
        if (!exported) continue;
        const name = st.name.text;
        const entry = out.get(name) ?? { returns: [], file, bodies: 0 };
        if (st.type) entry.returns.push(sf.text.slice(st.type.pos, st.type.end).trim());
        else entry.returns.push(null);
        out.set(name, entry);
      }
    }
    return out;
  } finally {
    api.close();
  }
}

const fns = exportedFunctions();

test('the naming check sees the atoms', () => {
  assert.ok(fns.size > 300, `only ${fns.size} exported functions found`);
});

test('every exported atom declares its return type (so the boolean rule cannot be dodged)', () => {
  const untyped = [...fns].filter(([, e]) => e.returns.includes(null)).map(([n, e]) => `${n} (${e.file.split('/src/')[1]})`);
  assert.deepStrictEqual(untyped, []);
});

test('boolean-returning atoms start with is/has/can/should/does (operators exempt)', () => {
  const isBool = (t) => t === 'boolean' || /^[\w$]+ is\s/.test(t) || /^asserts\s/.test(t);
  const offenders = [...fns]
    .filter(([name, e]) => !exempt.has(name) && e.returns.some((t) => t && isBool(t)) && !prefix.test(name))
    .map(([name]) => name);
  assert.deepStrictEqual(offenders, []);
});

test('the exempt list only names real operator atoms', () => {
  for (const name of exempt) assert.ok(fns.has(name), `${name} is exempt but not exported`);
});
