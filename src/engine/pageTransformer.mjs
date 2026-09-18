// Ticket 7.2 -- Pristine page transformer (Subframe JSX ingestion).
//
// Ingests an externally-authored JSX/TSX file (simulating a design-tool
// export, e.g. Subframe) into `pages/`: catalogs every interactive JSX
// attribute it finds, strips all local state/logic so the result is
// presentation-only, rewires each catalogued attribute to a same-named prop,
// and emits an explicit `<Feature>PageProps.ts` interface declaring them.
//
// Parsing is typescript-estree/estree-walker (src/parser.mjs's parseToAst,
// reused rather than re-parsed a second way) per the epic's reconciliation
// notes -- not @babel/parser/@babel/traverse. This module only ever *reads*
// AST node ranges to slice/splice the original source text (the same
// range-based technique src/architecture-enforcer.mjs and
// ui/server/src/pagesEditor.mjs already use for source-preserving edits) --
// it never re-prints a whole AST, so original formatting/comments in the
// kept region survive untouched.
import fs from 'node:fs';
import path from 'node:path';
import { parseToAst, walkAst } from '../ast/index.mjs';
import { loadConfig } from './../config.mjs';
import { write } from '../fs.mjs';
import { selfCheck, pascalCase } from '../generators.mjs';
import { ConstructError, EXIT_CODES } from '../diagnostics.mjs';

const CALLBACK_ATTR_RE = /^on[A-Z]/;
const VALUE_ATTR_NAMES = new Set(['value', 'checked', 'defaultValue', 'defaultChecked']);

// Well-known React DOM event handler shapes get a real signature; anything
// else recognized as a handler (any onXxx name) falls back to a generic
// niladic callback rather than guessing a payload shape it can't know.
const EVENT_TYPE_BY_NAME = {
  onChange: '(value: string) => void',
  onSubmit: '(event: React.FormEvent<HTMLFormElement>) => void',
  onKeyDown: '(event: React.KeyboardEvent) => void',
  onKeyUp: '(event: React.KeyboardEvent) => void',
};

function classifyAttrName(name) {
  if (VALUE_ATTR_NAMES.has(name)) return 'value';
  if (CALLBACK_ATTR_RE.test(name)) return 'callback';
  return null;
}

function slotType(name, kind) {
  if (EVENT_TYPE_BY_NAME[name]) return EVENT_TYPE_BY_NAME[name];
  if (kind === 'callback') return '() => void';
  if (name === 'checked' || name === 'defaultChecked') return 'boolean';
  return 'string';
}

/** The exported React component function in `ast`: a `function` declaration
 * or an arrow/function-expression assigned to a capitalized `const`, either
 * named- or default-exported. Returns `{ funcNode }`, or null if none is
 * found -- callers surface that as a clear ingestion error rather than
 * guessing at an arbitrary node. */
function findComponentFunction(ast) {
  const isComponentFn = (n) => n && (n.type === 'FunctionExpression' || n.type === 'ArrowFunctionExpression' || n.type === 'FunctionDeclaration');
  for (const node of ast.body) {
    if (node.type === 'ExportDefaultDeclaration' && isComponentFn(node.declaration)) return node.declaration;
    if (node.type === 'ExportNamedDeclaration' && node.declaration) {
      const decl = node.declaration;
      if (decl.type === 'FunctionDeclaration') return decl;
      if (decl.type === 'VariableDeclaration') {
        for (const d of decl.declarations) {
          if (isComponentFn(d.init)) return d.init;
        }
      }
    }
  }
  return null;
}

/** The JSX node this component function actually renders: for a
 * block-bodied function, its last `return <jsx>` statement; for a
 * concise-body arrow (`() => (<jsx/>)`), the body expression itself. Returns
 * `{ jsxNode, wholeRange }` where `wholeRange` is what gets kept verbatim
 * (return statement including `return`/`;`, or just the expression for a
 * concise arrow, which the caller wraps in an explicit `return (...)`). */
function findRenderedJsx(funcNode, source) {
  if (funcNode.body.type !== 'BlockStatement') {
    return { jsxNode: funcNode.body, wholeRange: funcNode.body.range, concise: true };
  }
  const returns = funcNode.body.body.filter((s) => s.type === 'ReturnStatement' && s.argument);
  const last = returns[returns.length - 1];
  if (!last) return null;
  return { jsxNode: last.argument, wholeRange: last.range, concise: false };
}

/** Every catalogued interactive JSXAttribute under `jsxNode`, in source order. */
function collectInteractiveAttrs(jsxNode) {
  const hits = [];
  walkAst(jsxNode, {
    enter(node) {
      if (node.type !== 'JSXAttribute' || node.name?.type !== 'JSXIdentifier') return;
      const kind = classifyAttrName(node.name.name);
      if (kind) hits.push({ name: node.name.name, kind, range: node.range });
    },
  });
  return hits.sort((a, b) => a.range[0] - b.range[0]);
}

/** Rewire `text` (the source slice for `[sliceStart, sliceEnd)`) so every
 * catalogued attribute's value becomes the JSX-attribute shorthand
 * `name={name}` referencing the new prop of the same name -- applied from
 * the last attribute backwards so earlier offsets stay valid. */
