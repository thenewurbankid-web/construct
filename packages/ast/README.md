# `packages/ast` — Construct's AST package

Every deterministic (non-LLM) way Construct reads, walks and generates TypeScript/JSX source, behind one
entry point: `packages/ast/index.mjs`. Both the CLI (`src/`) and the UI backend (`ui/server`) import from it.

```js
// from src/*.mjs:            import { extractImports } from './ast/index.mjs';
// from ui/server/src/*.mjs:  import { extractImports } from '../../../packages/ast/index.mjs';
```

Relative imports are deliberate: `ui/server` already imports `../../../src/*`, and `typescript` /
`estree-walker` / `@typescript-eslint/typescript-estree` resolve from the repo-root `node_modules`. No npm
workspace is used, so the four separate `npm install` locations are unchanged. `package.json` here carries
the `exports` map (`.`, `./parse`, `./walk`, `./extract`, `./ts`) for a future move to a real package.

## API

| Area | Function | What it does |
|---|---|---|
| parse | `parseToAst(source)` | typescript-estree AST (comments/ranges/loc), JSX first then non-JSX; single-slot memo on the last source |
| parse | `parseTsSource(source, fileName?)` | TypeScript-compiler-API `SourceFile` (parents set, TSX) for type-system questions |
| walk | `walkAst(ast, {enter, leave})` | estree-walker's `walk` |
| walk | `walkForUsage(ast, visit)` | walk skipping non-usage positions (import bindings, re-export specifiers, non-computed member/key names) |
| walk | `collectCalls(ast, names:Set)` | real `name(...)` calls, sorted, `{name, index}` |
| walk | `collectBareIdentifierUsages(ast, names:Set)` | real identifier references, sorted |
| walk | `collectControlFlowNodes(ast)` | if/for/while/switch/try nodes; `CONTROL_FLOW_TYPES` is the set |
| walk | `isNonUsagePosition(node, parent, key)` | the predicate behind `walkForUsage` |
| jsx complexity | `collectInlineJsxLogic(ast)` | inline conditional (`cond ? <A/> : <B/>`, `cond && <A/>`) and loop-render (`.map`/`.flatMap` returning JSX) nodes, sorted — the shape COMPONENT-005 (#508) flags |
| jsx complexity | `computeJsxComplexity(ast)` | `{maxDepth, branchCount}` — a component/page's own JSX nesting depth and inline-logic count, the budget COMPONENT-006 (#508) caps |
| extract | `extractImports(source)` | static + dynamic import specifiers, source order |
| extract | `extractExports(source)` | `[{name, index}]` for every export form |
| extract | `extractJsdoc(source, index)` | the JSDoc block for the export at `index` (decorator-aware), or `null` |
| extract | `staticImportEntries(ast)` | `[{value, index}]` for top-level `import` declarations only |
| extract | `lineOf(source, index)` | 1-based line of a character offset |
| ts | `ts` | the `typescript` module (use `ts.factory` to build nodes) |
| ts | `findNode(root, pred)` / `findAllNodes(root, pred)` | depth-first search of a `ts.Node` tree |
| ts | `printNode(node)` | print a `ts.factory` node as source (LF newlines) |

`packages/core/parser.mjs` re-exports `parseToAst`, `extractImports/Exports/Jsdoc` and `lineOf` so older imports keep
working; new code should import from `packages/ast`.

## Runnable example

```js
import { parseToAst, extractImports, collectCalls, lineOf } from './packages/ast/index.mjs';

const source = `import { a } from './a';\nexport function Page() { return fetch('/x'); }\n// fetch('/ignored')`;
console.log(extractImports(source));                                    // [ './a' ]
const [hit] = collectCalls(parseToAst(source), new Set(['fetch']));
console.log(hit.name, 'on line', lineOf(source, hit.index));            // fetch on line 2
```

(A comment or string containing `fetch(` is never reported — only real calls.)

## JSX edit/analysis family (typescript-estree)

The Pages Editor and the visual composer used to parse/edit JSX with Babel (a third parser stack). Those
operations now live here, on typescript-estree, and `ui/server/src/pagesEditor.mjs` keeps only the glue
(HTTP error wording/statuses, the hash guard, the enforcement gate, path scoping, cross-file import lookup).
`@babel/*` is gone from `ui/server`.

| Module | Functions |
|---|---|
| `jsxParse.mjs` | `parseJsx(source)`, `jsxParseError(source)`, `checkJsxReplacement(snippet)` |
| `jsxTree.mjs` | `parseJsxTree(source)` -> `{roots, byId, ast}` (ids `n0..` in document order), `jsxAttributes`, `jsxNameToString`, `findParentRecord` |
| `jsxEdit.mjs` | offset-exact text edits: `setAttributeText`, `setSpreadText`, `removeAttributeText`, `removeNodeText`, `swapNodesText`, `addChildText`, `spliceNode`, `renderAttrValue` |
| `jsxScope.mjs` | `collectComponentScopeNames(ast)`, `findImportOfName(ast, name)`, `declaredPropNames(childSource, tag, isDefault)`, `findTypeMembers(source, typeName)` |

```js
import { parseJsxTree, setAttributeText, jsxParseError } from './packages/ast/index.mjs';
const src = '<Card title="a" />';
const { byId } = parseJsxTree(src);
const next = setAttributeText(src, byId.get('n0'), 'title', 'string', 'b');   // '<Card title="b" />'
console.log(next, jsxParseError(next));                                          // ... null
```

Every edit is a splice of the original text (bytes outside the edited range never change); callers re-parse
the result with `jsxParseError`. Parity with the former Babel implementation is proven by
`ui/server/src/pagesEditor.golden.test.mjs` (golden outputs captured from Babel before the migration).

Known, deliberate differences from Babel: (1) the *text* of parser error details differs (the operation
still fails in the same cases); (2) TypeScript's parser rejects a bare `>`/`}` in JSX text, so `parseJsx`
blanks that one character (same length) in the copy it parses and retries -- offsets are unchanged;
(3) `<a b={} />` is re-rejected explicitly (TS treats it as a checker error); (4) Babel's semantic early
errors (`const a; const a;`, top-level `return`) and its acceptance of `<a.b-c />` are not replicated.
