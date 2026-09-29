const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const generate = require('@babel/generator').default;
const t = require('@babel/types');
const { chunkCode } = require('./chunker');

// Deterministic, no model involved: takes code that's ALREADY been through
// the atomic refactor (transform.js + the LLM extraction step), and renders
// it as English by mechanically splitting method names into words. This
// only works because the refactor already removed raw operators/ternaries
// and named every comparison -- readability is a property of the atom
// shape, not something an LLM narrates on top of it afterward.
function camelToWords(name) {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase();
}

function exprToEnglish(node) {
  if (!node) return '';
  switch (node.type) {
    case 'Identifier':
      return node.name === 'this' ? 'it' : node.name;
    case 'ThisExpression':
      return 'it';
    case 'StringLiteral':
      return `'${node.value}'`;
    case 'NumericLiteral':
    case 'BooleanLiteral':
      return String(node.value);
    case 'NullLiteral':
      return 'nothing';
    case 'MemberExpression':
      // computed: true is bracket notation with a dynamic key (obj[x]) --
      // property is a VALUE expression (a variable, a literal), not a fixed
      // field name, so it must be rendered as an expression, not word-split
      // like a property name. Treating both cases the same was the bug:
      // this.rules[name] rendered as "rules's name" (implying a literal
      // nested field this.rules.name), when it's actually a lookup BY the
      // variable name -- a different meaning entirely.
      if (node.computed) {
        return `${exprToEnglish(node.object)} at ${exprToEnglish(node.property)}`;
      }
      return `${exprToEnglish(node.object)}'s ${camelToWords(node.property.name || '')}`;
    case 'UnaryExpression':
      if (node.operator === '!') return `not (${exprToEnglish(node.argument)})`;
      return `${node.operator}${exprToEnglish(node.argument)}`;
    case 'CallExpression': {
      const callee = node.callee;
      const args = node.arguments.map(exprToEnglish).join(' and ');
      if (callee.type === 'MemberExpression') {
        const subject = exprToEnglish(callee.object);
        const verb = camelToWords(callee.property.name || '');
        return args ? `${subject} ${verb} ${args}` : `${subject} ${verb}`;
      }
      const fn = camelToWords(callee.name || '');
      return `${fn} of ${args}`;
    }
    case 'ArrowFunctionExpression':
      // Renders the closure's BODY, not the closure itself -- "() => x"
      // reads as just "x". Without this, any call taking a callback (like
      // ifIt/elseIfIt/elseIt below) rendered every argument as a bare "(...)"
      // placeholder, losing the actual condition/result entirely.
      if (node.body.type === 'BlockStatement') {
        return blockToEnglish(node.body);
      }
      return exprToEnglish(node.body);
    case 'NewExpression': {
      const args = node.arguments.map(exprToEnglish).join(' and ');
      return `a new ${node.callee.name}${args ? ' of ' + args : ''}`;
    }
    case 'BinaryExpression':
      return `${exprToEnglish(node.left)} ${node.operator} ${exprToEnglish(node.right)}`;
    case 'AssignmentExpression':
      return `set ${exprToEnglish(node.left)} to ${exprToEnglish(node.right)}`;
    case 'BinaryExpression':
      return `${exprToEnglish(node.left)} ${node.operator} ${exprToEnglish(node.right)}`;
    default:
      return '(...)';
  }
}

function blockToEnglish(node, depth) {
  if (!node) return '';
  if (node.type === 'BlockStatement') {
    return node.body.map((s) => stmtToEnglish(s, depth)).join('; then ');
  }
  return stmtToEnglish(node, depth);
}

function stmtToEnglish(node, depth = 0) {
  switch (node.type) {
    case 'ReturnStatement':
      return node.argument ? `return ${exprToEnglish(node.argument)}` : 'return';
    case 'ExpressionStatement':
      return exprToEnglish(node.expression);
    case 'VariableDeclaration':
      return node.declarations
        .map((d) => `let ${d.id.name} be ${d.init ? exprToEnglish(d.init) : 'undefined'}`)
        .join(', ');
    case 'IfStatement': {
      const cond = `if ${exprToEnglish(node.test)}`;
      const then = blockToEnglish(node.consequent, depth + 1);
      const alt = node.alternate ? `, otherwise ${blockToEnglish(node.alternate, depth + 1)}` : '';
      return `${cond}: ${then}${alt}`;
    }
    case 'ForInStatement':
      return `for each ${node.left.declarations ? node.left.declarations[0].id.name : exprToEnglish(node.left)} in ${exprToEnglish(node.right)}: ${blockToEnglish(node.body, depth + 1)}`;
    case 'ForOfStatement':
      return `for each ${node.left.declarations ? node.left.declarations[0].id.name : exprToEnglish(node.left)} of ${exprToEnglish(node.right)}: ${blockToEnglish(node.body, depth + 1)}`;
    case 'BlockStatement':
      return blockToEnglish(node, depth);
    default:
      return '(a step that does not translate cleanly)';
  }
}

