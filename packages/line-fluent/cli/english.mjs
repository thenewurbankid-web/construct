// `construct english <file>`: read-only English view of each top-level function in a file.
// Registered through the plugin-command registry (docs/CLI-COMMAND-REGISTRY.md) via the
// `construct.commands` field in this package's package.json. Contract: docs/line/FLUENT-PLAN-2026-10-15.md,
// "Wave 2 leaves", t2-2-english-cli.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const toEnglishPath = fileURLToPath(new URL('../../line-codemod/to-english.js', import.meta.url));
const codemodRequire = createRequire(toEnglishPath);
const { toEnglish, PARSE_PLUGINS } = codemodRequire(toEnglishPath);
const parser = codemodRequire('@babel/parser');

const USAGE = 'construct english <file> [--json]';

const isFn = (node) => node && (node.type === 'ArrowFunctionExpression' || node.type === 'FunctionExpression');

// Top-level functions: `function f() {}` and `const f = () => ...` / `const f = function () {}`,
// bare or behind `export` / `export default`. Each item carries the source slice toEnglish describes.
export function topLevelFunctions(source) {
  const ast = parser.parse(source, { sourceType: 'module', plugins: PARSE_PLUGINS });
  const out = [];
  for (const stmt of ast.program.body) {
    const decl = (stmt.type === 'ExportNamedDeclaration' || stmt.type === 'ExportDefaultDeclaration') && stmt.declaration
      ? stmt.declaration
      : stmt;
    if (decl.type === 'FunctionDeclaration' && decl.id) {
      out.push({ name: decl.id.name, line: decl.loc.start.line, code: source.slice(decl.start, decl.end) });
    } else if (decl.type === 'VariableDeclaration') {
      for (const d of decl.declarations) {
        if (d.id.type !== 'Identifier' || !isFn(d.init)) continue;
        const code = `${decl.kind} ${source.slice(d.start, d.end)};`;
        out.push({ name: d.id.name, line: d.loc.start.line, code });
      }
    }
  }
  return out;
}

// The view with each function's code kept beside its English; the Cockpit's English panel (GET /api/line/english,
// ui/server/src/lineApi.mjs) shows the code as collapsed technical detail.
export function englishDetail(source) {
  return topLevelFunctions(source).map(({ name, line, code }) => ({
    name,
    line,
    english: toEnglish(code, 'function').english,
    code,
  }));
}

export function englishView(source) {
  return englishDetail(source).map(({ name, line, english }) => ({ name, line, english }));
}

// Returns the exit code; writes through the injected streams so tests run in-process.
export function runEnglish(args, { stdout = process.stdout, stderr = process.stderr } = {}) {
  const json = args.includes('--json');
  // `--dir <path>` is the CLI's discovery root (docs/CLI-COMMAND-REGISTRY.md); its value is not the file.
  const file = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--dir');
  if (!file) {
    stderr.write(`Usage: ${USAGE}\n`);
    return 1;
  }
  let source;
  try {
    source = readFileSync(file, 'utf8');
  } catch {
    stderr.write(`Cannot read ${file}.\n`);
    return 1;
  }
  let view;
  try {
    view = englishView(source);
  } catch (e) {
    const where = e.loc ? ` at line ${e.loc.line}` : '';
    stderr.write(`Cannot parse ${file}${where}.\n`);
    return 1;
  }
  if (json) stdout.write(`${JSON.stringify(view, null, 2)}\n`);
  else stdout.write(view.map((v) => `${v.name}: ${v.english}\n`).join(''));
  return 0;
}

export const commands = [
  {
    name: 'english',
    summary: 'Read-only English view of each top-level function in a file',
    usage: USAGE,
    handler: async (args) => {
      const code = runEnglish(args);
      if (code) process.exitCode = code;
    },
  },
];
