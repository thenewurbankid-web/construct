// JS -> atoms: a deterministic Babel rewrite of operators, control flow and
// built-in calls into calls of the atom runtime's plain-function atoms
// (smith-functional, src/atoms/catalog.json). No model involved.
//
//   toAtoms(code, { catalog, kind, typeHint, importFrom })
//     -> { code, body, imports, importDecl, atoms, untranslated, converted }
//
// catalog    a compiled catalog (atoms-catalog.js compileCatalog/loadCatalog)
// kind       'module' (default) | 'function' | 'method' (a class method lifted
//            out of its class; parsed inside a wrapper class)
// typeHint   optional (start, end) -> 'string' | 'number' | 'bigint' |
//            'boolean' | 'list' | 'function' | 'other' | 'any' | 'unknown',
//            the kind of value the source range [start, end) of `code` holds
//            (the verifier fills this from the TypeScript checker). Used to
//            pick plus() vs join() for `+`, and to leave methods of non-list,
//            non-text values alone.
//
// Rules (each has unit tests in atoms-transform.test.js):
//  1. Expressions: any node matching a catalog form (`a + b`, `list.map(fn)`,
//     `typeof value === 'string'`, `obj?.[key]` ...) becomes `atom(args)`;
//     args follow the atom's parameter order; a placeholder in a lazy
//     position of the form (right of && || ??, a ?: branch) becomes a thunk.
//     The largest matching form wins.
//  2. Compound assignment `x += y` becomes `x = plus(x, y)` (simple targets).
//  3. if / else if / else becomes when(...) or choose([...]) with thunk
//     branches. Without a return inside it is an expression statement. With
//     returns it must sit directly in a function body: `return when(...)`,
//     and the statements after it move into the one branch that falls
//     through (none may need them twice).
//  4. switch over string cases becomes match(value, {case: thunk}, fallback).
//  5. try/catch/finally becomes attempt(() => body, (e) => recover, () => cleanup)
//     (attemptAsync with async thunks when the body awaits).
//  6. for (const x of list) { ... } becomes each(list, (x) => { ... }) when the
//     body has no break/continue/return/await/yield.
//  7. throw x becomes fail(x).
//  8. Mutating built-ins (sort, reverse, splice) map to the copy-returning
//     atoms ONLY when the result is used as a value and the receiver is a
//     fresh value (an array literal or a copy-returning call), never when it
//     mutates something shared; push/pop/shift/unshift/fill never map.
//  9. return/function/class/await/yield/destructuring/spread stay syntax.
// 10. Anything with no catalog entry is left as it is and recorded in
//     `untranslated: [{type, form, start, end, reason?}]` (offsets into `code`).
const parser = require('@babel/parser');
const generate = require('@babel/generator').default;
const t = require('@babel/types');
const { GLOBALS, shapeKey } = require('./atoms-catalog');

const PARSE_OPTS = { sourceType: 'module', plugins: ['typescript', 'jsx'], errorRecovery: true };
const META = new Set(['loc', 'start', 'end', 'extra', 'comments', 'errors', 'tokens', 'leadingComments', 'trailingComments', 'innerComments', 'range', 'typeAnnotation', 'returnType', 'typeParameters', 'typeArguments', '_atom']);

const BUILTIN_METHODS = new Set([
  'map', 'filter', 'reduce', 'reduceRight', 'find', 'findIndex', 'findLast', 'findLastIndex', 'some', 'every',
  'includes', 'indexOf', 'lastIndexOf', 'join', 'slice', 'splice', 'concat', 'flat', 'flatMap', 'sort', 'reverse',
  'push', 'pop', 'shift', 'unshift', 'fill', 'at', 'forEach', 'toLowerCase', 'toUpperCase', 'trim', 'trimStart',
  'trimEnd', 'startsWith', 'endsWith', 'split', 'replace', 'replaceAll', 'padStart', 'padEnd', 'charAt',
  'charCodeAt', 'repeat', 'substring', 'substr', 'match', 'matchAll', 'search', 'localeCompare', 'toFixed',
  'toSorted', 'toReversed', 'toSpliced', 'with', 'then', 'catch', 'finally',
]);
const GLOBAL_FUNCS = new Set(['parseInt', 'parseFloat', 'isNaN', 'isFinite', 'String', 'Number', 'Boolean', 'encodeURIComponent', 'decodeURIComponent', 'structuredClone']);
const STATIC_OBJECTS = new Set(['Math', 'JSON', 'Object', 'Array', 'Number', 'String', 'Promise', 'Date', 'Reflect']);
const NEW_BUILTINS = new Set(['Map', 'Set', 'Date', 'Error', 'TypeError', 'RangeError', 'RegExp', 'URL', 'URLSearchParams', 'Promise', 'Array', 'WeakMap', 'WeakSet']);
// mutating method -> its copy-returning JS spelling (whose catalog form is then used)
const COPY_OF = Object.assign(Object.create(null), { sort: 'toSorted', reverse: 'toReversed', splice: 'toSpliced' });
const NEVER_COPY = new Set(['push', 'pop', 'shift', 'unshift', 'fill', 'copyWithin']);
// calls whose result is a fresh array nobody else holds
const FRESH_METHODS = new Set(['slice', 'map', 'filter', 'concat', 'flat', 'flatMap', 'toSorted', 'toReversed', 'toSpliced', 'split', 'keys', 'values', 'entries', 'from', 'of']);

// ---------------------------------------------------------------------------
// small AST helpers

const isFnNode = (n) => n && (n.type === 'FunctionDeclaration' || n.type === 'FunctionExpression' || n.type === 'ArrowFunctionExpression' || n.type === 'ObjectMethod' || n.type === 'ClassMethod' || n.type === 'ClassPrivateMethod');
const isLoop = (n) => n && /^(While|DoWhile|For|ForIn|ForOf)Statement$/.test(n.type);

function childKeys(n) {
  return Object.keys(n).filter((k) => !META.has(k));
}

