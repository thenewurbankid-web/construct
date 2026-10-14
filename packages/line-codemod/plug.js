// PLUG: deterministic source.tsx (or .ts/.js) text -> atomic-English
// "plugged" module text (LIN-122, block 1 of 2 -- UNPLUG is block 2).
//
// Reuses transform.js's whole-module AST pass unmodified: it already
// rewrites ternaries/raw operators into atom calls wherever they occur in
// the program and leaves every other node (imports, types, JSX, statements
// it doesn't recognize) untouched through babel generate. Because of that,
// the exported/public API surface of the input is preserved automatically
// -- plug() doesn't need to know which declarations are exports, it just
// transforms the whole module and babel generate reprints the rest as-is.
//
// This module implements only the "Now" (demo) shape from the issue:
// plug(sourceCode) is text-in/text-out. The "Later" runtime shape
// (`import * as source from './source'; export default plug(source)`) is a
// thin wrapper a CLI/watch mode would add on top later; it would still call
// this same deterministic text transform underneath.
const { transform } = require('./transform');

const TSX_PLUGINS = ['typescript', 'jsx'];

function plug(sourceCode) {
  return transform(sourceCode, { plugins: TSX_PLUGINS });
}

module.exports = { plug, TSX_PLUGINS };
