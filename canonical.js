// Canonical form for Smith (q2): equivalent code reads as the same English.
//
// toEnglish(code, kind, { canonical: true }) runs this pass on each function
// before describing it. Off by default -- the plain description stays a
// faithful reading of the code as written. Deterministic AST rewrites only,
// no model. Each rule rewrites one form of a pair into the other:
//
//   ternary return     return c ? a : b            -> if (c) { return a } else { return b }
//                      (transform.js's own rule, shared: ternaryReturnReplacement,
//                       incl. c ? true : false -> c and c ? false : true -> !c)
//   early return       if (c) { ...; return a } else { B }   -> if (c) { ...; return a } B
//                      (only when the then-branch always exits: return/throw)
//   guard              a && f();                    -> if (a) { f(); }
//   nested if          if (a) { if (b) { S } }      -> if (a && b) { S }   (no else on either)
//   self-default       x ? x : y                    -> x || y   (x a plain name/property path)
//   boolean compare    x === false / x == false / x !== true -> !x ;  x === true / x !== false -> x ;  !!x -> x
//                      (only when x is known boolean: a `: boolean` binding,
//                       a comparison, a `!`, or && / || of those)
//   chains             a && (b && c)                -> (a && b) && c   (same for ||)
//   callbacks          x => { return e }            -> x => e ;  x => c ? a : b -> x => { if/return }
//   grouping           parentheses are re-derived from operator precedence,
//                      so (a > 1) && b and a > 1 && b read the same.
//
// Rewritten nodes keep source positions (start/end) borrowed from the code
// they came from, so chip offsets still point into the original source.
const t = require('@babel/types');
const { ternaryReturnReplacement } = require('./transform');

const SKIP_KEYS = new Set(['loc', 'leadingComments', 'trailingComments', 'innerComments', 'extra', 'typeAnnotation', 'returnType', 'typeParameters', 'typeArguments']);
const COMPARISON = new Set(['===', '!==', '==', '!=', '<', '>', '<=', '>=', 'instanceof', 'in']);

function at(node, from) {
  node.start = from.start;
  node.end = from.end;
  return node;
}

// New nodes from a shared rule have no positions: borrow the nearest
// positioned range (a statement wrapping an expression takes the
// expression's range, so a hoisted `return b` points at `b`).
function stampMissing(node, range) {
  if (!node || typeof node.type !== 'string') return;
  if (node.start == null) {
    const inner = node.argument || node.expression;
    const own = inner && inner.start != null ? inner : range;
    node.start = own.start;
    node.end = own.end;
  }
  for (const key of Object.keys(node)) {
    if (SKIP_KEYS.has(key)) continue;
    const v = node[key];
    if (Array.isArray(v)) v.forEach((c) => stampMissing(c, node));
    else if (v && typeof v.type === 'string') stampMissing(v, node);
  }
}

// ---- known-boolean bindings -------------------------------------------------
function isBooleanType(ann) {
  const ty = ann && (ann.typeAnnotation || ann);
  return !!ty && ty.type === 'TSBooleanKeyword';
}

function booleanBindings(fnNode) {
  const declared = {};
  const bools = new Set();
  const note = (id, isBool) => {
    if (!id || id.type !== 'Identifier') return;
    declared[id.name] = (declared[id.name] || 0) + 1;
    if (isBool) bools.add(id.name);
  };
  for (const p of fnNode.params) {
    const param = p.type === 'TSParameterProperty' ? p.parameter : p;
    if (param.type === 'Identifier') note(param, isBooleanType(param.typeAnnotation));
    else if (param.type === 'AssignmentPattern' && param.left.type === 'Identifier') note(param.left, isBooleanType(param.left.typeAnnotation) || t.isBooleanLiteral(param.right));
  }
  const visit = (n) => {
    if (!n || typeof n.type !== 'string') return;
    if (n.type === 'VariableDeclarator') note(n.id, isBooleanType(n.id.typeAnnotation));
    else if ((n.type === 'FunctionDeclaration' || n.type === 'FunctionExpression' || n.type === 'ArrowFunctionExpression') && n !== fnNode) {
      n.params.forEach((p) => note(p.type === 'AssignmentPattern' ? p.left : p, false));
    } else if (n.type === 'CatchClause') note(n.param, false);
    for (const key of Object.keys(n)) {
      if (SKIP_KEYS.has(key)) continue;
      const v = n[key];
      if (Array.isArray(v)) v.forEach(visit);
      else if (v && typeof v.type === 'string') visit(v);
    }
  };
  visit(fnNode.body);
  // A name bound more than once (shadowing, redeclaration) is not trusted.
  for (const name of [...bools]) if (declared[name] !== 1) bools.delete(name);
  return bools;
}