// What a statement/expression contains, not looking into nested functions.
function scan(node) {
  const r = { ret: false, brk: false, cont: false, awaits: false, yields: false, vars: false, labels: false };
  const visit = (n, inLoop, inSwitch) => {
    if (!n || typeof n.type !== 'string') return;
    if (isFnNode(n) || n.type === 'ClassBody') return;
    switch (n.type) {
      case 'ReturnStatement': r.ret = true; break;
      case 'BreakStatement': if (n.label || (!inLoop && !inSwitch)) r.brk = true; break;
      case 'ContinueStatement': if (n.label || !inLoop) r.cont = true; break;
      case 'AwaitExpression': r.awaits = true; break;
      case 'ForOfStatement': if (n.await) r.awaits = true; break;
      case 'YieldExpression': r.yields = true; break;
      case 'VariableDeclaration': if (n.kind === 'var') r.vars = true; break;
      case 'LabeledStatement': r.labels = true; break;
      default: break;
    }
    const nextLoop = inLoop || isLoop(n);
    const nextSwitch = inSwitch || n.type === 'SwitchStatement';
    for (const k of childKeys(n)) {
      const v = n[k];
      if (Array.isArray(v)) v.forEach((c) => visit(c, nextLoop, nextSwitch));
      else if (v && typeof v.type === 'string') visit(v, nextLoop, nextSwitch);
    }
  };
  visit(node, false, false);
  return r;
}

// Statements that never complete normally.
function terminal(st) {
  if (!st) return false;
  switch (st.type) {
    case 'ReturnStatement':
    case 'ThrowStatement':
      return true;
    case 'ExpressionStatement':
      return !!st._terminal;
    case 'BlockStatement':
      return st.body.length > 0 && terminal(st.body[st.body.length - 1]);
    case 'IfStatement':
      return !!st.alternate && terminal(st.consequent) && terminal(st.alternate);
    default:
      return false;
  }
}

const stmtsOf = (st) => (st == null ? [] : st.type === 'BlockStatement' ? st.body : [st]);
const hasHoisted = (stmts) => stmts.some((s) => s.type === 'FunctionDeclaration' || (s.type === 'VariableDeclaration' && s.kind === 'var'));

function isPureRef(n) {
  if (!n) return false;
  if (n.type === 'Identifier' || n.type === 'ThisExpression') return true;
  if ((n.type === 'MemberExpression') && !n.computed) return isPureRef(n.object);
  if (n.type === 'MemberExpression' && n.computed && (n.property.type === 'NumericLiteral' || n.property.type === 'StringLiteral')) return isPureRef(n.object);
  return false;
}

function sameNode(a, b) {
  if (a === b) return true;
  if (!a || !b || a.type !== b.type) return false;
  for (const k of childKeys(a)) {
    const x = a[k];
    const y = b[k];
    if (Array.isArray(x)) {
      if (!Array.isArray(y) || x.length !== y.length || !x.every((c, i) => sameNode(c, y[i]))) return false;
    } else if (x && typeof x === 'object' && typeof x.type === 'string') {
      if (!sameNode(x, y)) return false;
    } else if (x !== y && !(x == null && y == null)) {
      return false;
    }
  }
  return true;
}

function literalValue(n) {
  switch (n.type) {
    case 'StringLiteral': case 'NumericLiteral': case 'BooleanLiteral': return n.value;
    case 'NullLiteral': return null;
    case 'BigIntLiteral': return `${n.value}n`;
    case 'RegExpLiteral': return `/${n.pattern}/${n.flags}`;
    default: return undefined;
  }
}
const isLiteral = (n) => n && /^(String|Numeric|Boolean|Null|BigInt|RegExp)Literal$/.test(n.type);

// ---------------------------------------------------------------------------
// pattern matching

function makeMatcher(names, boundNames, vars = []) {
  const ph = new Set(names);
  const pv = new Set(vars);
  const vb = {};
  const b = {};
  const rest = {}; // placeholder of a `...rest` argument -> the call's remaining arguments
  const missing = new Set();
  const m = (p, n) => {
    if (!p || !n) return p === n || (p == null && n == null);
    if (p.type === 'Identifier' && ph.has(p.name)) {
      if (n.type === 'SpreadElement' || n.type === 'ArgumentPlaceholder' || n.type === 'JSXNamespacedName') return false;
      if (Object.prototype.hasOwnProperty.call(b, p.name)) return sameNode(b[p.name], n) && isPureRef(n);
      b[p.name] = n;
      return true;
    }
    if (p.type === 'Identifier' && pv.has(p.name)) {
      if (n.type !== 'Identifier') return false;
      if (Object.prototype.hasOwnProperty.call(vb, p.name)) return vb[p.name] === n.name;
      vb[p.name] = n.name;
      return true;
    }
    if (isLiteral(p)) return isLiteral(n) && p.type === n.type && literalValue(p) === literalValue(n);
    if (p.type === 'Identifier') return n.type === 'Identifier' && n.name === p.name && !boundNames.has(n.name);
    if ((p.type === 'MemberExpression' || p.type === 'OptionalMemberExpression') && p.type === n.type) {
      if (!!p.optional !== !!n.optional) return false;
      if (!m(p.object, n.object)) return false;
      if (p.computed && !n.computed && n.property.type === 'Identifier') return m(p.property, t.stringLiteral(n.property.name));
      if (!p.computed && !n.computed) return p.property.name === n.property.name;
      if (p.computed && n.computed) return m(p.property, n.property);
      return false;
    }
    if (/CallExpression$|^NewExpression$/.test(p.type) && p.type === n.type) {
      if (!!p.optional !== !!n.optional) return false;
      if (!m(p.callee, n.callee)) return false;
      // `f(a, ...rest)`: the last placeholder takes every remaining argument, spread or not
      const tail = p.arguments[p.arguments.length - 1];
      const restName = tail && tail.type === 'SpreadElement' && tail.argument.type === 'Identifier' && ph.has(tail.argument.name) ? tail.argument.name : null;
      const fixed = restName ? p.arguments.length - 1 : p.arguments.length;
      if (restName) {
        if (Object.prototype.hasOwnProperty.call(b, restName)) return false;
        const more = n.arguments.slice(fixed);
        if (n.arguments.slice(0, fixed).some((a) => a.type === 'SpreadElement')) return false;
        rest[restName] = more;
        b[restName] = more.length === 1 && more[0].type === 'SpreadElement' ? more[0].argument : t.arrayExpression(more);
      } else if (n.arguments.length > p.arguments.length) return false;
      for (let i = 0; i < fixed; i++) {
        const pa = p.arguments[i];
        const na = n.arguments[i];
        if (!na) {
          if (pa.type === 'Identifier' && ph.has(pa.name)) { missing.add(pa.name); continue; }
          return false;
        }
        if (na.type === 'SpreadElement' && pa.type !== 'SpreadElement') return false;
        if (!m(pa, na)) return false;
      }
      return true;
    }
    if (p.type !== n.type) return false;
    for (const k of childKeys(p)) {
      const x = p[k];
      const y = n[k];
      if (Array.isArray(x)) {
        if (!Array.isArray(y) || x.length !== y.length) return false;
        for (let i = 0; i < x.length; i++) if (!m(x[i], y[i])) return false;
      } else if (x && typeof x === 'object' && typeof x.type === 'string') {
        if (!m(x, y)) return false;
      } else if (x !== y && !(x == null && y == null) && !(x === false && y == null) && !(x == null && y === false)) {
        return false;
      }
    }
    return true;
  };
  return { match: (p, n) => m(p, n), bindings: b, missing, rest };
}

