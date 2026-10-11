// A stand-in for @construct/ast (LINE-MODULE (b)): the parse/walk/extract core of its contract (./contract.d.ts),
// with the same names and shapes, and no parser behind it. A caller under test that only needs "a program came back
// and was walked" uses it instead of typescript-estree; test/mock.test.mjs keeps the names and shapes in step with
// the real entry.

/**
 * @typedef {{ type: 'Program', sourceType: 'module', body: object[], comments: object[], tokens: object[], range: [number, number],
 *   loc: { start: { line: number, column: number }, end: { line: number, column: number } } }} MockProgram
 */

/**
 * An empty ESTree Program spanning the source (the real one parses it).
 * @param {string} source The code.
 * @returns {MockProgram} The program.
 */
export function parseToAst(source = '') {
  const lines = String(source).split('\n');
  return {
    type: 'Program',
    sourceType: 'module',
    body: [],
    comments: [],
    tokens: [],
    range: [0, String(source).length],
    loc: { start: { line: 1, column: 0 }, end: { line: lines.length, column: lines[lines.length - 1].length } },
  };
}

/**
 * Walk a tree depth-first, calling `enter` then `leave` on every node with a string `type` (as the real one does).
 * @param {object} ast The root node.
 * @param {{ enter?: (node: any, parent: any) => void, leave?: (node: any, parent: any) => void }} visitor Callbacks.
 * @returns {object} The root.
 */
export function walkAst(ast, visitor = {}) {
  const visit = (node, parent) => {
    if (!node || typeof node.type !== 'string') return;
    visitor.enter?.(node, parent);
    for (const [k, v] of Object.entries(node)) {
      if (k === 'parent' || k === 'loc' || k === 'range') continue;
      if (Array.isArray(v)) v.forEach((c) => visit(c, node));
      else if (v && typeof v === 'object') visit(v, node);
    }
    visitor.leave?.(node, parent);
  };
  visit(ast, null);
  return ast;
}

/** No imports in the mock's empty programs (the real one returns each imported specifier). @param {string} [_source] The code. @returns {string[]} Always empty. */
export function extractImports(_source) { return []; }

/** No exports in the mock's empty programs (the real one returns {name, index} per export). @param {string} [_source] The code. @returns {{name: string, index: number}[]} Always empty. */
export function extractExports(_source) { return []; }

/**
 * The 1-based line of an offset in a source, as the real one computes it.
 * @param {string} source The code.
 * @param {number} offset A character offset.
 * @returns {number} The line.
 */
export function lineOf(source, offset) {
  return String(source).slice(0, offset).split('\n').length;
}