function isBoolean(e, ctx) {
  if (!e) return false;
  switch (e.type) {
    case 'BooleanLiteral':
      return true;
    case 'UnaryExpression':
      return e.operator === '!';
    case 'BinaryExpression':
      return COMPARISON.has(e.operator);
    case 'Identifier':
      return ctx.bools.has(e.name);
    case 'LogicalExpression':
      return (e.operator === '&&' || e.operator === '||') && isBoolean(e.left, ctx) && isBoolean(e.right, ctx);
    case 'TSAsExpression':
      return isBooleanType(e.typeAnnotation);
    default:
      return false;
  }
}

// A plain name or property path: reading it twice is the same as once.
function isPure(e) {
  if (e.type === 'Identifier' || e.type === 'ThisExpression') return true;
  if (e.type === 'MemberExpression') return (!e.computed || t.isLiteral(e.property)) && isPure(e.object);
  return false;
}

// ---- statement lists ----------------------------------------------------------
function exits(stmt) {
  if (!stmt) return false;
  if (stmt.type === 'ReturnStatement' || stmt.type === 'ThrowStatement') return true;
  if (stmt.type === 'BlockStatement') return exits(stmt.body[stmt.body.length - 1]);
  if (stmt.type === 'IfStatement') return !!stmt.alternate && exits(stmt.consequent) && exits(stmt.alternate);
  return false;
}

function canonList(stmts, ctx) {
  const out = [];
  for (const s of stmts) {
    if (s.type === 'ReturnStatement' && s.argument && s.argument.type === 'ConditionalExpression') {
      const r = ternaryReturnReplacement(s.argument);
      stampMissing(r, s);
      at(r, s);
      out.push(r);
      ctx.changed = true;
      continue;
    }
    if (s.type === 'IfStatement' && s.alternate && exits(s.consequent)) {
      const alt = s.alternate;
      s.alternate = null;
      out.push(s, ...(alt.type === 'BlockStatement' ? alt.body : [alt]));
      ctx.changed = true;
      continue;
    }
    if (s.type === 'ExpressionStatement' && s.expression.type === 'LogicalExpression' && s.expression.operator === '&&') {
      const { left, right } = s.expression;
      out.push(at(t.ifStatement(left, at(t.blockStatement([at(t.expressionStatement(right), right)]), right)), s));
      ctx.changed = true;
      continue;
    }
    out.push(s);
  }
  return out;
}

function soleStatement(stmt) {
  if (stmt.type !== 'BlockStatement') return stmt;
  return stmt.body.length === 1 ? stmt.body[0] : null;
}

// ---- single nodes -------------------------------------------------------------
function canonNode(node, ctx) {
  switch (node.type) {
    case 'IfStatement': {
      if (node.alternate) return node;
      const inner = soleStatement(node.consequent);
      if (inner && inner.type === 'IfStatement' && !inner.alternate) {
        node.test = at(t.logicalExpression('&&', node.test, inner.test), { start: node.test.start, end: inner.test.end });
        node.consequent = inner.consequent;
        ctx.changed = true;
      }
      return node;
    }
    case 'ConditionalExpression':
      if (isPure(node.test) && t.isNodesEquivalent(node.test, node.consequent)) {
        ctx.changed = true;
        return at(t.logicalExpression('||', node.test, node.alternate), node);
      }
      return node;
    case 'BinaryExpression': {
      if (!['===', '==', '!==', '!='].includes(node.operator)) return node;
      const lit = t.isBooleanLiteral(node.right) ? node.right : t.isBooleanLiteral(node.left) ? node.left : null;
      const other = lit === node.right ? node.left : node.right;
      if (!lit || t.isBooleanLiteral(other) || !isBoolean(other, ctx)) return node;
      const positive = (node.operator === '===' || node.operator === '==') === lit.value;
      ctx.changed = true;
      return positive ? other : at(t.unaryExpression('!', other), node);
    }
    case 'UnaryExpression':
      if (node.operator === '!' && node.argument.type === 'UnaryExpression' && node.argument.operator === '!' && isBoolean(node.argument.argument, ctx)) {
        ctx.changed = true;
        return node.argument.argument;
      }
      return node;
    case 'LogicalExpression': {
      const r = node.right;
      if ((node.operator === '&&' || node.operator === '||') && r.type === 'LogicalExpression' && r.operator === node.operator) {
        ctx.changed = true;
        const left = at(t.logicalExpression(node.operator, node.left, r.left), { start: node.left.start, end: r.left.end });
        return at(t.logicalExpression(node.operator, left, r.right), node);
      }
      return node;
    }
    case 'ArrowFunctionExpression': {
      const b = node.body;
      if (b.type === 'BlockStatement' && b.body.length === 1 && b.body[0].type === 'ReturnStatement' && b.body[0].argument
        && b.body[0].argument.type !== 'ConditionalExpression') {
        node.body = b.body[0].argument;
        ctx.changed = true;
      } else if (b.type === 'ConditionalExpression') {
        node.body = at(t.blockStatement([at(t.returnStatement(b), b)]), b);
        ctx.changed = true;
      }
      return node;
    }
    default:
      return node;
  }
}

