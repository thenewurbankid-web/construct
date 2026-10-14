// briefBuilder (#941, arm H): a deterministic, model-free stand-in for the 7b driver. Uses the TypeScript compiler
// API to pull the target function's exact signature, the types in scope (local types, the props of imported and
// context components, the fixture's element type), adds the task's SPEC excerpt and a per-kind worked example, and
// returns one code-shaped brief per function to write plus the header ("prelude") the file needs first.
//
//   buildBriefs({ task, file, read }) -> { prelude, briefs: [{ name, exists, brief, approxTokens }] }
//   read(path) returns a workspace file's text (paths relative to the workspace root).
import { dirname, relative, basename, extname, join, normalize } from 'node:path';
import { ts, parse, declName, isDirective, signatures } from '../lib/edit.mjs';
import { templates } from './templates.mjs';
import { fnGoal } from './prefill.mjs';

export const approxTokens = (s) => Math.ceil(s.length / 3.2);
const FIXTURE = 'library/fixtures/books.json';

const relImport = (fromFile, toFile) => {
  let r = relative(dirname(fromFile), toFile).replace(/\.(tsx?|mjs)$/, '');
  return r.startsWith('.') ? r : `./${r}`;
};
const exportedValueNames = (path, text) => parse(text, path).statements
  .filter((s) => s.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) && (ts.isFunctionDeclaration(s) || ts.isVariableStatement(s) || ts.isClassDeclaration(s)))
  .map(declName).filter(Boolean);

// The element type of a JSON array fixture, from its first entry.
export function fixtureType(name, rows) {
  const row = rows[0] ?? {};
  const t = (v) => (Array.isArray(v) ? 'string[]' : typeof v === 'object' && v ? 'Record<string, unknown>' : typeof v);
  return `type ${name} = { ${Object.entries(row).map(([k, v]) => `${k}: ${t(v)}`).join('; ')} };`;
}

// Function signatures the task statement spells out, e.g. "listPicks(): string[]" (used when the file has none yet).
export function goalSignatures(goal) {
  return [...goal.matchAll(/\b([a-z][A-Za-z0-9]*)\(([^()]*)\):\s*([A-Za-z][\w<>\[\]| ]*?)(?=[\s,.(;)]|$)/g)]
    .map((m) => ({ name: m[1], signature: `export function ${m[1]}(${m[2]}): ${m[3].trim()}` }));
}

function importedSignatures(target, file, read) {
  const out = [];
  for (const st of parse(file, target).statements.filter(ts.isImportDeclaration)) {
    const spec = st.moduleSpecifier.text;
    if (!spec.startsWith('.') || spec.endsWith('.json')) continue;
    const base = normalize(join(dirname(target), spec));
    const path = ['.tsx', '.ts'].map((e) => base + e).find((p) => { try { read(p); return true; } catch { return false; } });
    if (path) out.push(`// ${path}\n${signatures(path, read(path))}`);
  }
  return out;
}