// ---------------------------------------------------------------------------

function kindsCompatible(kinds, hint) {
  if (!hint || hint === 'any' || hint === 'unknown') return 'maybe';
  if (!kinds || !kinds.length || kinds.includes('any')) return 'yes';
  if (kinds.includes(hint)) return 'yes';
  if (kinds.includes('text-or-list') && (hint === 'string' || hint === 'list')) return 'yes';
  if (kinds.includes('collection') && (hint === 'set' || hint === 'map')) return 'yes';
  return 'no';
}

const looksText = (n) => n && (n.type === 'StringLiteral' || n.type === 'TemplateLiteral');
const looksNumber = (n) => n && (n.type === 'NumericLiteral' || (n.type === 'UnaryExpression' && n.operator === '-' && n.argument.type === 'NumericLiteral'));

function collectNames(ast) {
  const names = new Set();
  const visit = (n, parent, key) => {
    if (!n || typeof n.type !== 'string') return;
    if (n.type === 'Identifier') {
      const isProp = parent && /MemberExpression$/.test(parent.type) && key === 'property' && !parent.computed;
      const isKey = parent && /^(ObjectProperty|ObjectMethod|ClassMethod|ClassProperty|ClassPrivateMethod|TSPropertySignature)$/.test(parent.type) && key === 'key' && !parent.computed;
      if (!isProp && !isKey) names.add(n.name);
    }
    for (const k of Object.keys(n)) {
      if (k === 'loc' || k === 'leadingComments' || k === 'trailingComments' || k === 'innerComments') continue;
      const v = n[k];
      if (Array.isArray(v)) v.forEach((c) => visit(c, n, k));
      else if (v && typeof v.type === 'string') visit(v, n, k);
    }
  };
  visit(ast, null, null);
  return names;
}

// Every name the code declares (params, variables, functions, classes, catch
// params, imports) -- a form's global (Object, Math ...) only matches when the
// code does not shadow it.
function collectBound(ast) {
  const out = new Set();
  const pat = (p) => {
    if (!p) return;
    if (p.type === 'Identifier') out.add(p.name);
    else if (p.type === 'ObjectPattern') p.properties.forEach((x) => pat(x.type === 'RestElement' ? x.argument : x.value));
    else if (p.type === 'ArrayPattern') p.elements.forEach(pat);
    else if (p.type === 'AssignmentPattern') pat(p.left);
    else if (p.type === 'RestElement') pat(p.argument);
    else if (p.type === 'TSParameterProperty') pat(p.parameter);
  };
  const visit = (n) => {
    if (!n || typeof n.type !== 'string') return;
    if (n.type === 'VariableDeclarator') pat(n.id);
    if (isFnNode(n)) { n.params.forEach(pat); if (n.id && n.type !== 'ArrowFunctionExpression') pat(n.id); }
    if ((n.type === 'ClassDeclaration' || n.type === 'ClassExpression') && n.id) pat(n.id);
    if (n.type === 'CatchClause') pat(n.param);
    if (/^Import(Default|Namespace)?Specifier$/.test(n.type)) pat(n.local);
    if (n.type === 'TSEnumDeclaration' && n.id) pat(n.id);
    for (const k of Object.keys(n)) {
      if (k === 'loc' || k === 'leadingComments' || k === 'trailingComments' || k === 'innerComments') continue;
      const v = n[k];
      if (Array.isArray(v)) v.forEach(visit);
      else if (v && typeof v.type === 'string') visit(v);
    }
  };
  visit(ast);
  return out;
}

