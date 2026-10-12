// Line logic verification, step 6 (spec C3): the translator from a small TypeScript subset to a solver-neutral IR that
// z3Prove.mjs lowers to Z3. Pure: no Z3 here, so the subset is testable on its own and Z3 loads only when a proof runs.
//
// The subset (anything else throws Unsupported, and the Z3 layer reports "skipped": never a false "proven"):
//   params       identifiers typed number, boolean or string, or an object type (an inline type literal, or an interface
//                or type alias declared in the same file) whose required members are those types or nested object types;
//                each member read `p.a.b` is a free variable
//   statements   return <expr>; if (...) ... else ...; blocks; const x = <expr>; (early returns become nested ites)
//   expressions  number, string and boolean literals; params, member reads and consts; ! - (unary); < <= > >= on numbers;
//                === !== == != on two values of one type; + - * / on numbers; + on two strings; && || on booleans;
//                c ? a : b (both branches one type); truthiness of a number or string in a test position
//
// Numbers are IEEE doubles in the lowering (NaN, infinities and -0 included), so `!(a >= 18)` and `a < 18` differ at NaN,
// as they do in JS.
/** @typedef {'num'|'bool'|'str'} Sort */
/**
 * The IR: every node has its sort.
 * @typedef {{k: 'var', sort: Sort, name: string}
 *   | {k: 'lit', sort: Sort, v: number|string|boolean}
 *   | {k: 'not', sort: 'bool', a: Ir} | {k: 'and'|'or', sort: 'bool', a: Ir, b: Ir}
 *   | {k: 'truthy', sort: 'bool', a: Ir}
 *   | {k: 'cmp', sort: 'bool', op: '<'|'<='|'>'|'>=', a: Ir, b: Ir}
 *   | {k: 'eq', sort: 'bool', neg: boolean, a: Ir, b: Ir}
 *   | {k: 'arith', sort: 'num', op: '+'|'-'|'*'|'/', a: Ir, b: Ir} | {k: 'neg', sort: 'num', a: Ir}
 *   | {k: 'concat', sort: 'str', a: Ir, b: Ir}
 *   | {k: 'ite', sort: Sort, c: Ir, a: Ir, b: Ir}} Ir
 */
/**
 * A free variable of the translated function: a positional param (`$0`) or a member read on one (`$0.age`).
 * @typedef {{name: string, sort: Sort, path: string[]}} FreeVar
 */
/** @typedef {{vars: FreeVar[], body: Ir}} Translation */

/** Thrown for code outside the subset; `message` is one plain sentence naming the construct. */
export class Unsupported extends Error {}

const unsupported = (what) => { throw new Unsupported(`${what} is outside the Z3 subset.`); };
const KEYWORD_SORT = { TSNumberKeyword: 'num', TSBooleanKeyword: 'bool', TSStringKeyword: 'str' };
const CMP = new Set(['<', '<=', '>', '>=']);
const EQ = { '===': false, '==': false, '!==': true, '!=': true };
const ARITH = new Set(['+', '-', '*', '/']);

/**
 * The named function in a parsed module: a function declaration, or a `const` bound to an arrow or function expression
 * (exported or not).
 * @param {any} program A typescript-estree Program.
 * @param {string} name
 * @returns {any|null} The function node.
 */
export function findFunction(program, name) {
  for (const st of program.body) {
    const d = st.type === 'ExportNamedDeclaration' || st.type === 'ExportDefaultDeclaration' ? st.declaration : st;
    if (!d) continue;
    if (d.type === 'FunctionDeclaration' && d.id?.name === name) return d;
    if (d.type === 'VariableDeclaration') {
      for (const v of d.declarations) {
        if (v.id.type === 'Identifier' && v.id.name === name && (v.init?.type === 'ArrowFunctionExpression' || v.init?.type === 'FunctionExpression')) return v.init;
      }
    }
  }
  return null;
}

/** Top-level interfaces and type aliases of the module, by name (for typed object params). */
function typeDecls(program) {
  const out = new Map();
  for (const st of program.body) {
    const d = st.type === 'ExportNamedDeclaration' ? st.declaration : st;
    if (d?.type === 'TSInterfaceDeclaration' && !d.extends?.length) out.set(d.id.name, { type: 'TSTypeLiteral', members: d.body.body });
    if (d?.type === 'TSTypeAliasDeclaration') out.set(d.id.name, d.typeAnnotation);
  }
  return out;
}

