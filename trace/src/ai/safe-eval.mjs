// A restricted evaluator for the one-line expressions a model drafts for a placeholder (`[item.first, item.last].join(" ")`).
//
// It does NOT run the text as JavaScript. The expression is parsed (Babel) and a tiny interpreter walks the tree, so only
// what is listed here can ever happen. There is no `vm`, no `Function`, no `eval`:
//   values      string / number / boolean / null / undefined literals, array literals, template literals
//   names       only the keys of the scope you pass (item, items, data), plus `undefined`, `NaN`, `Infinity`
//   reads       `a.b`, `a?.b`, `a["b"]`, `a[0]` with a literal key; own properties only (Object.hasOwn), never accessors,
//               never on functions, and never the keys in DENY_KEYS. Prototype chains are unreachable.
//   calls       only methods from METHODS below on the matching kind of value (they are called on the built-in prototype,
//               not looked up on the object), `map/filter/some/every/find` with an arrow function that this interpreter
//               itself runs, and the pure globals in GLOBALS (String, Number, parseInt, parseFloat, Math.round ...)
//   operators   arithmetic, comparison, logical, ??, ?:, ! - + typeof
//   nothing else: no assignment, `new`, `this`, functions or arrows as values, spread, regex, objects, sequence, `in`.
// Limits: 200 characters, 10,000 evaluation steps, 100,000 characters in any string it builds. There is no timer: the
// step counter is what stops a runaway expression.
// Errors: anything that is not allowed throws Error("expression not allowed: <why>"); a legal expression that fails at
// run time (reading a field of undefined) throws Error("expression failed: <why>").
import { parseExpression } from "@babel/parser";

export const MAX_CHARS = 200, MAX_STEPS = 10000, MAX_STRING = 100000;
export const DENY_KEYS = new Set(["constructor", "prototype", "__proto__", "__defineGetter__", "__defineSetter__", "__lookupGetter__", "__lookupSetter__", "caller", "callee", "arguments"]);

// Which methods may be called on which kind of value. Numbers: how many arguments are primitives is checked below.
const METHODS = {
  string: new Set(["toUpperCase", "toLowerCase", "trim", "trimStart", "trimEnd", "slice", "substring", "split", "replace", "replaceAll", "padStart", "padEnd", "charAt", "at", "startsWith", "endsWith", "includes", "indexOf", "concat", "repeat", "toString"]),
  number: new Set(["toFixed", "toString"]),
  array: new Set(["join", "slice", "concat", "includes", "indexOf", "at", "map", "filter", "some", "every", "find"]),
};
const PROTO = { string: String.prototype, number: Number.prototype, array: Array.prototype };
const CALLBACK = new Set(["map", "filter", "some", "every", "find"]);
const GLOBALS = { String, Number, parseInt, parseFloat, Boolean };
const MATH = { round: Math.round, floor: Math.floor, ceil: Math.ceil, abs: Math.abs, min: Math.min, max: Math.max };
const CONSTANTS = { undefined, NaN, Infinity };

const BINARY = {
  "+": (a, b) => a + b, "-": (a, b) => a - b, "*": (a, b) => a * b, "/": (a, b) => a / b, "%": (a, b) => a % b, "**": (a, b) => a ** b,
  "==": (a, b) => a == b, "!=": (a, b) => a != b, "===": (a, b) => a === b, "!==": (a, b) => a !== b, // eslint-disable-line eqeqeq
  "<": (a, b) => a < b, "<=": (a, b) => a <= b, ">": (a, b) => a > b, ">=": (a, b) => a >= b,
};
const UNARY = { "!": (a) => !a, "-": (a) => -a, "+": (a) => +a, typeof: (a) => typeof a };

const SHORT = Symbol("short-circuit"); // `a?.b` with a nullish `a`: the whole chain is undefined
const notAllowed = (why) => new Error(`expression not allowed: ${why}`);
const failed = (why) => new Error(`expression failed: ${why}`);

const kindOf = (v) => (typeof v === "string" ? "string" : typeof v === "number" ? "number" : Array.isArray(v) ? "array" : null);
const isPrimitive = (v) => v === null || v === undefined || ["string", "number", "boolean"].includes(typeof v);
const isPlain = (v) => {
  if (v === null || typeof v !== "object") return false;
  const p = Object.getPrototypeOf(v);
  return Array.isArray(v) || p === Object.prototype || p === null;
};