function toAtoms(code, options = {}) {
  const { catalog, kind = 'module', typeHint = null, importFrom = 'smith' } = options;
  if (!catalog) throw new Error('toAtoms: options.catalog is required (atoms-catalog.js compileCatalog/loadCatalog)');
  const prefix = kind === 'method' ? 'class __W__ {\n' : '';
  const wrapped = kind === 'method' ? `${prefix}${code}\n}` : code;
  const offset = prefix.length;
  const ast = parser.parse(wrapped, PARSE_OPTS);
  const names = collectNames(ast);
  const bound = collectBound(ast);
  const has = (atom) => catalog.atoms.has(atom);
  const used = new Map(); // atom -> local name
  const untranslated = [];
  let converted = 0;

  const byKey = new Map();
  for (const p of catalog.patterns) {
    if (!byKey.has(p.key)) byKey.set(p.key, []);
    byKey.get(p.key).push(p);
  }

  const hintOf = (n) => {
    if (!typeHint || !n || n.start == null) return 'unknown';
    try {
      return typeHint(n.start - offset, n.end - offset) || 'unknown';
    } catch {
      return 'unknown';
    }
  };
  const record = (n, form, reason) => {
    if (!n || n.start == null) return;
    const e = { type: n.type, form: form || shapeKey(n), start: n.start - offset, end: n.end - offset };
    if (reason) e.reason = reason;
    untranslated.push(e);
  };
  const atomRef = (atom) => {
    if (!used.has(atom)) used.set(atom, names.has(atom) ? `${atom}Atom` : atom);
    converted++;
    return t.identifier(used.get(atom));
  };
  const call = (atom, args) => {
    const c = t.callExpression(atomRef(atom), args);
    c._atom = true;
    return c;
  };
  const thunk = (expr, async = false) => {
    const a = t.arrowFunctionExpression([], expr);
    a.async = async;
    return a;
  };
  const undef = () => t.identifier('undefined');

  // -------------------------------------------------------------------------
  // expressions

  function tryPatterns(node, ctx, keyNode = node) {
    let key = shapeKey(keyNode);
    let list = byKey.get(key) || [];
    if (keyNode.type === 'OptionalMemberExpression' && !keyNode.computed) list = list.concat(byKey.get('OptionalMemberExpression [computed]') || []);
    if (!list.length) return null;
    let level = null;
    let mutates = false;
    const hits = [];
    for (const p of list) {
      if (level !== null && p.size < level) break;
      const mt = makeMatcher(p.placeholders, bound, p.vars);
      if (!mt.match(p.pattern, keyNode)) continue;
      // An atom that returns a changed copy where the built-in changes its receiver is not a
      // rewrite of that call. The one exception: a pattern literal without g/y has no state to change.
      if (p.copying) {
        const receiver = mt.bindings[p.placeholders[0]];
        if (!(receiver && receiver.type === 'RegExpLiteral' && !/[gy]/.test(receiver.flags))) { mutates = true; continue; }
      }
      // every missing argument must be an optional parameter of the atom
      const params = p.info.params;
      if (p.constant && p.info.minArity !== 0) continue;
      // a form whose placeholders are not the atom's parameters maps by position, so it must fit
      if (params && !p.placeholders.every((nm) => params.some((q) => q.name === nm)) && !params.some((q) => q.rest) && p.placeholders.length > params.length) continue;
      if (mt.missing.size) {
        if (!params) continue;
        const ok = [...mt.missing].every((nm) => { const q = params.find((x) => x.name === nm); return q && q.optional; });
        if (!ok) continue;
      }
      level = p.size;
      hits.push({ p, b: mt.bindings, missing: mt.missing, rest: mt.rest });
    }
    if (!hits.length) return mutates ? { mutates: true } : null;
    // pick by the kind of the first bound value
    const firstArg = (h) => {
      const params = h.p.info.params;
      const first = params && params.length && h.b[params[0].name] ? h.b[params[0].name] : h.b[h.p.placeholders[0]];
      return first;
    };
    let chosen = null;
    const verdicts = hits.map((h) => ({ h, v: kindsCompatible(h.p.info.firstKinds, hintOf(firstArg(h))) }));
    const yes = verdicts.filter((x) => x.v === 'yes');
    const maybe = verdicts.filter((x) => x.v === 'maybe');
    if (yes.length === 1) chosen = yes[0].h;
    else if (yes.length > 1) chosen = yes[0].h; // same kind twice: catalog order (largest form first)
    else if (maybe.length === 1) chosen = maybe[0].h;
    else if (maybe.length > 1) {
      // `+` and friends with no type: a text literal on either side means text
      const vals = Object.values(maybe[0].h.b);
      const textSide = vals.some(looksText);
      const numSide = vals.length > 0 && vals.every(looksNumber);
      const want = textSide ? 'string' : numSide ? 'number' : null;
      const pick = want && maybe.find((x) => (x.h.p.info.firstKinds || []).includes(want));
      if (pick) chosen = pick.h;
      else return { ambiguous: true };
    } else {
      return { wrongKind: true };
    }
    return chosen;
  }

  function buildCall(hit, ctx) {
    const { p, b } = hit;
    const params = p.info.params;
    let order;
    if (params && p.placeholders.every((nm) => params.some((q) => q.name === nm))) {
      order = params.map((q) => q.name);
      // drop trailing unbound optional params; an unbound param before a bound one is undefined
      while (order.length && !Object.prototype.hasOwnProperty.call(b, order[order.length - 1])) order.pop();
    } else {
      order = p.placeholders.filter((nm) => Object.prototype.hasOwnProperty.call(b, nm));
    }
    // A `...rest` placeholder is passed on as it was written when the atom itself takes rest
    // parameters (hypot(a, b)), and as one list when the atom takes a list (largestOf([a, b])).
    const restParam = params && params.find((q) => q.rest);
    const spreadsOut = (nm) => hit.rest && hit.rest[nm] && restParam && (restParam.name === nm || !params.some((q) => q.name === nm));
    const args = [];
    for (const nm of order) {
      if (!Object.prototype.hasOwnProperty.call(b, nm)) args.push(undef());
      else if (spreadsOut(nm)) args.push(...hit.rest[nm].map((a) => rewriteAny(a, null, 'arguments', { ...ctx, callee: false, inChain: false })));
      else {
        const arg = rewriteExpr(b[nm], { ...ctx, used: true, lvalue: false, callee: false });
        args.push(p.lazy.has(nm) ? thunk(arg) : arg);
      }
    }
    return call(p.atom, args);
  }

  function isFresh(n) {
    if (!n) return false;
    if (n.type === 'ArrayExpression') return true;
    if (n._atom) return true;
    if ((n.type === 'CallExpression') && n.callee.type === 'MemberExpression' && !n.callee.computed && FRESH_METHODS.has(n.callee.property.name)) return true;
    return false;
  }

  function isBuiltinCall(n) {
    const c = n.callee;
    if (n.type === 'NewExpression') return c.type === 'Identifier' && NEW_BUILTINS.has(c.name) && !bound.has(c.name);
    if (c.type === 'Identifier') return GLOBAL_FUNCS.has(c.name) && !bound.has(c.name);
    if ((c.type === 'MemberExpression' || c.type === 'OptionalMemberExpression') && !c.computed && c.property.type === 'Identifier') {
      if (c.object.type === 'Identifier' && STATIC_OBJECTS.has(c.object.name)) return !bound.has(c.object.name);
      if (BUILTIN_METHODS.has(c.property.name)) {
        const h = hintOf(c.object);
        return h !== 'other' && h !== 'function' && h !== 'boolean' && h !== 'number';
      }
    }
    return false;
  }

  const RECORDED_TYPES = new Set(['BinaryExpression', 'LogicalExpression', 'UnaryExpression', 'UpdateExpression', 'ConditionalExpression']);

  function rewriteChildren(node, ctx) {
    for (const k of childKeys(node)) {
      const v = node[k];
      if (Array.isArray(v)) {
        node[k] = v.map((c, i) => (c && typeof c.type === 'string' ? rewriteAny(c, node, k, ctx, i, v.length) : c));
      } else if (v && typeof v.type === 'string') {
        node[k] = rewriteAny(v, node, k, ctx);
      }
    }
    return node;
  }

  // dispatch for any child node
  function rewriteAny(n, parent, key, ctx, index, count) {
    if (isFnNode(n)) return rewriteFunction(n, ctx);
    if (n.type === 'BlockStatement') {
      n.body = rewriteStatements(n.body, { ...ctx, fnBody: false });
      return n;
    }
    if (n.type === 'Program') { n.body = rewriteStatements(n.body, { ...ctx, fnBody: false }); return n; }
    if (n.type === 'SwitchCase') { n.consequent = rewriteStatements(n.consequent, { ...ctx, fnBody: false }); if (n.test) n.test = rewriteExpr(n.test, { ...ctx, used: true }); return n; }
    if (/Statement$|Declaration$/.test(n.type) && n.type !== 'ExpressionStatement') {
      const out = rewriteStatements([n], { ...ctx, fnBody: false });
      return out.length === 1 ? out[0] : t.blockStatement(out);
    }
    if (n.type === 'ExpressionStatement') {
      n.expression = rewriteExpr(n.expression, { ...ctx, used: false, lvalue: false, callee: false });
      return n;
    }
    if (n.type === 'ClassBody' || n.type === 'ClassProperty' || n.type === 'ClassPrivateProperty' || n.type === 'ObjectProperty' || n.type === 'VariableDeclarator' || n.type === 'CatchClause' || /^TS/.test(n.type) || /^JSX/.test(n.type) || n.type === 'TemplateElement' || n.type === 'SpreadElement' || /Pattern$/.test(n.type) || n.type === 'RestElement' || n.type === 'StaticBlock') {
      if (n.type === 'CatchClause') { n.body.body = rewriteStatements(n.body.body, { ...ctx, fnBody: false }); return n; }
      if (/^TS/.test(n.type) && !/^TS(AsExpression|NonNullExpression|SatisfiesExpression|TypeAssertion)$/.test(n.type)) return n;
      if (n.type === 'VariableDeclarator') { if (n.init) n.init = rewriteExpr(n.init, { ...ctx, used: true }); n.id = rewritePattern(n.id, ctx); return n; }
      if (n.type === 'ObjectProperty') {
        if (n.computed) n.key = rewriteExpr(n.key, { ...ctx, used: true });
        n.value = /Pattern$|^RestElement$/.test(n.value.type) ? rewritePattern(n.value, ctx) : rewriteExpr(n.value, { ...ctx, used: true });
        return n;
      }
      if (/Pattern$/.test(n.type) || n.type === 'RestElement') return rewritePattern(n, ctx);
      return rewriteChildren(n, ctx);
    }
    const used = !(parent && parent.type === 'SequenceExpression' && key === 'expressions' && index < count - 1);
    return rewriteExpr(n, { ...ctx, used, lvalue: false, callee: false });
  }

  function rewritePattern(n, ctx) {
    // defaults inside destructuring are expressions; the bound names are not
    if (n.type === 'AssignmentPattern') { n.right = rewriteExpr(n.right, { ...ctx, used: true }); n.left = rewritePattern(n.left, ctx); return n; }
    if (n.type === 'ObjectPattern') { n.properties.forEach((pr) => { if (pr.type === 'ObjectProperty') { if (pr.computed) pr.key = rewriteExpr(pr.key, { ...ctx, used: true }); pr.value = rewritePattern(pr.value, ctx); } else rewritePattern(pr, ctx); }); return n; }
    if (n.type === 'ArrayPattern') { n.elements = n.elements.map((e) => (e ? rewritePattern(e, ctx) : e)); return n; }
    if (n.type === 'RestElement') { n.argument = rewritePattern(n.argument, ctx); return n; }
    if (n.type === 'MemberExpression') return rewriteLvalue(n, ctx);
    return n;
  }

  // an assignment target: never itself rewritten, but its computed parts are
  function rewriteLvalue(n, ctx) {
    if (n.type === 'MemberExpression' || n.type === 'OptionalMemberExpression') {
      n.object = rewriteExpr(n.object, { ...ctx, used: true });
      if (n.computed) n.property = rewriteExpr(n.property, { ...ctx, used: true });
      return n;
    }
    if (/Pattern$/.test(n.type)) return rewritePattern(n, ctx);
    return n;
  }

  function rewriteExpr(n, ctx) {
    if (!n || typeof n.type !== 'string') return n;
    if (n._atom) { n.arguments = n.arguments.map((a) => rewriteAny(a, n, 'arguments', ctx)); return n; }
    if (isFnNode(n)) return rewriteFunction(n, ctx);
    if (/^JSX/.test(n.type)) return rewriteChildren(n, ctx);

    // compound assignment: x op= y -> x = atom(x, y)
    if (n.type === 'AssignmentExpression') {
      if (n.operator !== '=') {
        const simple = n.left.type === 'Identifier' || (n.left.type === 'MemberExpression' && !n.left.computed && isPureRef(n.left));
        const op = n.operator.slice(0, -1);
        if (simple) {
          const logical = op === '&&' || op === '||' || op === '??';
          if (!logical || n.left.type === 'Identifier') {
            const virtual = logical ? t.logicalExpression(op, t.cloneNode(n.left, true), n.right) : t.binaryExpression(op, t.cloneNode(n.left, true), n.right);
            virtual.start = n.start; virtual.end = n.end;
            if (virtual.left) { virtual.left.start = n.left.start; virtual.left.end = n.left.end; }
            const hit = tryPatterns(virtual, ctx);
            if (hit && hit.p) {
              const rhs = buildCall(hit, ctx);
              return t.assignmentExpression('=', n.left, rhs);
            }
          }
        }
        record(n, `AssignmentExpression ${n.operator}`);
      }
      n.left = rewriteLvalue(n.left, ctx);
      n.right = rewriteExpr(n.right, { ...ctx, used: true });
      return n;
    }
    if (n.type === 'UpdateExpression') {
      const hit = tryPatterns(n, ctx);
      if (!hit || !hit.p) record(n);
      n.argument = rewriteLvalue(n.argument, ctx);
      return n;
    }
    if (n.type === 'UnaryExpression' && n.operator === 'delete') {
      record(n, 'UnaryExpression delete', 'mutates');
      n.argument = rewriteLvalue(n.argument, ctx);
      return n;
    }
    // -1, +1: a literal, not an operation
    if (n.type === 'UnaryExpression' && (n.operator === '-' || n.operator === '+') && n.argument.type === 'NumericLiteral') return n;

    // mutating built-ins
    if (n.type === 'CallExpression' && n.callee.type === 'MemberExpression' && !n.callee.computed && n.callee.property.type === 'Identifier') {
      const name = n.callee.property.name;
      const h = hintOf(n.callee.object);
      const arrayish = h === 'list' || h === 'any' || h === 'unknown';
      if (arrayish && (COPY_OF[name] || NEVER_COPY.has(name))) {
        if (COPY_OF[name] && ctx.used && isFresh(n.callee.object)) {
          const virtual = t.callExpression(t.memberExpression(n.callee.object, t.identifier(COPY_OF[name])), n.arguments);
          virtual.start = n.start; virtual.end = n.end;
          const hit = tryPatterns(virtual, ctx);
          if (hit && hit.p) return buildCall(hit, ctx);
          record(n, `CallExpression .${name}()`, 'no copy-returning atom');
        } else {
          record(n, `CallExpression .${name}()`, 'mutates');
        }
        return rewriteChildren(n, ctx);
      }
    }

    // optional chains: only a whole chain head `a?.b` may become get(a, 'b')
    let chainPart = false;
    if ((n.type === 'OptionalMemberExpression' || n.type === 'OptionalCallExpression') && (!n.optional || ctx.callee || ctx.inChain)) chainPart = true;

    if (!ctx.lvalue && !ctx.callee && !chainPart) {
      const hit = tryPatterns(n, ctx);
      if (hit && hit.p) return buildCall(hit, ctx);
      if (hit && hit.ambiguous) record(n, null, 'ambiguous type');
      else if (hit && hit.mutates) record(n, null, 'mutates');
      else if (RECORDED_TYPES.has(n.type) || ((n.type === 'TemplateLiteral') && n.expressions.length)) record(n);
      else if ((n.type === 'CallExpression' || n.type === 'NewExpression' || n.type === 'OptionalCallExpression') && isBuiltinCall(n)) record(n);
      else if ((n.type === 'OptionalMemberExpression' || n.type === 'OptionalCallExpression') && n.optional) record(n);
      else if (n.type === 'MemberExpression' && !n.computed && n.property.name === 'length') {
        const h = hintOf(n.object);
        if (h === 'list' || h === 'string' || h === 'any' || h === 'unknown') record(n);
      }
    } else if (chainPart && n.optional) {
      record(n, null, 'inside an optional chain');
    }

    // children
    if (n.type === 'CallExpression' || n.type === 'OptionalCallExpression' || n.type === 'NewExpression') {
      const cal = n.callee;
      if (cal.type === 'MemberExpression' || cal.type === 'OptionalMemberExpression') {
        cal.object = rewriteExpr(cal.object, { ...ctx, used: true, callee: false, lvalue: false, inChain: cal.type === 'OptionalMemberExpression' && !cal.optional });
        if (cal.computed) cal.property = rewriteExpr(cal.property, { ...ctx, used: true, callee: false, inChain: false });
      } else {
        n.callee = rewriteExpr(cal, { ...ctx, used: true, callee: true, inChain: n.type === 'OptionalCallExpression' && !n.optional });
      }
      n.arguments = n.arguments.map((a) => rewriteAny(a, n, 'arguments', { ...ctx, callee: false, inChain: false }));
      return n;
    }
    if (n.type === 'MemberExpression' || n.type === 'OptionalMemberExpression') {
      n.object = rewriteExpr(n.object, { ...ctx, used: true, callee: false, lvalue: false, inChain: n.type === 'OptionalMemberExpression' && !n.optional });
      if (n.computed) n.property = rewriteExpr(n.property, { ...ctx, used: true, callee: false, lvalue: false, inChain: false });
      return n;
    }
    const sub = { ...ctx, callee: false, lvalue: false, inChain: false };
    return rewriteChildren(n, sub);
  }

  // -------------------------------------------------------------------------
  // functions and statements

  function rewriteFunction(fn, ctx) {
    const inner = { async: !!fn.async, generator: !!fn.generator, ctor: fn.kind === 'constructor', fnBody: true, used: true };
    fn.params = fn.params.map((p) => (p.type === 'TSParameterProperty' ? p : rewritePattern(p, inner)));
    if (fn.body.type === 'BlockStatement') fn.body.body = rewriteStatements(fn.body.body, inner);
    else fn.body = rewriteExpr(fn.body, { ...inner, used: true });
    return fn;
  }

  // a thunk whose body is `stmts`, already rewritten as a function body
  function blockThunk(stmts, { returning, async = false }) {
    const body = rewriteStatements(stmts, { async, generator: false, ctor: false, fnBody: true, used: true });
    if (body.length === 1 && body[0].type === 'ReturnStatement') return thunk(body[0].argument || undef(), async);
    if (body.length === 0) return thunk(undef(), async);
    if (!returning && body.length === 1 && body[0].type === 'ExpressionStatement' && !body[0]._terminal) return thunk(body[0].expression, async);
    return thunk(t.blockStatement(body), async);
  }

  // the branches of an if / else-if / else chain
  function chainOf(st) {
    const branches = [];
    let cur = st;
    while (cur && cur.type === 'IfStatement') {
      branches.push({ test: cur.test, body: stmtsOf(cur.consequent) });
      cur = cur.alternate;
    }
    return { branches, otherwise: cur ? stmtsOf(cur) : null };
  }

  function convertIf(st, rest, ctx) {
    if (!has('when')) return { why: 'no when atom' };
    const s = scan(st);
    if (s.brk || s.cont || s.yields || s.labels) return { why: 'break/continue/yield inside' };
    if (s.awaits) return { why: 'await inside a branch' };
    if (s.vars) return { why: 'var inside a branch' };
    const { branches, otherwise } = chainOf(st);
    const bodies = branches.map((b) => b.body).concat(otherwise ? [otherwise] : []);
    if (bodies.some((b) => b.some((x) => x.type === 'FunctionDeclaration'))) return { why: 'function declaration inside a branch' };
    const build = (bodyLists, returning) => {
      const thunks = bodyLists.map((b) => blockThunk(b, { returning }));
      const tests = branches.map((b) => b.test);
      if (branches.length === 1) {
        const args = [rewriteExpr(tests[0], { ...ctx, used: true }), thunks[0]];
        if (thunks.length > 1) args.push(thunks[1]);
        return call('when', args);
      }
      if (has('choose')) {
        const pairs = tests.map((tst, i) => t.arrayExpression([i === 0 ? rewriteExpr(tst, { ...ctx, used: true }) : thunk(rewriteExpr(tst, { ...ctx, used: true })), thunks[i]]));
        const args = [t.arrayExpression(pairs)];
        if (thunks.length > tests.length) args.push(thunks[tests.length]);
        return call('choose', args);
      }
      // nested when
      let tail = thunks.length > tests.length ? thunks[tests.length] : null;
      for (let i = tests.length - 1; i >= 0; i--) {
        const args = [rewriteExpr(tests[i], { ...ctx, used: true }), thunks[i]];
        if (tail) args.push(tail);
        const c = call('when', args);
        if (i === 0) return c;
        tail = thunk(c);
      }
      return null;
    };
    if (!s.ret) return { stmt: t.expressionStatement(build(bodies, false)) };
    if (!ctx.fnBody || ctx.generator || ctx.ctor) return { why: 'return inside an if that is not directly in a function body' };
    // every branch either always ends (return/throw) or has no return at all
    const lists = bodies.slice();
    if (!otherwise) lists.push([]); // the implicit else falls through
    const kinds = lists.map((b) => (terminal(t.blockStatement(b)) ? 'end' : scan(t.blockStatement(b)).ret ? 'mixed' : 'through'));
    if (kinds.includes('mixed')) return { why: 'a branch returns on some paths only' };
    const through = kinds.map((k, i) => (k === 'through' ? i : -1)).filter((i) => i >= 0);
    if (rest.length) {
      if (through.length === 0) return { why: 'unreachable statements after the if' };
      if (through.length > 1) return { why: 'the statements after the if would run from several branches' };
      if (hasHoisted(rest)) return { why: 'hoisted declaration after the if' };
      // the statements after the if move into a plain (non-async, non-generator) thunk
      const after = scan(t.blockStatement(rest));
      if (after.awaits || after.yields) return { why: 'await/yield after the if would move into a branch' };
      const i = through[0];
      lists[i] = lists[i].length ? [t.blockStatement(lists[i]), ...rest] : rest;
      if (lists[i][0] && lists[i][0].type === 'BlockStatement' && !lists[i][0].body.some((x) => x.type === 'VariableDeclaration' || x.type === 'ClassDeclaration' || x.type === 'FunctionDeclaration')) {
        lists[i] = [...lists[i][0].body, ...lists[i].slice(1)];
      }
    }
    // drop a trailing empty implicit else
    if (!otherwise && lists[lists.length - 1].length === 0) lists.pop();
    return { stmt: t.returnStatement(build(lists, true)), consumed: true };
  }

  function convertSwitch(st, rest, ctx) {
    if (!has('match')) return { why: 'no match atom' };
    const s = scan(st.cases.map((c) => t.blockStatement(c.consequent)).reduce((a, b) => t.blockStatement([a, b]), t.blockStatement([])));
    if (s.cont || s.yields || s.labels) return { why: 'continue/yield inside' };
    if (s.awaits) return { why: 'await inside a case' };
    if (s.vars) return { why: 'var inside a case' };
    const keys = new Set();
    for (const c of st.cases) {
      if (c.test && (c.test.type !== 'StringLiteral' || c.test.value === '__proto__' || keys.has(c.test.value))) return { why: 'a case that is not a distinct text literal' };
      if (c.test) keys.add(c.test.value);
    }
    // group empty cases onto the next body
    const groups = [];
    let pending = [];
    for (const c of st.cases) {
      pending.push(c);
      if (c.consequent.length) { groups.push({ cases: pending, body: c.consequent.slice() }); pending = []; }
    }
    if (pending.length) groups.push({ cases: pending, body: [] });
    let anyReturn = false;
    for (let gi = 0; gi < groups.length; gi++) {
      const g = groups[gi];
      let body = g.body;
      if (body.length === 1 && body[0].type === 'BlockStatement') body = body[0].body.slice().concat([]);
      let broke = false;
      if (body.length && body[body.length - 1].type === 'BreakStatement' && !body[body.length - 1].label) { body = body.slice(0, -1); broke = true; }
      else if (g.body.length && g.body[g.body.length - 1].type === 'BlockStatement') {
        const inner = g.body[g.body.length - 1].body;
        if (inner.length && inner[inner.length - 1].type === 'BreakStatement' && !inner[inner.length - 1].label) { body = g.body.slice(0, -1).concat(inner.slice(0, -1)); broke = true; }
      }
      const bs = scan(t.blockStatement(body));
      if (bs.brk) return { why: 'break in the middle of a case' };
      if (bs.ret) anyReturn = true;
      const end = terminal(t.blockStatement(body));
      if (!broke && !end && gi < groups.length - 1) return { why: 'a case falls through into the next' };
      if (bs.ret && !end) return { why: 'a case returns on some paths only' };
      g.stmts = body;
    }
    if (anyReturn && (!ctx.fnBody || ctx.generator || ctx.ctor)) return { why: 'return inside a switch that is not directly in a function body' };
    if (anyReturn && rest.length) return { why: 'statements after a switch that returns' };
    const props = [];
    let fallback = null;
    for (const g of groups) {
      const th = () => blockThunk(g.stmts, { returning: anyReturn });
      for (const c of g.cases) {
        if (!c.test) { fallback = th(); continue; }
        const k = t.isValidIdentifier(c.test.value) ? t.identifier(c.test.value) : t.stringLiteral(c.test.value);
        props.push(t.objectProperty(k, th()));
      }
    }
    const args = [rewriteExpr(st.discriminant, { ...ctx, used: true }), t.objectExpression(props), fallback || thunk(undef())];
    const c = call('match', args);
    return anyReturn ? { stmt: t.returnStatement(c), consumed: true } : { stmt: t.expressionStatement(c) };
  }

  function convertTry(st, rest, ctx) {
    const s = scan(st);
    if (s.brk || s.cont || s.yields || s.labels) return { why: 'break/continue/yield inside' };
    if (s.vars) return { why: 'var inside' };
    const async = s.awaits;
    const atom = async ? 'attemptAsync' : 'attempt';
    if (async && !ctx.async) return { why: 'await outside an async function' };
    if (!has(atom)) return { why: `no ${atom} atom` };
    if (st.finalizer && scan(st.finalizer).ret) return { why: 'return inside finally' };
    const ret = scan(st.block).ret || (st.handler && scan(st.handler.body).ret);
    if (ret && (!ctx.fnBody || ctx.generator || ctx.ctor)) return { why: 'return inside a try that is not directly in a function body' };
    if (ret && rest.length) return { why: 'statements after a try that returns' };
    if ([st.block, st.handler && st.handler.body, st.finalizer].some((b) => b && b.body.some((x) => x.type === 'FunctionDeclaration'))) return { why: 'function declaration inside' };
    const args = [blockThunk(st.block.body, { returning: ret, async })];
    if (st.handler) {
      const h = blockThunk(st.handler.body.body, { returning: ret, async });
      if (st.handler.param) h.params = [rewritePattern(st.handler.param, ctx)];
      args.push(h);
    } else {
      args.push(undef());
    }
    if (st.finalizer) args.push(blockThunk(st.finalizer.body, { returning: false, async }));
    let c = call(atom, args);
    if (async) c = t.awaitExpression(c);
    return ret ? { stmt: t.returnStatement(c), consumed: true } : { stmt: t.expressionStatement(c) };
  }

  function convertForOf(st, ctx) {
    if (!has('each')) return { why: 'no each atom' };
    if (st.await) return { why: 'for await' };
    const left = st.left;
    if (left.type !== 'VariableDeclaration' || left.kind === 'var' || left.declarations.length !== 1) return { why: 'loop variable is not a const/let declaration' };
    const s = scan(st.body);
    if (s.ret || s.brk || s.cont || s.awaits || s.yields || s.labels) return { why: 'return/break/continue/await inside the loop' };
    if (s.vars) return { why: 'var inside the loop' };
    const h = hintOf(st.right);
    if (!(h === 'list' || h === 'any' || h === 'unknown')) return { why: `loops over a ${h}, not a list` };
    const fn = blockThunk(stmtsOf(st.body), { returning: true });
    fn.params = [rewritePattern(left.declarations[0].id, ctx)];
    return { stmt: t.expressionStatement(call('each', [rewriteExpr(st.right, { ...ctx, used: true }), fn])) };
  }

  function rewriteStatements(stmts, ctx) {
    const out = [];
    for (let i = 0; i < stmts.length; i++) {
      const st = stmts[i];
      const rest = stmts.slice(i + 1);
      let res = null;
      if (st.type === 'IfStatement') res = convertIf(st, rest, ctx);
      else if (st.type === 'SwitchStatement') res = convertSwitch(st, rest, ctx);
      else if (st.type === 'TryStatement') res = convertTry(st, rest, ctx);
      else if (st.type === 'ForOfStatement') res = convertForOf(st, ctx);
      else if (st.type === 'ThrowStatement') {
        if (has('fail')) {
          const e = t.expressionStatement(call('fail', [rewriteExpr(st.argument, { ...ctx, used: true })]));
          e._terminal = true;
          res = { stmt: e };
        } else res = { why: 'no fail atom' };
      } else if (/^(While|DoWhile|For|ForIn)Statement$/.test(st.type)) {
        res = { why: 'no exact loop atom (repeatWhile needs a limit)' };
      } else if (st.type === 'LabeledStatement') {
        res = { why: 'labeled statement' };
      }
      if (res && res.stmt) {
        if (st.leadingComments) res.stmt.leadingComments = st.leadingComments;
        out.push(res.stmt);
        if (res.consumed) break;
        continue;
      }
      if (res && res.why) record(st, shapeKey(st), res.why);
      out.push(rewriteStatementInPlace(st, ctx));
    }
    return out;
  }

  // a statement kept as syntax: its parts are still rewritten
  function rewriteStatementInPlace(st, ctx) {
    const inner = { ...ctx, fnBody: false };
    switch (st.type) {
      case 'ExpressionStatement':
        st.expression = rewriteExpr(st.expression, { ...ctx, used: false, lvalue: false, callee: false });
        return st;
      case 'ReturnStatement':
      case 'ThrowStatement':
        if (st.argument) st.argument = rewriteExpr(st.argument, { ...ctx, used: true });
        return st;
      case 'VariableDeclaration':
        st.declarations.forEach((d) => { if (d.init) d.init = rewriteExpr(d.init, { ...ctx, used: true }); d.id = rewritePattern(d.id, ctx); });
        return st;
      case 'FunctionDeclaration':
        return rewriteFunction(st, ctx);
      case 'ClassDeclaration':
        return rewriteChildren(st, ctx);
      case 'BlockStatement':
        st.body = rewriteStatements(st.body, inner);
        return st;
      case 'IfStatement':
        st.test = rewriteExpr(st.test, { ...ctx, used: true });
        st.consequent = rewriteAny(st.consequent, st, 'consequent', inner);
        if (st.alternate) st.alternate = rewriteAny(st.alternate, st, 'alternate', inner);
        return st;
      case 'ForStatement':
      case 'WhileStatement':
      case 'DoWhileStatement':
      case 'ForInStatement':
      case 'ForOfStatement':
        if (st.type === 'ForStatement' || st.type === 'ForInStatement' || st.type === 'ForOfStatement') {
          if (st.left && st.left.type !== 'VariableDeclaration') st.left = rewriteLvalue(st.left, inner);
          else if (st.left) rewriteStatementInPlace(st.left, inner);
          if (st.right) st.right = rewriteExpr(st.right, { ...ctx, used: true });
        }
        if (st.init) st.init = st.init.type === 'VariableDeclaration' ? rewriteStatementInPlace(st.init, inner) : rewriteExpr(st.init, { ...ctx, used: false });
        if (st.test) st.test = rewriteExpr(st.test, { ...ctx, used: true });
        if (st.update) st.update = rewriteExpr(st.update, { ...ctx, used: false });
        st.body = rewriteAny(st.body, st, 'body', inner);
        return st;
      case 'TryStatement':
        st.block.body = rewriteStatements(st.block.body, inner);
        if (st.handler) st.handler.body.body = rewriteStatements(st.handler.body.body, inner);
        if (st.finalizer) st.finalizer.body = rewriteStatements(st.finalizer.body, inner);
        return st;
      case 'SwitchStatement':
        st.discriminant = rewriteExpr(st.discriminant, { ...ctx, used: true });
        st.cases.forEach((c) => { if (c.test) c.test = rewriteExpr(c.test, { ...ctx, used: true }); c.consequent = rewriteStatements(c.consequent, inner); });
        return st;
      case 'LabeledStatement':
        st.body = rewriteAny(st.body, st, 'body', inner);
        return st;
      case 'ExportNamedDeclaration':
      case 'ExportDefaultDeclaration':
        if (st.declaration) {
          const d = st.declaration;
          st.declaration = /Statement$|Declaration$/.test(d.type) ? rewriteStatementInPlace(d, ctx) : rewriteExpr(d, { ...ctx, used: true });
        }
        return st;
      default:
        if (/^TS|^Import|^Export|^Empty|^Debugger|^Break|^Continue/.test(st.type)) return st;
        return rewriteChildren(st, ctx);
    }
  }

  // -------------------------------------------------------------------------
  const top = { async: false, generator: false, ctor: false, fnBody: false, used: true };
  ast.program.body = rewriteStatements(ast.program.body, top);

  const imports = [...used.keys()].sort();
  const specs = imports.map((a) => (used.get(a) === a ? a : `${a} as ${used.get(a)}`));
  const importDecl = imports.length ? `import { ${specs.join(', ')} } from '${importFrom}';` : '';
  let body;
  if (kind === 'method') {
    const cls = ast.program.body[0];
    const m = cls && cls.body && cls.body.body[0];
    body = m ? generate(m, { comments: true }).code : '';
  } else {
    body = generate(ast, { comments: true }).code;
  }
  const out = importDecl ? `${importDecl}\n\n${body}` : body;
  untranslated.sort((a, b) => a.start - b.start || a.end - b.end);
  return { code: out, body, imports, importDecl, atoms: Object.fromEntries(used), untranslated, converted };
}

module.exports = { toAtoms, scan, terminal };