function visit(node, ctx) {
  if (!node || typeof node.type !== 'string') return node;
  for (const key of Object.keys(node)) {
    if (SKIP_KEYS.has(key)) continue;
    const v = node[key];
    if (Array.isArray(v)) node[key] = v.map((c) => (c && typeof c.type === 'string' ? visit(c, ctx) : c));
    else if (v && typeof v.type === 'string') node[key] = visit(v, ctx);
  }
  if (node.type === 'BlockStatement') node.body = canonList(node.body, ctx);
  if (node.type === 'SwitchCase') node.consequent = canonList(node.consequent, ctx);
  return canonNode(node, ctx);
}

// ---- grouping -------------------------------------------------------------------
const PREC = {
  '??': 1, '||': 1, '&&': 2, '|': 3, '^': 4, '&': 5,
  '==': 6, '!=': 6, '===': 6, '!==': 6,
  '<': 7, '>': 7, '<=': 7, '>=': 7, instanceof: 7, in: 7,
  '<<': 8, '>>': 8, '>>>': 8, '+': 9, '-': 9, '*': 10, '/': 10, '%': 10, '**': 11,
};
const LOOSE = new Set(['ConditionalExpression', 'AssignmentExpression', 'SequenceExpression']);
const OPERATOR = new Set(['BinaryExpression', 'LogicalExpression']);

function mark(node, grouped) {
  if (!node || !(OPERATOR.has(node.type) || LOOSE.has(node.type))) return;
  node.extra = { ...(node.extra || {}), parenthesized: grouped };
}

function needsGroup(child, parent, isRight) {
  if (LOOSE.has(child.type)) return true;
  if (!OPERATOR.has(child.type)) return false;
  const c = PREC[child.operator];
  const p = PREC[parent.operator];
  const mixesNullish = (child.operator === '??') !== (parent.operator === '??') && child.type === 'LogicalExpression' && parent.type === 'LogicalExpression';
  return mixesNullish || c < p || (c === p && (parent.operator === '**' ? !isRight : isRight));
}

function regroup(node) {
  if (!node || typeof node.type !== 'string') return;
  for (const key of Object.keys(node)) {
    if (SKIP_KEYS.has(key)) continue;
    const v = node[key];
    if (Array.isArray(v)) v.forEach((c) => { mark(c, c && c.type === 'SequenceExpression'); regroup(c); });
    else if (v && typeof v.type === 'string') {
      if (OPERATOR.has(node.type) && (key === 'left' || key === 'right')) mark(v, needsGroup(v, node, key === 'right'));
      else if ((node.type === 'MemberExpression' || node.type === 'OptionalMemberExpression') && key === 'object') mark(v, true);
      else if ((node.type === 'CallExpression' || node.type === 'OptionalCallExpression' || node.type === 'NewExpression') && key === 'callee') mark(v, true);
      else if (node.type === 'ConditionalExpression') mark(v, LOOSE.has(v.type));
      else if (node.type === 'UnaryExpression' || node.type === 'AwaitExpression' || node.type === 'SpreadElement') mark(v, LOOSE.has(v.type));
      else mark(v, v.type === 'SequenceExpression');
      regroup(v);
    }
  }
}

// Rewrites one function node (FunctionDeclaration, method, arrow/function
// expression) in place into canonical form.
function canonicalizeFunction(fnNode) {
  if (fnNode.body.type !== 'BlockStatement') {
    const expr = fnNode.body;
    fnNode.body = at(t.blockStatement([at(t.returnStatement(expr), expr)]), expr);
  }
  const ctx = { bools: booleanBindings(fnNode), changed: false };
  for (let i = 0; i < 50; i++) {
    ctx.changed = false;
    fnNode.body = visit(fnNode.body, ctx);
    if (!ctx.changed) break;
  }
  regroup(fnNode.body);
  return fnNode;
}

module.exports = { canonicalizeFunction };