function rewireAttrs(text, sliceStart, attrs) {
  let out = text;
  for (const attr of [...attrs].sort((a, b) => b.range[0] - a.range[0])) {
    const start = attr.range[0] - sliceStart;
    const end = attr.range[1] - sliceStart;
    out = out.slice(0, start) + `${attr.name}={${attr.name}}` + out.slice(end);
  }
  return out;
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Original top-level `ImportDeclaration` source lines whose specifiers are
 * still referenced (by a simple word-boundary text search — this is an
 * import-retention heuristic, not an architecture rule, so a cheap,
 * conservative check is fine here) somewhere in `keptBodyText`. Whole
 * import statements are kept or dropped together, never split into "some
 * specifiers used, some not" — safer than editing a specifier list. */
function retainedImportLines(ast, source, keptBodyText) {
  const lines = [];
  for (const node of ast.body) {
    if (node.type !== 'ImportDeclaration') continue;
    const localNames = node.specifiers.map((s) => s.local?.name).filter(Boolean);
    const anyUsed = localNames.some((n) => new RegExp(`\\b${escapeRegExp(n)}\\b`).test(keptBodyText));
    if (anyUsed) lines.push(source.slice(node.range[0], node.range[1]));
  }
  return lines;
}

/**
 * Parse an externally-authored JSX/TSX source (a "pristine" ingested file --
 * simulating a Subframe export) and produce a presentation-only Construct
 * page plus its explicit Props interface.
 *
 * @param {string} source - the ingested file's raw text.
 * @param {{feature: string, name: string}} opts - `name` is already
 *   capitalized (the layer's conventional PascalCase base name).
 * @returns {{pageSource: string, propsSource: string, slots: Array<{name:string, kind:'callback'|'value'}>}}
 */
export function transformPristineSource(source, { feature, name }) {
  const ast = parseToAst(source);
  const funcNode = findComponentFunction(ast);
  if (!funcNode) {
    throw new ConstructError(
      'No exported React component function found in the ingested source (expected `export function X() {...}`, `export default function X() {...}`, or `export const X = () => {...}`).',
      { exitCode: EXIT_CODES.USAGE_ERROR },
    );
  }
  const rendered = findRenderedJsx(funcNode, source);
  if (!rendered) {
    throw new ConstructError('The ingested component has no `return <jsx/>` statement — nothing to ingest as a page.', { exitCode: EXIT_CODES.USAGE_ERROR });
  }

  const attrs = collectInteractiveAttrs(rendered.jsxNode);
  const seen = new Map(); // name -> kind, dedupe across repeated elements
  for (const a of attrs) if (!seen.has(a.name)) seen.set(a.name, a.kind);
  const slots = [...seen.entries()].map(([slotName, kind]) => ({ name: slotName, kind }));

  const sliceStart = rendered.wholeRange[0];
  const sliceEnd = rendered.wholeRange[1];
  const rewiredSlice = rewireAttrs(source.slice(sliceStart, sliceEnd), sliceStart, attrs);
  const bodyText = rendered.concise ? `return (\n    ${rewiredSlice}\n  );` : rewiredSlice;

  const propsTypeName = `${name}PageProps`;
  const importLines = retainedImportLines(ast, source, bodyText);
  const paramsDestructure = slots.length ? `{ ${slots.map((s) => s.name).join(', ')} }: ${propsTypeName}` : `_props: ${propsTypeName}`;

  const pageSource = [
    `import type { ${propsTypeName} } from './${propsTypeName}';`,
    ...importLines,
    '',
    `export function ${name}Page(${paramsDestructure}) {`,
    `  ${bodyText}`,
    `}`,
    '',
  ].join('\n');

  const propsSource = [
    `// Auto-generated by \`construct create page --from\` (Ticket 7.2) from an ingested`,
    `// presentation file -- every prop below is an interactive slot the pristine`,
    `// ${name}Page component found and externalized. Wire these from a controller.`,
    `export interface ${propsTypeName} {`,
    ...slots.map((s) => `  ${s.name}: ${slotType(s.name, s.kind)};`),
    `}`,
    '',
  ].join('\n');

  return { pageSource, propsSource, slots };
}

/** Ingest `fromPath` (an externally-authored JSX/TSX file) as feature
 * `feature`'s `<name>` page: writes `<Feature>Page.tsx` +
 * `<Feature>PageProps.ts` under `features/<feature>/pages/`, then
 * re-validates both via generators.mjs's shared selfCheck. */
export function ingestPage(root, name, feature, fromPath) {
  const config = loadConfig(root);
  const cap = pascalCase(name, 'Page');
  const sourcePath = path.isAbsolute(fromPath) ? fromPath : path.resolve(fromPath);
  if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) {
    throw new ConstructError(`Source file not found: ${sourcePath}`, { exitCode: EXIT_CODES.USAGE_ERROR });
  }
  const source = fs.readFileSync(sourcePath, 'utf8');
  const { pageSource, propsSource, slots } = transformPristineSource(source, { feature, name: cap });

  const dir = path.join(root, config.features?.root || 'features', feature, 'pages');
  const pageFile = path.join(dir, `${cap}Page.tsx`);
  const propsFile = path.join(dir, `${cap}PageProps.ts`);
  write(pageFile, pageSource);
  write(propsFile, propsSource);
  selfCheck(root, [pageFile, propsFile]);

  return { pageFile, propsFile, slots };
}
