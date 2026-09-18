// The Construct AST package -- single entry point for parsing, walking, extracting and generating
// source code. Deterministic, no LLM. See ./README.md.
//
// Stacks (each used where it is the best fit):
//   typescript-estree + estree-walker : parseToAst, walkAst, walkForUsage/collect*, extract*
//   TypeScript compiler API           : parseTsSource, findNode, findAllNodes, printNode, ts (factory)
// (ui/server/src/pagesEditor.mjs still uses Babel for JSX edit ops -- tracked follow-up, see README.)
export { parseToAst, parseTsSource } from './parse.mjs';
export {
  walkAst, isNonUsagePosition, walkForUsage, collectCalls, collectBareIdentifierUsages,
  collectControlFlowNodes, CONTROL_FLOW_TYPES,
} from './walk.mjs';
export { extractImports, extractExports, extractJsdoc, staticImportEntries, lineOf } from './extract.mjs';
export { ts, findNode, findAllNodes, printNode } from './tsNodes.mjs';
