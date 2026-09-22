// The Construct AST package -- single entry point for parsing, walking, extracting and generating
// source code. Deterministic, no LLM. See ./README.md.
//
// Stacks (each used where it is the best fit):
//   typescript-estree + estree-walker : parseToAst, walkAst, walkForUsage/collect*, extract*
//   TypeScript compiler API           : parseTsSource, findNode, findAllNodes, printNode, ts (factory)
//   JSX family (typescript-estree)    : parseJsx, parseJsxTree, jsx* edit ops, jsx scope analysis (#173)
export { parseToAst, parseTsSource } from './parse.mjs';
export {
  walkAst, isNonUsagePosition, walkForUsage, collectCalls, collectBareIdentifierUsages,
  collectControlFlowNodes, CONTROL_FLOW_TYPES,
} from './walk.mjs';
export { extractImports, extractExports, extractJsdoc, staticImportEntries, lineOf } from './extract.mjs';
export { ts, findNode, findAllNodes, printNode } from './tsNodes.mjs';
export { parseJsx, jsxParseError, checkJsxReplacement } from './jsxParse.mjs';
export { jsxNameToString, jsxAttributes, parseJsxTree, findParentRecord } from './jsxTree.mjs';
export {
  spliceNode, renderAttrValue, setAttributeText, setSpreadText, removeAttributeText,
  removeNodeText, swapNodesText, addChildText, NEW_CHILD_SNIPPET,
} from './jsxEdit.mjs';
export { collectComponentScopeNames, collectScopeDeclarations, findImportOfName, findTypeMembers, declaredPropNames } from './jsxScope.mjs';
export { collectInlineJsxLogic, computeJsxComplexity } from './jsxComplexity.mjs';
export { collectImpureDomainReferences, collectLocallyBoundNames, BUILTIN_GLOBALS as DOMAIN_PURITY_BUILTIN_GLOBALS } from './domainPurity.mjs';
