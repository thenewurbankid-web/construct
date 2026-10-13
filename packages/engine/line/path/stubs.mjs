// #921 path-first proof: one stub, read and written by AST. A stub is a named top-level function (its body a placeholder
// throw) registered through a typed-contracts factory; its signature (everything before the body) is locked. The stub
// check is static: the placeholder is gone, every input is used, and a non-void function returns a value.
import { parseToAst, walkAst } from '@construct/ast';
import { findFunction } from '../logicVerify/z3Translate.mjs';

/** The placeholder a stub's body starts as; the stub is open while its body still holds it. */
export const PLACEHOLDER = 'TODO(path-stub';
/**
 * The body of a fresh stub with this id.
 * @param {string} id The stub id.
 * @returns {string} The placeholder block.
 */
export const placeholderBody = (id) => `{\n  throw new Error('${PLACEHOLDER} ${id})');\n}`;

/**
 * The stub's function in `source`: its node, signature text (locked), body text and body range.
 * @param {string} source
 * @param {string} fn the function's name
 * @returns {{node: any, signature: string, body: string, bodyStart: number, bodyEnd: number, line: number} | null}
 */
export function stubParts(source, fn) {
  let ast;
  try { ast = parseToAst(source); } catch { return null; }
  const node = findFunction(ast, fn);
  if (!node || node.body?.type !== 'BlockStatement') return null;
  const [start] = declRange(ast, node);
  const [bodyStart, bodyEnd] = node.body.range;
  return { node, signature: norm(source.slice(start, bodyStart)), body: source.slice(bodyStart, bodyEnd), bodyStart, bodyEnd, line: node.body.loc.start.line };
}

/** The declaration's start: an `export function`, a `function`, or the `const x =` that binds the arrow. */
function declRange(ast, node) {
  for (const st of ast.body) {
    const d = st.type === 'ExportNamedDeclaration' ? st.declaration : st;
    if (d === node) return st.range;
    if (d?.type === 'VariableDeclaration' && d.declarations.some((v) => v.init === node)) return st.range;
  }
  return node.range;
}

const norm = (s) => s.replace(/\s+/g, ' ').trim();

/** The names a parameter binds (destructured object/array patterns, defaults, rest). */
function boundNames(p, out = []) {
  if (!p) return out;
  if (p.type === 'Identifier') out.push(p.name);
  else if (p.type === 'AssignmentPattern') boundNames(p.left, out);
  else if (p.type === 'RestElement') boundNames(p.argument, out);
  else if (p.type === 'ObjectPattern') for (const q of p.properties) boundNames(q.type === 'Property' ? q.value : q, out);
  else if (p.type === 'ArrayPattern') for (const q of p.elements) boundNames(q, out);
  else if (p.type === 'TSParameterProperty') boundNames(p.parameter, out);
  return out;
}

/** Identifier references inside `node` (not property keys or member names). */
function referenced(node) {
  const seen = new Set();
  walkAst(node, {
    enter(n, parent, key) {
      if (parent?.type === 'MemberExpression' && key === 'property' && !parent.computed) return;
      if (parent?.type === 'Property' && key === 'key' && !parent.computed && !parent.shorthand) return;
      const id = /** @type {{type: string, name?: string}} */ (n); // JSXIdentifier is not in the walker's node union
      if (id.type === 'Identifier' || id.type === 'JSXIdentifier') seen.add(id.name);
    },
  });
  return seen;
}

/** Whether the block returns a value on some path (return statements of nested functions do not count). */
function returnsValue(block) {
  let found = false;
  walkAst(block, {
    enter(n) {
      if (n !== block && /Function/.test(n.type)) { this.skip(); return; }
      if (n.type === 'ReturnStatement' && n.argument) found = true;
    },
  });
  return found;
}

/** Whether the function's declared return type is void (or Promise<void>). */
function returnsVoid(node) {
  const t = node.returnType?.typeAnnotation;
  if (!t) return false;
  if (t.type === 'TSVoidKeyword') return true;
  return t.type === 'TSTypeReference' && t.typeName?.name === 'Promise' && (t.typeArguments ?? t.typeParameters)?.params?.[0]?.type === 'TSVoidKeyword';
}

/**
 * The static stub check: [] when the stub is filled, else one problem per gap, in order.
 * @param {string} source
 * @param {string} fn
 * @returns {{code: 'NO_STUB'|'OPEN'|'UNUSED_INPUT'|'NO_RETURN', sentence: string, line?: number}[]}
 */
export function stubProblems(source, fn) {
  const parts = stubParts(source, fn);
  if (!parts) return [{ code: 'NO_STUB', sentence: `There is no function ${fn} with a block body in the file.` }];
  /** @type {{code: 'NO_STUB'|'OPEN'|'UNUSED_INPUT'|'NO_RETURN', sentence: string, line?: number}[]} */
  const out = [];
  if (parts.body.includes(PLACEHOLDER)) out.push({ code: 'OPEN', sentence: 'The body still holds the stub placeholder.', line: parts.line });
  const used = referenced(parts.node.body);
  for (const name of parts.node.params.flatMap((p) => boundNames(p))) {
    if (!used.has(name)) out.push({ code: 'UNUSED_INPUT', sentence: `The input ${name} is never used in the body.`, line: parts.line });
  }
  if (!out.length && !returnsVoid(parts.node) && !returnsValue(parts.node.body)) out.push({ code: 'NO_RETURN', sentence: 'The function declares a return value but its body never returns one.', line: parts.line });
  return out;
}

/**
 * Replace the stub's body with `body`, signature locked. `body` is a block (`{ ... }`), bare statements (wrapped), or a
 * whole function whose signature must equal the locked one. Imports are locked too.
 * @param {string} source
 * @param {string} fn
 * @param {string} body
 * @returns {{ok: true, source: string, body: string} | {ok: false, code: 'NO_STUB'|'SIGNATURE_CHANGED'|'IMPORTS_LOCKED'|'BAD_BODY', sentence: string}}
 */
export function replaceBody(source, fn, body) {
  const parts = stubParts(source, fn);
  if (!parts) return { ok: false, code: 'NO_STUB', sentence: `There is no function ${fn} with a block body in the file.` };
  let text = String(body ?? '').trim().replace(/^```[a-z]*\n?|\n?```$/g, '').trim();
  if (/^\s*import\s/m.test(text)) return { ok: false, code: 'IMPORTS_LOCKED', sentence: 'The imports are locked: send only the function body, using what the file already imports.' };
  if (/^(export\s+)?(async\s+)?function\b/.test(text) || new RegExp(`^(export\\s+)?const\\s+${fn}\\s*[=:]`).test(text)) {
    const whole = stubParts(text, fn);
    if (!whole) return { ok: false, code: 'BAD_BODY', sentence: `The function you sent is not ${fn} with a block body; send only the body.` };
    const sig = norm(text.slice(0, whole.bodyStart));
    const locked = parts.signature;
    if (sig.replace(/^export /, '') !== locked.replace(/^export /, '')) return { ok: false, code: 'SIGNATURE_CHANGED', sentence: `The signature is locked: keep exactly \`${locked}\` and change only the body.` };
    text = whole.body;
  }
  if (!text.startsWith('{') || !text.endsWith('}')) text = `{\n${text}\n}`;
  const next = source.slice(0, parts.bodyStart) + text + source.slice(parts.bodyEnd);
  const after = stubParts(next, fn);
  if (!after || after.signature !== parts.signature) return { ok: false, code: 'BAD_BODY', sentence: 'The body does not parse as one block; send the statements of the body only.' };
  return { ok: true, source: next, body: after.body };
}