export function buildBriefs({ task, file, read, targetName = null }) {
  const tpl = templates[task.kind];
  if (!tpl) throw new Error(`no template for kind "${task.kind}"`);
  const sf = parse(file, task.target);

  // Prelude: the header the function will rely on, added deterministically before the model writes anything.
  const prelude = [];
  if (tpl.needs.includes('state')) prelude.push("'use client';", "import { useState } from 'react';");
  const contextFiles = task.context.filter((p) => /\.tsx?$/.test(p));
  for (const p of contextFiles) {
    const names = exportedValueNames(p, read(p));
    if (names.length) prelude.push(`import { ${names.join(', ')} } from '${relImport(task.target, p)}';`);
  }
  let fixtureRows = null;
  if (tpl.needs.includes('fixture') || /books\.json/.test(file)) fixtureRows = JSON.parse(read(FIXTURE));
  if (tpl.needs.includes('fixture')) {
    prelude.push(`import books from '${relImport(task.target, FIXTURE)}';`);
    if (!sf.statements.some((s) => declName(s) === 'Book')) prelude.push(fixtureType('Book', fixtureRows));
  }

  // Types in scope: local types, the fixture's shape, the imported and context components' signatures.
  const local = sf.statements.filter((s) => ts.isTypeAliasDeclaration(s) || ts.isInterfaceDeclaration(s)).map((s) => s.getText(sf));
  const fromPrelude = prelude.filter((l) => l.startsWith('type '));
  const imported = importedSignatures(task.target, file, read);
  const ctx = contextFiles.filter((p) => !imported.some((s) => s.startsWith(`// ${p}\n`))).map((p) => `// ${p}\n${signatures(p, read(p))}`);
  const types = [...local, ...fromPrelude, ...imported, ...ctx].join('\n\n');

  // Functions to write: the file's exported function named like the file, else the ones the goal spells out.
  const own = basename(task.target, extname(task.target));
  const existing = sf.statements.find((s) => ts.isFunctionDeclaration(s) && s.name?.text === own)
    ?? sf.statements.find((s) => ts.isFunctionDeclaration(s) && s.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword));
  const asTarget = (fn) => ({ name: fn.name.text, exists: true, signature: file.slice(fn.getStart(sf), fn.body.getStart(sf)).trim(), current: fn.getText(sf) });
  let targets = existing
    ? [asTarget(existing)]
    : goalSignatures(task.goal).map((g) => ({ ...g, exists: false, current: null }));
  if (targetName) {
    // One named function (a repair round, or the next store function): its current text if the file has it.
    const fn = sf.statements.find((s) => ts.isFunctionDeclaration(s) && s.name?.text === targetName && s.body);
    const g = goalSignatures(task.goal).find((x) => x.name === targetName);
    targets = fn ? [asTarget(fn)] : g ? [{ ...g, exists: false, current: null }] : [];
  }

  const lang = task.target.endsWith('.tsx') ? 'tsx' : 'ts';
  // A function the task statement declares (a store's listX(): T) gets a TASK line narrowed to it alone (fnGoal);
  // other mentions in a goal (e.g. a store call a page makes) are left as they are.
  const goalNames = goalSignatures(task.goal).map((g) => g.name);
  const taskLine = (name) => (goalNames.includes(name) ? fnGoal(task.goal, name, goalNames) : task.goal);
  const briefs = targets.map((t) => {
    const brief = [
      `FUNCTION: ${t.name} in ${task.target}. ${t.exists ? 'Rewrite it.' : 'Write it (it does not exist yet).'}`,
      `SIGNATURE: ${t.signature}`,
      `TASK: ${taskLine(t.name)}`,
      `SPEC:\n${task.spec}`,
      `ALREADY AT THE TOP OF THE FILE:\n${[...parse(file, task.target).statements.filter((s) => ts.isImportDeclaration(s) || isDirective(s)).map((s) => s.getText(sf)), ...prelude.filter((l) => !l.startsWith('type '))].filter((v, i, a) => a.indexOf(v) === i).sort((a, b) => Number(b.startsWith("'use")) - Number(a.startsWith("'use"))).join('\n')}`,
      types ? `TYPES IN SCOPE:\n${types}` : null,
      `HOW (a ${task.kind} change):\n${tpl.change.map((c) => `- ${c}`).join('\n')}`,
      `EXAMPLE (same pattern, other data):\n\`\`\`${lang}\n${tpl.example}\n\`\`\``,
      t.current ? `CURRENT ${t.name}:\n\`\`\`${lang}\n${t.current}\n\`\`\`` : null,
      `Reply with only the complete new function ${t.name} in one \`\`\`${lang} block: no imports, no other declarations.`,
    ].filter(Boolean).join('\n\n');
    return { name: t.name, exists: t.exists, brief, approxTokens: approxTokens(brief) };
  });
  return { prelude, briefs };
}
