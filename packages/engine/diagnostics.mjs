// Read-only diagnostics for one source file: TypeScript compiler diagnostics
// (syntactic + semantic, resolved against the project's own tsconfig when it
// has one) plus Construct's architecture and separation-of-concerns rules.
// Deterministic, no LLM, never writes to disk. Reusable by the CLI and by
// ui/server's source-view route; the UI turns the result into editor markers.
//
// Every diagnostic is normalized to one shape, 1-based positions:
//   { source, code, severity, message, line, column, endLine, endColumn }
// source is 'typescript' | 'architecture' | 'separation-of-concerns'.
// Rule violations only carry a line, so they span that whole line.
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { validateArchitecture } from '../core/architecture-enforcer.mjs';
import { validateSeparationOfConcerns } from '../core/soc-enforcer.mjs';

const DEFAULT_COMPILER_OPTIONS = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  jsx: ts.JsxEmit.Preserve,
  allowJs: true,
  checkJs: false,
  skipLibCheck: true,
  strict: true,
  noEmit: true,
  esModuleInterop: true,
  resolveJsonModule: true,
};

const SEVERITY_BY_CATEGORY = {
  [ts.DiagnosticCategory.Error]: 'error',
  [ts.DiagnosticCategory.Warning]: 'warning',
  [ts.DiagnosticCategory.Suggestion]: 'info',
  [ts.DiagnosticCategory.Message]: 'info',
};

function compilerOptionsFor(absFile) {
  const configPath = ts.findConfigFile(path.dirname(absFile), ts.sys.fileExists, 'tsconfig.json');
  if (!configPath) return DEFAULT_COMPILER_OPTIONS;
  const read = ts.readConfigFile(configPath, ts.sys.readFile);
  if (read.error) return DEFAULT_COMPILER_OPTIONS;
  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, path.dirname(configPath));
  return { ...parsed.options, noEmit: true, skipLibCheck: true, incremental: false };
}

function fromTsDiagnostic(d, sf) {
  const message = ts.flattenDiagnosticMessageText(d.messageText, '\n');
  const base = { source: 'typescript', code: `TS${d.code}`, severity: SEVERITY_BY_CATEGORY[d.category] || 'error', message };
  if (d.start === undefined || !sf) return { ...base, line: 1, column: 1, endLine: 1, endColumn: 1 };
  const start = sf.getLineAndCharacterOfPosition(d.start);
  const end = sf.getLineAndCharacterOfPosition(d.start + (d.length || 0));
  return { ...base, line: start.line + 1, column: start.character + 1, endLine: end.line + 1, endColumn: end.character + 1 };
}

/** TypeScript diagnostics for `source` as if it lived at `absFile`. Other
 * files come from disk. Syntactic errors short-circuit the (expensive,
 * cascade-prone) semantic pass. */
export function typescriptDiagnostics(absFile, source) {
  const options = compilerOptionsFor(absFile);
  const host = ts.createCompilerHost(options, true);
  const readFile = host.readFile.bind(host);
  const getSourceFile = host.getSourceFile.bind(host);
  host.readFile = (f) => (path.resolve(f) === absFile ? source : readFile(f));
  host.getSourceFile = (f, lang, onError, shouldCreate) =>
    path.resolve(f) === absFile ? ts.createSourceFile(f, source, lang, true) : getSourceFile(f, lang, onError, shouldCreate);
  const program = ts.createProgram({ rootNames: [absFile], options, host });
  const sf = program.getSourceFile(absFile);
  if (!sf) return [];
  const syntactic = program.getSyntacticDiagnostics(sf);
  const found = syntactic.length ? syntactic : program.getSemanticDiagnostics(sf);
  return found.map((d) => fromTsDiagnostic(d, sf));
}

function fromViolation(v, lines) {
  const line = Math.max(1, Number(v.line) || 1);
  const text = lines[line - 1] ?? '';
  return {
    source: v.module,
    code: v.rule,
    severity: v.severity === 'error' ? 'error' : v.severity === 'warning' ? 'warning' : 'info',
    message: v.message,
    line,
    column: 1,
    endLine: line,
    endColumn: text.length + 1,
  };
}

/** Architecture + separation-of-concerns violations attributed to relPath
 * (as the file currently exists on disk). */
export function ruleDiagnostics(root, relPath, source) {
  const lines = source.split('\n');
  const arch = validateArchitecture(root, { files: [relPath] }).violations.filter((v) => v.file === relPath);
  const soc = validateSeparationOfConcerns(root).violations.filter((v) => v.file === relPath);
  return [...arch, ...soc].filter((v) => v.severity !== 'off').map((v) => fromViolation(v, lines));
}

/**
 * All diagnostics for one project file. `relPath` is relative to `root`; the
 * caller is responsible for scoping (ui/server uses resolvePageFile).
 * `source` defaults to the file's current text on disk.
 *
 * @param {string} root Project root.
 * @param {string} relPath File to check, relative to `root`.
 * @param {string} [source] Text to check instead of the file on disk (an unsaved edit).
 * @returns {any} TypeScript diagnostics plus Construct rule violations, sorted by line then column.
 */
export function collectDiagnostics(root, relPath, source) {
  const absFile = path.resolve(root, relPath);
  const text = source ?? fs.readFileSync(absFile, 'utf8');
  const all = [...typescriptDiagnostics(absFile, text), ...ruleDiagnostics(root, relPath, text)];
  return all.sort((a, b) => a.line - b.line || a.column - b.column);
}