/**
 * The value a param of this type binds to: a free variable for a primitive, an object of member values otherwise.
 * @returns {Ir|{k: 'obj', fields: Record<string, any>}}
 */
function bindType(typeNode, name, path, types, vars, depth = 0) {
  if (!typeNode) unsupported(`An untyped parameter (${path.join('.') || name})`);
  const sort = KEYWORD_SORT[typeNode.type];
  if (sort) {
    vars.push({ name, sort, path });
    return { k: 'var', sort, name };
  }
  if (depth > 3) unsupported('An object type nested deeper than three levels');
  let lit = typeNode;
  if (typeNode.type === 'TSTypeReference' && typeNode.typeName?.type === 'Identifier' && !typeNode.typeArguments) lit = types.get(typeNode.typeName.name);
  if (lit?.type !== 'TSTypeLiteral') unsupported(`The parameter type ${typeNode.type === 'TSTypeReference' ? typeNode.typeName?.name ?? 'reference' : typeNode.type}`);
  const fields = {};
  for (const m of lit.members) {
    if (m.type !== 'TSPropertySignature' || m.computed || m.key.type !== 'Identifier') unsupported(`A ${m.type} member`);
    if (m.optional) unsupported(`The optional member ${m.key.name}`);
    fields[m.key.name] = bindType(m.typeAnnotation?.typeAnnotation, `${name}.${m.key.name}`, [...path, m.key.name], types, vars, depth + 1);
  }
  return { k: 'obj', fields };
}

/** A value in a test position, as a boolean (JS truthiness for numbers and strings). */
const truthy = (ir) => (ir.sort === 'bool' ? ir : { k: 'truthy', sort: 'bool', a: ir });

/**
 * Translate one expression.
 * @param {any} n
 * @param {Map<string, any>} env Param and const bindings.
 * @returns {Ir}
 */
function expr(n, env) {
  switch (n.type) {
    case 'Literal':
      if (typeof n.value === 'number') return { k: 'lit', sort: 'num', v: n.value };
      if (typeof n.value === 'string') return { k: 'lit', sort: 'str', v: n.value };
      if (typeof n.value === 'boolean') return { k: 'lit', sort: 'bool', v: n.value };
      return unsupported(`The literal ${n.raw}`);
    case 'Identifier': {
      const b = env.get(n.name);
      if (!b) return unsupported(`The free name ${n.name}`);
      if (b.k === 'obj') return unsupported(`Using the object ${n.name} as a value`);
      return b;
    }
    case 'MemberExpression': {
      if (n.computed || n.optional || n.property.type !== 'Identifier') return unsupported('A computed or optional member read');
      const obj = n.object.type === 'Identifier' ? env.get(n.object.name) : memberObj(n.object, env);
      if (obj?.k !== 'obj') return unsupported(`The member read .${n.property.name} on something that is not a typed object param`);
      const f = obj.fields[n.property.name];
      if (!f) return unsupported(`The member ${n.property.name}, which its type does not declare,`);
      if (f.k === 'obj') return unsupported(`Using the object member ${n.property.name} as a value`);
      return f;
    }
    case 'UnaryExpression': {
      const a = expr(n.argument, env);
      if (n.operator === '!') return { k: 'not', sort: 'bool', a: truthy(a) };
      if (n.operator === '-' && a.sort === 'num') return { k: 'neg', sort: 'num', a };
      return unsupported(`The unary ${n.operator} on a ${a.sort}`);
    }
    case 'BinaryExpression': {
      const a = expr(n.left, env);
      const b = expr(n.right, env);
      if (CMP.has(n.operator)) {
        if (a.sort !== 'num' || b.sort !== 'num') return unsupported(`The comparison ${n.operator} on non-numbers`);
        return { k: 'cmp', sort: 'bool', op: n.operator, a, b };
      }
      if (n.operator in EQ) {
        if (a.sort !== b.sort) return unsupported(`The equality ${n.operator} between a ${a.sort} and a ${b.sort}`);
        return { k: 'eq', sort: 'bool', neg: EQ[n.operator], a, b };
      }
      if (n.operator === '+' && a.sort === 'str' && b.sort === 'str') return { k: 'concat', sort: 'str', a, b };
      if (ARITH.has(n.operator) && a.sort === 'num' && b.sort === 'num') return { k: 'arith', sort: 'num', op: n.operator, a, b };
      return unsupported(`The operator ${n.operator} on a ${a.sort} and a ${b.sort}`);
    }
    case 'LogicalExpression': {
      if (n.operator === '??') return unsupported('The ?? operator');
      const a = expr(n.left, env);
      const b = expr(n.right, env);
      // on non-booleans && and || return an operand, not a boolean
      if (a.sort !== 'bool' || b.sort !== 'bool') return unsupported(`The operator ${n.operator} on non-booleans`);
      return { k: n.operator === '&&' ? 'and' : 'or', sort: 'bool', a, b };
    }
    case 'ConditionalExpression': {
      const c = truthy(expr(n.test, env));
      const a = expr(n.consequent, env);
      const b = expr(n.alternate, env);
      if (a.sort !== b.sort) return unsupported(`A ternary whose branches are a ${a.sort} and a ${b.sort}`);
      return { k: 'ite', sort: a.sort, c, a, b };
    }
    default:
      return unsupported(`A ${n.type}`);
  }
}

