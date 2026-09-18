# `src/ast` — Construct's AST package

Every deterministic (non-LLM) way Construct reads, walks and generates TypeScript/JSX source, behind one
entry point: `src/ast/index.mjs`. Both the CLI (`src/`) and the UI backend (`ui/server`) import from it.

```js
// from src/*.mjs:            import { extractImports } from './ast/index.mjs';
// from ui/server/src/*.mjs:  import { extractImports } from '../../../src/ast/index.mjs';
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
| extract | `extractImports(source)` | static + dynamic import specifiers, source order |
| extract | `extractExports(source)` | `[{name, index}]` for every export form |
| extract | `extractJsdoc(source, index)` | the JSDoc block for the export at `index` (decorator-aware), or `null` |
| extract | `staticImportEntries(ast)` | `[{value, index}]` for top-level `import` declarations only |
| extract | `lineOf(source, index)` | 1-based line of a character offset |
| ts | `ts` | the `typescript` module (use `ts.factory` to build nodes) |
| ts | `findNode(root, pred)` / `findAllNodes(root, pred)` | depth-first search of a `ts.Node` tree |
| ts | `printNode(node)` | print a `ts.factory` node as source (LF newlines) |

`src/parser.mjs` re-exports `parseToAst`, `extractImports/Exports/Jsdoc` and `lineOf` so older imports keep
working; new code should import from `src/ast`.

## Runnable example

```js
import { parseToAst, extractImports, collectCalls, lineOf } from './src/ast/index.mjs';

const source = `import { a } from './a';\nexport function Page() { return fetch('/x'); }\n// fetch('/ignored')`;
console.log(extractImports(source));                                    // [ './a' ]
const [hit] = collectCalls(parseToAst(source), new Set(['fetch']));
console.log(hit.name, 'on line', lineOf(source, hit.index));            // fetch on line 2
```

(A comment or string containing `fetch(` is never reported — only real calls.)

## Not (yet) in the package

`ui/server/src/pagesEditor.mjs` still parses/edits JSX with **Babel** (`@babel/parser`/`traverse`/`types`),
a third stack whose dependencies live only in `ui/server`. Unifying it with typescript-estree is a tracked
follow-up rather than part of this grouping.