export function evalExpression(expr, scope = {}) {
  if (typeof expr !== "string" || !expr.trim()) throw notAllowed("empty");
  if (expr.length > MAX_CHARS) throw notAllowed(`longer than ${MAX_CHARS} characters`);
  let ast;
  try { ast = parseExpression(expr); } catch { throw notAllowed("not a single JavaScript expression"); }
  if (ast.comments?.length) throw notAllowed("comments");

  let steps = 0;
  const root = { vars: Object.assign(Object.create(null), scope), parent: null };
  const lookup = (sc, name) => { for (let s = sc; s; s = s.parent) if (Object.hasOwn(s.vars, name)) return { value: s.vars[name] }; return null; };
  const cap = (v) => { if (typeof v === "string" && v.length > MAX_STRING) throw notAllowed(`a string longer than ${MAX_STRING} characters`); return v; };

  // one own, data property of a plain object / array / string; anything else is undefined
  function read(obj, key) {
    if (obj === null || obj === undefined) throw failed(`cannot read "${String(key)}" of ${obj}`);
    key = typeof key === "number" ? String(key) : key;
    if (typeof key !== "string" || DENY_KEYS.has(key)) throw notAllowed(`the property "${String(key)}"`);
    if (typeof obj === "function") throw notAllowed("reading a function");
    // an inherited name (toString, call, hasOwnProperty ...) is a way toward the host, so it is refused, not "undefined"
    if (!Object.hasOwn(obj, key) && key in Object(obj)) throw notAllowed(`the inherited property "${key}"`);
    if (typeof obj !== "string" && !isPlain(obj)) return undefined; // numbers, booleans (and anything exotic) have no readable fields
    if (!Object.hasOwn(obj, key)) return undefined;
    const d = Object.getOwnPropertyDescriptor(obj, key);
    if (!d || !("value" in d)) throw notAllowed("a getter");
    if (typeof d.value === "function") throw notAllowed("a function value");
    return d.value;
  }

  // a member's key: `.name` or a literal string / number in brackets. Anything computed is refused.
  function keyOf(node) {
    if (!node.computed) { if (node.property.type !== "Identifier") throw notAllowed("that property name"); return node.property.name; }
    const p = node.property;
    if (p.type === "StringLiteral" || p.type === "NumericLiteral") return p.value;
    throw notAllowed("a computed property name");
  }

  function arrow(node, sc) {
    if (node.type !== "ArrowFunctionExpression" || node.async || node.generator || node.body.type === "BlockStatement" || node.params.length > 2 || node.params.some((p) => p.type !== "Identifier" || DENY_KEYS.has(p.name))) throw notAllowed("a function");
    return (...a) => {
      const vars = Object.create(null);
      node.params.forEach((p, i) => { vars[p.name] = a[i]; });
      return ev(node.body, { vars, parent: sc });
    };
  }

  function call(node, sc) {
    const c = node.callee;
    if (node.optional) throw notAllowed("an optional call");
    // a pure global: String(x), Number(x), Math.round(x)
    if (c.type === "Identifier" && Object.hasOwn(GLOBALS, c.name) && !lookup(sc, c.name)) return cap(Reflect.apply(GLOBALS[c.name], undefined, node.arguments.map((a) => plainArg(ev(a, sc)))));
    if ((c.type === "MemberExpression") && c.object.type === "Identifier" && c.object.name === "Math" && !lookup(sc, "Math")) {
      const name = keyOf(c);
      if (!Object.hasOwn(MATH, name)) throw notAllowed(`Math.${name}`);
      return Reflect.apply(MATH[name], undefined, node.arguments.map((a) => numberArg(ev(a, sc))));
    }
    if (c.type !== "MemberExpression" && c.type !== "OptionalMemberExpression") throw notAllowed("calling that");
    const obj = ev(c.object, sc, true);
    if (c.optional && (obj === null || obj === undefined)) throw SHORT;
    const name = keyOf(c);
    const kind = kindOf(obj);
    if (!kind || DENY_KEYS.has(name) || !METHODS[kind].has(name)) throw notAllowed(`the method "${name}"`);
    if (kind === "array" && !isPlain(obj)) throw notAllowed("that value");
    const args = node.arguments.map((a) => {
      if (a.type === "SpreadElement" || a.type === "ArgumentPlaceholder") throw notAllowed("spread");
      if (CALLBACK.has(name)) return arrow(a, sc);
      return kind === "array" ? plainArg(ev(a, sc)) : primitiveArg(ev(a, sc));
    });
    if (CALLBACK.has(name) && args.length !== 1) throw notAllowed(`${name} takes one function`);
    if (kind === "string" && (name === "repeat" || name === "padStart" || name === "padEnd") && !(args[0] >= 0 && args[0] <= 1000)) throw notAllowed(`${name} with that length`);
    if (kind === "string" && name === "split" && args.length > 1 && !(args[1] >= 0 && args[1] <= 1000)) throw notAllowed("split with that limit");
    if (kind === "number" && name === "toFixed" && !(Number.isInteger(args[0] ?? 0) && (args[0] ?? 0) >= 0 && (args[0] ?? 0) <= 20)) throw notAllowed("toFixed with those digits");
    if (kind === "number" && name === "toString" && args.length && !(Number.isInteger(args[0]) && args[0] >= 2 && args[0] <= 36)) throw notAllowed("toString with that radix");
    let out;
    try { out = Reflect.apply(PROTO[kind][name], obj, args); } catch (e) { if (e instanceof Error && /^expression /.test(e.message)) throw e; throw failed(e.message); }
    if (typeof out === "function") throw notAllowed("a function result");
    return cap(out);
  }

  const primitiveArg = (v) => { if (!isPrimitive(v)) throw notAllowed("that argument"); return v; };
  const numberArg = (v) => { if (typeof v !== "number") throw notAllowed("that argument"); return v; };
  const plainArg = (v) => { if (!isPrimitive(v) && !isPlain(v)) throw notAllowed("that argument"); return v; };

  function ev(node, sc, inChain = false) {
    if (++steps > MAX_STEPS) throw notAllowed(`more than ${MAX_STEPS} steps`);
    switch (node.type) {
      case "StringLiteral": case "NumericLiteral": case "BooleanLiteral": return node.value;
      case "NullLiteral": return null;
      case "Identifier": {
        const hit = lookup(sc, node.name);
        if (hit && !DENY_KEYS.has(node.name)) return hit.value;
        if (Object.hasOwn(CONSTANTS, node.name)) return CONSTANTS[node.name];
        throw notAllowed(`the name "${node.name}"`);
      }
      case "TemplateLiteral": {
        let s = node.quasis[0].value.cooked ?? "";
        node.expressions.forEach((e, i) => { const v = ev(e, sc); if (!isPrimitive(v) && !isPlain(v)) throw notAllowed("that value in a template"); s = cap(s + String(v) + (node.quasis[i + 1].value.cooked ?? "")); });
        return s;
      }
      case "ArrayExpression":
        return node.elements.map((e) => { if (!e || e.type === "SpreadElement") throw notAllowed("spread or holes in an array"); return ev(e, sc); });
      case "MemberExpression": case "OptionalMemberExpression": {
        try {
          const obj = ev(node.object, sc, true);
          if (node.optional && (obj === null || obj === undefined)) throw SHORT;
          return read(obj, keyOf(node));
        } catch (e) { if (e === SHORT && !inChain) return undefined; throw e; }
      }
      case "CallExpression": case "OptionalCallExpression": {
        try { return call(node, sc); } catch (e) { if (e === SHORT && !inChain) return undefined; throw e; }
      }
      case "BinaryExpression": {
        const f = BINARY[node.operator];
        if (!f || node.left.type === "PrivateName") throw notAllowed(`the operator ${node.operator}`);
        const a = ev(node.left, sc), b = ev(node.right, sc);
        if (!isPrimitive(a) && !isPlain(a)) throw notAllowed("that operand");
        if (!isPrimitive(b) && !isPlain(b)) throw notAllowed("that operand");
        return cap(f(a, b));
      }
      case "UnaryExpression": {
        const f = UNARY[node.operator];
        if (!f) throw notAllowed(`the operator ${node.operator}`);
        return f(ev(node.argument, sc));
      }
      case "LogicalExpression": {
        const a = ev(node.left, sc);
        if (node.operator === "&&") return a ? ev(node.right, sc) : a;
        if (node.operator === "||") return a ? a : ev(node.right, sc);
        if (node.operator === "??") return a ?? ev(node.right, sc);
        throw notAllowed(`the operator ${node.operator}`);
      }
      case "ConditionalExpression": return ev(node.test, sc) ? ev(node.consequent, sc) : ev(node.alternate, sc);
      default: throw notAllowed(node.type === "ThisExpression" ? "this" : `${node.type.replace(/Expression$/, "").toLowerCase() || "that"} syntax`);
    }
  }

  const out = ev(ast, root);
  if (typeof out === "function") throw notAllowed("a function result");
  return out;
}