/** The object binding a member chain like `a.b` reads (for `a.b.c`). */
function memberObj(n, env) {
  if (n.type !== 'MemberExpression' || n.computed || n.optional || n.property.type !== 'Identifier') return null;
  const o = n.object.type === 'Identifier' ? env.get(n.object.name) : memberObj(n.object, env);
  return o?.k === 'obj' ? o.fields[n.property.name] ?? null : null;
}

/** Statements of a nested block, refusing declarations (they would leak into the statements after the block). */
function inner(s) {
  const list = s.type === 'BlockStatement' ? s.body : [s];
  if (list.some((x) => x.type === 'VariableDeclaration')) unsupported('A declaration inside a nested block');
  return list;
}

/**
 * Translate a statement list to the value it returns: every path must end in a return.
 * @param {any[]} list
 * @param {Map<string, any>} env
 * @returns {Ir}
 */
function block(list, env) {
  if (list.length === 0) return unsupported('A path that ends without a return');
  const [s, ...rest] = list;
  switch (s.type) {
    case 'ReturnStatement':
      if (!s.argument) return unsupported('A bare return');
      return expr(s.argument, env);
    case 'EmptyStatement':
      return block(rest, env);
    case 'BlockStatement':
      return block([...inner(s), ...rest], env);
    case 'IfStatement': {
      const c = truthy(expr(s.test, env));
      const a = block([...inner(s.consequent), ...rest], env);
      const b = block([...(s.alternate ? inner(s.alternate) : []), ...rest], env);
      if (a.sort !== b.sort) return unsupported(`Branches that return a ${a.sort} and a ${b.sort}`);
      return { k: 'ite', sort: a.sort, c, a, b };
    }
    case 'VariableDeclaration': {
      if (s.kind !== 'const') return unsupported(`A ${s.kind} declaration`);
      const next = new Map(env);
      for (const d of s.declarations) {
        if (d.id.type !== 'Identifier' || !d.init) return unsupported('A destructuring or uninitialised const');
        next.set(d.id.name, expr(d.init, next));
      }
      return block(rest, next);
    }
    default:
      return unsupported(`A ${s.type}`);
  }
}

/**
 * Translate one function to its free variables and the IR of the value it returns. Params are named by position (`$0`,
 * `$0.age`), so a renamed param still lines up with the other side.
 * @param {any} program The parsed module (for interface and type alias lookups).
 * @param {any} fnNode From findFunction.
 * @returns {Translation}
 * @throws {Unsupported}
 */
export function translateFunction(program, fnNode) {
  if (fnNode.async || fnNode.generator) unsupported('An async or generator function');
  const types = typeDecls(program);
  /** @type {FreeVar[]} */
  const vars = [];
  const env = new Map();
  fnNode.params.forEach((p, i) => {
    if (p.type !== 'Identifier') unsupported(`A ${p.type} parameter`);
    if (p.optional) unsupported(`The optional parameter ${p.name}`);
    env.set(p.name, bindType(p.typeAnnotation?.typeAnnotation, `$${i}`, [], types, vars));
  });
  const body = fnNode.body.type === 'BlockStatement' ? block(fnNode.body.body, env) : expr(fnNode.body, env);
  return { vars, body };
}
