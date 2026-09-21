// AST package: parsing. One place that knows how to turn source text into a tree.
//   - parseToAst      -> typescript-estree (ESTree-shaped, with comments/ranges/loc)
//   - parseTsSource   -> TypeScript compiler API SourceFile (for type-system introspection)
import ts from 'typescript';
import { parse } from '@typescript-eslint/typescript-estree';

// Single-slot memoized parse: parseFile and the readability enforcer's
// checkFeatureJsdoc both call extractImports/extractExports/extractJsdoc
// back-to-back on the *same* source string, so caching the most recent
// (source -> ast) pair avoids re-parsing the same file 2-3x per call site
// without the complexity of a real LRU. Not safe to rely on across
// different source strings interleaved by async code, but every call site
// in this codebase is synchronous.
let cachedSource;
let cachedAst;

const PARSE_OPTIONS = { comment: true, loc: true, range: true, errorOnUnknownASTType: false };

/**
 * Parse `source` into a typescript-estree AST (with `comments`), trying JSX
 * mode first (works for both .tsx and plain .ts/.js in the overwhelming
 * common case) and falling back to non-JSX mode only if JSX parsing fails —
 * these functions take `source` alone (no file path), so the extension
 * isn't available to decide up front.
 *
 * @param {string} source TypeScript, TSX or JavaScript source text.
 * @returns {object} A typescript-estree `Program` node with `comments`. The last result is cached by source text.
 * @throws {Error} The parser's error when the source is not valid in either mode.
 * @since 0.8
 *
 * @example
 * const ast = parseToAst('export const a = 1;');
 * ast.body[0].type; // => 'ExportNamedDeclaration'
 */
export function parseToAst(source) {
  if (source === cachedSource) return cachedAst;
  let ast;
  try {
    ast = parse(source, { ...PARSE_OPTIONS, jsx: true });
  } catch (err) {
    try {
      ast = parse(source, { ...PARSE_OPTIONS, jsx: false });
    } catch {
      throw err; // surface the original (jsx-mode) error — usually the more informative one
    }
  }
  cachedSource = source;
  cachedAst = ast;
  return ast;
}

/**
 * Parse `source` with the TypeScript compiler API (parent pointers set, TSX script kind) — the
 * stack to use for type-system questions (interfaces, type aliases, members) and for
 * `ts.factory`-based generation. `fileName` only labels the SourceFile.
 *
 * @param {string} source TypeScript or TSX source text.
 * @param {string} [fileName='file.tsx'] Label for the SourceFile.
 * @returns {import("typescript").SourceFile} A TypeScript compiler API SourceFile with parent pointers set.
 * @since 0.8
 */
export function parseTsSource(source, fileName = 'file.tsx') {
  return ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}