// kind: 'method' | 'function' -- same convention as the rest of the tool,
// so the caller can pass a chunk straight from /api/chunk.
//
// Returns { english, steps, title }. `english` is the original flat string
// ("title: step1; then step2; ...") kept for compatibility with existing
// callers. `steps` is the same information un-flattened -- one entry per
// top-level statement of the body, each with its own English, its own code
// slice, and its node range -- so a caller (the demo's step-row editor) can
// address, reorder, or rebuild around a single statement instead of the
// whole block.
function toEnglish(code, kind) {
  const prefixLen = kind === 'method' ? `class __W__ {\n`.length : 0;
  const wrapped = kind === 'method' ? `class __W__ {\n${code}\n}` : code;
  const ast = parser.parse(wrapped, { sourceType: 'module' });
  let name = null;
  let params = [];
  let body = null;

  traverse(ast, {
    ClassMethod(path) {
      name = path.node.key.name;
      params = path.node.params.map((p) => p.name || '?');
      body = path.node.body;
      path.stop();
    },
    FunctionDeclaration(path) {
      if (!path.parentPath.isProgram()) return;
      name = path.node.id ? path.node.id.name : '(anonymous)';
      params = path.node.params.map((p) => p.name || '?');
      body = path.node.body;
      path.stop();
    },
  });

  if (!body) {
    return { english: '(could not find a function/method to describe)', steps: [], title: null };
  }

  const title = `${camelToWords(name)}${params.length ? ' using ' + params.join(' and ') : ''}`;
  const steps = body.body.map((s) => ({
    english: stmtToEnglish(s),
    code: wrapped.slice(s.start, s.end),
    start: s.start - prefixLen,
    end: s.end - prefixLen,
  }));
  const english = `${title}: ${steps.map((s) => s.english).join('; then ')}.`;
  return { english, steps, title };
}

// Every method/function actually CALLED in the refactored code -- the real
// atoms this block ended up using (equals, greaterThan, and, if, is, ...),
// not a guess. Deterministic AST walk, same as everything else here.
function extractAtoms(code, kind) {
  const wrapped = kind === 'method' ? `class __W__ {\n${code}\n}` : code;
  const ast = parser.parse(wrapped, { sourceType: 'module' });
  const names = new Set();
  traverse(ast, {
    CallExpression(path) {
      const callee = path.node.callee;
      if (callee.type === 'MemberExpression' && callee.property.name) {
        names.add(callee.property.name);
      } else if (callee.type === 'Identifier') {
        names.add(callee.name);
      }
    },
  });
  return [...names].sort();
}

// Names actually referenced as values within a statement -- not property
// keys, not the LHS of the declaration that introduces them. Babel's
// "ReferencedIdentifier" virtual type already draws that line, which is
// exactly the "use" half of use/def analysis. The statement is cloned into
// its own tiny Program first so this traversal doesn't touch the real AST
// (and so parent-pointer state stays correct for a node lifted out of its
// original position).
function usesOf(stmtNode) {
  const uses = new Set();
  const wrapper = t.file(t.program([t.cloneNode(stmtNode, true)]));
  traverse(wrapper, {
    ReferencedIdentifier(path) {
      uses.add(path.node.name);
    },
  });
  return uses;
}

// Use/def check for a reorder: a step is "broken" when it references a
// binding whose declaring statement now sits AFTER it (or was deleted).
// `let`/`const` can't be redeclared in the same scope, so each name maps
// to exactly one declaring statement -- no ambiguity to resolve.
// `orderedOriginalIndices` and `originalStmts` are both indexed the same
// way `reorderSteps`'s caller addresses steps: positions in the CODE
// BEFORE this reorder. Returns one entry per new position, aligned with
// the `steps` array `toEnglish` will produce for the rebuilt code.
function computeBreaks(orderedOriginalIndices, originalStmts) {
  const declaredAt = {};
  originalStmts.forEach((s, idx) => {
    Object.keys(t.getBindingIdentifiers(s)).forEach((name) => {
      declaredAt[name] = idx;
    });
  });

  const newPositionOf = {};
  orderedOriginalIndices.forEach((origIdx, newIdx) => {
    newPositionOf[origIdx] = newIdx;
  });

  return orderedOriginalIndices.map((origIdx, newIdx) => {
    const used = usesOf(originalStmts[origIdx]);
    for (const name of used) {
      const declIdx = declaredAt[name];
      if (declIdx === undefined || declIdx === origIdx) continue;
      const declPos = newPositionOf[declIdx];
      if (declPos === undefined) {
        return { reason: `uses '${name}', which is no longer defined -- its step was removed` };
      }
      if (declPos > newIdx) {
        return { reason: `uses '${name}', now set later in step ${declPos + 1}` };
      }
    }
    return null;
  });
}

// Rebuilds the function/method with its top-level statements in a new
// order (and optionally fewer of them, for delete). `order` is a list of
// indices into the CURRENT top-level statements (the same indexing as the
// `steps` array toEnglish just returned for this code) -- e.g. [1, 0, 2]
// swaps the first two steps, [0, 2] drops the middle one. Babel does the
// actual regeneration (formatting/reindentation) rather than text-splicing
// the code slices, so the result is always valid, well-formed code; the
// caller re-derives English from THIS output rather than editing the old
// English, which is what keeps code and English from ever drifting apart.
//
// Returns { code, breaks }: `breaks[k]` is null, or `{ reason }` when the
// step now at position k uses a binding defined by a step positioned after
// it (or removed) -- the move still happens; this only flags it.
function reorderSteps(code, kind, order) {
  const wrapped = kind === 'method' ? `class __W__ {\n${code}\n}` : code;
  const ast = parser.parse(wrapped, { sourceType: 'module' });
  let bodyPath = null;

  traverse(ast, {
    ClassMethod(path) {
      bodyPath = path.get('body');
      path.stop();
    },
    FunctionDeclaration(path) {
      if (!path.parentPath.isProgram()) return;
      bodyPath = path.get('body');
      path.stop();
    },
  });

  if (!bodyPath) throw new Error('could not find a function/method to reorder');

  const stmts = bodyPath.node.body.slice();
  const breaks = computeBreaks(order, stmts);
  bodyPath.node.body = order.map((i) => stmts[i]).filter(Boolean);

  const output = generate(ast, { retainLines: false }).code;
  const code_ = kind === 'method' ? (chunkCode(output)[0] || {}).code || output : output;
  return { code: code_, breaks };
}

module.exports = { toEnglish, camelToWords, extractAtoms, reorderSteps };
