// Behavioural check for atoms-transform.js: run a function and its converted
// form on the same generated inputs, isolated in QuickJS, and compare what they do.
//
//   const sandbox = await createSandbox({ bundle })       bundle = bundleRuntime(dir)
//   sandbox.checkPair({ original, converted, importDecl, kind, types, runs, seed, paramTypes })
//     -> { status: 'same' | 'different' | 'not-runnable', runs, compared, exercised, mismatches, why? }
//   checkCorpus({ runs })  -> { summary, functions: [...] }   (CLI: node bench/atoms/equivalence.js)
//
// What is compared, per run: how the call ends (the value returned, the value a
// promise settles to, or the class of what is thrown), what the arguments look
// like afterwards, and the ordered trace of every call made to the outside.
//
// "The outside" is every name the function uses but does not define (imports,
// module constants, `this`) and every value whose type is not known. Each is a
// recording stub: reading a property gives another stub or a fixed primitive,
// calling it is written to the trace and returns a value fixed by the seed.
// Both versions get equal stubs, so any difference in outcome or trace is a
// difference in behaviour. Arguments with a known TypeScript type (primitives,
// arrays, object shapes, unions, aliases and interfaces of the same file) are
// generated as real values. The clock and Math.random are seeded.
//
// A run where either side hits the time limit is not compared. `exercised`
// counts the runs where the original returned instead of throwing: it says how
// much of the evidence is more than "both failed the same way".
const fs = require('fs');
const path = require('path');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const ts = require('typescript');
const { toAtoms } = require('../../atoms-transform');
const { snapshotRuntime, catalogFor, bundleRuntime } = require('./runtime');

const TS_PLUGINS = ['typescript', 'jsx'];
const STEP_MS = 400;

// ---------------------------------------------------------------------------
// TypeScript types -> value descriptors the sandbox can generate from

// generic: keep generic aliases too (their parameters stay unknown), as the runtime's own
// Lazy<T> or Visit<T, R>, which are function types whatever T is
function typesOfSource(src, { generic = false } = {}) {
  const env = new Map();
  let ast;
  try {
    ast = parser.parse(src, { sourceType: 'module', plugins: TS_PLUGINS, errorRecovery: true });
  } catch {
    return env;
  }
  for (const st of ast.program.body) {
    const d = st.type === 'ExportNamedDeclaration' && st.declaration ? st.declaration : st;
    if (d.type === 'TSTypeAliasDeclaration' && (generic || !d.typeParameters)) env.set(d.id.name, d.typeAnnotation);
    if (d.type === 'TSInterfaceDeclaration' && (generic || !d.typeParameters)) env.set(d.id.name, d.body);
  }
  return env;
}

const UNKNOWN = { k: 'unknown' };

function describeType(node, env, depth = 0) {
  if (!node || depth > 5) return UNKNOWN;
  const sub = (n) => describeType(n, env, depth + 1);
  const fields = (members) => ({
    k: 'object',
    fields: members
      .filter((m) => (m.type === 'TSPropertySignature' || m.type === 'TSMethodSignature') && !m.computed && (m.key.type === 'Identifier' || m.key.type === 'StringLiteral'))
      .map((m) => ({
        name: m.key.type === 'Identifier' ? m.key.name : m.key.value,
        optional: !!m.optional,
        d: m.type === 'TSMethodSignature' ? { k: 'fn' } : sub(m.typeAnnotation && m.typeAnnotation.typeAnnotation),
      })),
  });
  switch (node.type) {
    case 'TSStringKeyword': return { k: 'string' };
    case 'TSNumberKeyword': return { k: 'number' };
    case 'TSBooleanKeyword': return { k: 'boolean' };
    case 'TSNullKeyword': return { k: 'lit', v: null };
    case 'TSUndefinedKeyword':
    case 'TSVoidKeyword': return { k: 'undefined' };
    case 'TSLiteralType': {
      const l = node.literal;
      if (l.type === 'StringLiteral' || l.type === 'NumericLiteral' || l.type === 'BooleanLiteral') return { k: 'lit', v: l.value };
      if (l.type === 'UnaryExpression' && l.operator === '-' && l.argument.type === 'NumericLiteral') return { k: 'lit', v: -l.argument.value };
      return l.type === 'TemplateLiteral' ? { k: 'string' } : UNKNOWN;
    }
    case 'TSArrayType': return { k: 'array', of: sub(node.elementType) };
    case 'TSTupleType': return { k: 'tuple', of: node.elementTypes.map((e) => sub(e.type === 'TSNamedTupleMember' ? e.elementType : e)) };
    case 'TSTypeOperator': return node.operator === 'readonly' ? sub(node.typeAnnotation) : UNKNOWN;
    case 'TSParenthesizedType': return sub(node.typeAnnotation);
    case 'TSUnionType': return { k: 'union', of: node.types.map(sub) };
    case 'TSIntersectionType': {
      const parts = node.types.map(sub);
      return parts.every((p) => p.k === 'object') ? { k: 'object', fields: parts.flatMap((p) => p.fields) } : parts[0];
    }
    case 'TSTypeLiteral': return fields(node.members);
    case 'TSInterfaceBody': return fields(node.body);
    case 'TSFunctionType': return { k: 'fn' };
    case 'TSTypeReference': {
      const name = node.typeName.type === 'Identifier' ? node.typeName.name : null;
      const args = (node.typeArguments || node.typeParameters || {}).params || [];
      if (name === 'Array' || name === 'ReadonlyArray') return { k: 'array', of: sub(args[0]) };
      if (name === 'Record') return { k: 'record', of: sub(args[1]) };
      if (name === 'Set' || name === 'ReadonlySet') return { k: 'set', of: sub(args[0]) };
      if (name === 'Map' || name === 'ReadonlyMap') return { k: 'map', key: sub(args[0]), of: sub(args[1]) };
      if (name === 'Date') return { k: 'date' };
      if (name === 'RegExp') return { k: 'regexp' };
      if (name === 'Readonly' || name === 'Required' || name === 'NonNullable') return sub(args[0]);
      if (name === 'Partial') {
        const inner = sub(args[0]);
        return inner.k === 'object' ? { k: 'object', fields: inner.fields.map((f) => ({ ...f, optional: true })) } : inner;
      }
      return name && env.has(name) ? sub(env.get(name)) : UNKNOWN;
    }
    default: return UNKNOWN;
  }
}

function describeParam(p, env) {
  let node = p.type === 'TSParameterProperty' ? p.parameter : p;
  let optional = false;
  let rest = false;
  if (node.type === 'AssignmentPattern') { optional = true; node = node.left; }
  if (node.type === 'RestElement') { rest = true; node = node.argument; }
  if (node.optional) optional = true;
  const ann = (p.type === 'RestElement' ? p : node).typeAnnotation;
  let d = ann ? describeType(ann.typeAnnotation, env) : UNKNOWN;
  if (!ann && node.type === 'ObjectPattern') {
    d = { k: 'object', fields: node.properties.filter((x) => x.type === 'ObjectProperty' && x.key.type === 'Identifier').map((x) => ({ name: x.key.name, optional: x.value.type === 'AssignmentPattern', d: UNKNOWN })) };
  }
  if (rest) return { rest: true, d: d.k === 'array' ? d : { k: 'array', of: UNKNOWN } };
  return { rest: false, d: optional ? { k: 'union', of: [d, d, { k: 'undefined' }] } : d };
}

// ---------------------------------------------------------------------------
// one side of a pair -> a script expression evaluating to a factory:
// (free names...) => the function under test

const wrap = (code, kind) => (kind === 'method' ? `const __w = {\n${code}\n};` : `const __f = ${code.trim().replace(/;$/, '')};`);

function atomBindings(importDecl) {
  const m = /\{([^}]*)\}/.exec(importDecl || '');
  if (!m) return [];
  return m[1].split(',').map((s) => s.trim()).filter(Boolean).map((s) => {
    const [atom, local] = s.split(/\s+as\s+/);
    return { atom, local: local || atom };
  });
}

function prepareSide(code, kind, importDecl) {
  const js = ts.transpileModule(wrap(code, kind), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.Preserve },
  }).outputText;
  const ast = parser.parse(js, { sourceType: 'script', plugins: ['jsx'] });
  let globals = [];
  traverse(ast, { Program(p) { globals = Object.keys(p.scope.globals); p.stop(); } });
  const atoms = atomBindings(importDecl);
  const locals = new Set(atoms.map((a) => a.local));
  const decl = ast.program.body[0].declarations[0].init;
  let member = null;
  if (kind === 'method') {
    const m = decl.properties[0];
    if (!m || m.type !== 'ObjectMethod' || m.kind !== 'method' || m.computed) return { skip: 'not a plain method' };
    member = m.key.type === 'Identifier' ? m.key.name : String(m.key.value);
  }
  const fn = kind === 'method' ? decl.properties[0] : decl;
  const bind = atoms.length ? `const { ${atoms.map((a) => (a.atom === a.local ? a.atom : `${a.atom}: ${a.local}`)).join(', ')} } = __atoms;\n` : '';
  const tail = kind === 'method' ? `return __w[${JSON.stringify(member)}];` : 'return __f;';
  return {
    free: globals.filter((g) => !locals.has(g)).sort(),
    body: `${bind}${js}\n${tail}`,
    async: !!fn.async,
    generator: !!fn.generator,
  };
}

function paramsOf(code, kind, env) {
  const ast = parser.parse(wrap(code, kind), { sourceType: 'module', plugins: TS_PLUGINS });
  const init = ast.program.body[0].declarations[0].init;
  const fn = kind === 'method' ? init.properties[0] : init;
  return (fn.params || []).map((p) => describeParam(p, env));
}

// ---------------------------------------------------------------------------
// the sandbox side: generators, stubs, serialisation, one step per (run, side)

const HARNESS = String.raw`
globalThis.__h = (function () {
  var RealDate = Date, realRandom = Math.random;
  var stubs = new WeakMap();
  function hash(s, seed) {
    var h = (2166136261 ^ seed) >>> 0;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995) >>> 0; h ^= h >>> 15;
    return h >>> 0;
  }
  function rngOf(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  // edges a text atom can get wrong: spaces on one side or both, tabs and line breaks,
  // mixed case, letters outside ASCII, separators, a number written as text
  var STRINGS = ['', 'a', 'hello world', 'Zed', '42', ' x ', 'cart', 'id-7',
    '  padded\t', '\tlead', 'trail ', 'MiXeD Case', 'Ünïcode', 'a,b;c', 'two\nlines', '-3.5'];
  var NUMBERS = [0, 1, -1, 2, 3.5, 10, 100, 7];
  var KEYS = ['id', 'name', 'value', 'a', 'b'];
  // made new each time: a g or y pattern carries lastIndex from one use to the next
  var PATTERNS = [['-', ''], ['a', 'g'], ['\\s+', ''], ['[aeiou]', 'gi'], ['^x', '']];

  function primitive(h) {
    switch (h % 5) {
      case 0: return STRINGS[(h >>> 3) % STRINGS.length];
      case 1: return NUMBERS[(h >>> 3) % NUMBERS.length];
      case 2: return (h >>> 3) % 2 === 0;
      case 3: return undefined;
      default: return null;
    }
  }

  // A recording stub: equal (path, seed) -> equal behaviour.
  function stub(path, ctx) {
    var memo = Object.create(null);
    var calls = 0;
    var deep = path.length > 160;
    var proxy = new Proxy(function () {}, {
      get: function (t, key) {
        if (key === Symbol.toPrimitive) return function (hint) { return hint === 'number' ? hash(path, ctx.seed) % 7 : '<' + path + '>'; };
        if (typeof key === 'symbol' || key === 'then' || key === 'prototype') return key === 'prototype' ? t.prototype : undefined;
        if (key in memo) return memo[key];
        var h = hash(path + '.' + key, ctx.seed);
        var v;
        if (key === 'length' || key === 'size') v = h % 3;
        else if (deep) v = primitive(h);
        else v = h % 3 === 0 ? primitive(h >>> 2) : stub(path + '.' + key, ctx);
        memo[key] = v;
        return v;
      },
      set: function (t, key, value) {
        if (typeof key !== 'symbol') { ctx.note('set ' + path + '.' + key + ' = ' + ser(value)); memo[key] = value; }
        return true;
      },
      has: function (t, key) { return typeof key === 'symbol' ? false : key in memo || hash(path + '?' + key, ctx.seed) % 2 === 0; },
      deleteProperty: function (t, key) { if (typeof key !== 'symbol') { ctx.note('delete ' + path + '.' + key); delete memo[key]; } return true; },
      apply: function (t, self, args) { return answer('call', args); },
      construct: function (t, args) { var r = answer('new', args); return r !== null && (typeof r === 'object' || typeof r === 'function') ? r : stub(path + '{}', ctx); },
    });
    function answer(how, args) {
      var n = calls++;
      ctx.note(how + ' ' + path + '(' + Array.prototype.map.call(args, function (a) { return ser(a); }).join(', ') + ')');
      var h = hash(path + '#' + n, ctx.seed);
      return deep || h % 2 === 0 ? primitive(h >>> 1) : stub(path + '()' + (n ? n : ''), ctx);
    }
    stubs.set(proxy, path);
    return proxy;
  }

  function gen(d, rng, ctx, path, depth) {
    var pick = function (xs) { return xs[Math.floor(rng() * xs.length)]; };
    var count = function () { return Math.floor(rng() * 4); };
    var i, n, out;
    switch (d.k) {
      case 'string': return pick(STRINGS);
      case 'number': return pick(NUMBERS);
      case 'boolean': return rng() < 0.5;
      case 'undefined': return undefined;
      case 'lit': return d.v;
      case 'date': return new RealDate(1700000000000 + Math.floor(rng() * 5) * 86400000);
      case 'regexp': { var pat = pick(PATTERNS); return new RegExp(pat[0], pat[1]); }
      case 'fn': return stub(path, ctx);
      case 'array': out = []; for (i = 0, n = count(); i < n; i++) out.push(gen(d.of, rng, ctx, path + '[' + i + ']', depth + 1)); return out;
      case 'tuple': return d.of.map(function (e, j) { return gen(e, rng, ctx, path + '[' + j + ']', depth + 1); });
      case 'set': out = new Set(); for (i = 0, n = count(); i < n; i++) out.add(gen(d.of, rng, ctx, path + '{' + i + '}', depth + 1)); return out;
      case 'map': out = new Map(); for (i = 0, n = count(); i < n; i++) out.set(gen(d.key, rng, ctx, path + '<' + i + '>', depth + 1), gen(d.of, rng, ctx, path + '{' + i + '}', depth + 1)); return out;
      case 'record': out = {}; for (i = 0, n = count(); i < n; i++) out[KEYS[i]] = gen(d.of, rng, ctx, path + '.' + KEYS[i], depth + 1); return out;
      case 'union': return gen(pick(d.of), rng, ctx, path, depth);
      case 'object':
        out = {};
        d.fields.forEach(function (f) { if (!(f.optional && rng() < 0.3)) out[f.name] = gen(f.d, rng, ctx, path + '.' + f.name, depth + 1); });
        return out;
      default: {
        var r = rng();
        if (depth > 2 || r < 0.45) return primitive(Math.floor(rng() * 1e9));
        if (r < 0.6) return gen({ k: 'array', of: { k: 'unknown' } }, rng, ctx, path, depth + 1);
        if (r < 0.75) return gen({ k: 'record', of: { k: 'unknown' } }, rng, ctx, path, depth + 1);
        return stub(path, ctx);
      }
    }
  }

  function ser(v, seen, depth) {
    seen = seen || []; depth = depth || 0;
    if (v === undefined) return 'undefined';
    if (v === null) return 'null';
    var t = typeof v;
    if (t === 'number') return Object.is(v, -0) ? '-0' : String(v);
    if (t === 'string') return JSON.stringify(v);
    if (t === 'boolean') return String(v);
    if (t === 'bigint') return v + 'n';
    if (t === 'symbol') return v.toString();
    if (stubs.has(v)) return '<' + stubs.get(v) + '>';
    if (t === 'function') return 'function ' + (v.name || '');
    if (seen.indexOf(v) >= 0) return '<cycle>';
    if (depth > 6) return '<deep>';
    seen = seen.concat([v]);
    var next = function (x) { return ser(x, seen, depth + 1); };
    try {
      if (Array.isArray(v)) return '[' + Array.prototype.map.call(v, next).join(', ') + ']';
      if (v instanceof RealDate) return 'Date(' + v.getTime() + ')';
      if (v instanceof Error) return v.constructor.name + '(' + JSON.stringify(v.message) + ')';
      if (v instanceof Promise) return 'Promise';
      if (v instanceof Map) return 'Map{' + Array.from(v).map(function (e) { return next(e[0]) + ' => ' + next(e[1]); }).join(', ') + '}';
      if (v instanceof Set) return 'Set{' + Array.from(v).map(next).join(', ') + '}';
      if (v instanceof RegExp) return String(v);
      var name = v.constructor && v.constructor !== Object ? v.constructor.name + ' ' : '';
      return name + '{' + Object.keys(v).map(function (k) { return k + ': ' + next(v[k]); }).join(', ') + '}';
    } catch (e) {
      return '<unreadable>';
    }
  }

  function thrown(e) {
    if (e instanceof Error) return { out: 'throws ' + e.constructor.name, detail: e.message };
    return { out: 'throws ' + ser(e) };
  }

  var sides = {}, spec = null, records = {}, cur = null;

  function kindOf(v) {
    if (stubs.has(v)) return null;
    if (Array.isArray(v)) return 'list';
    if (v instanceof Set) return 'set';
    if (v instanceof Map) return 'map';
    if (v instanceof RealDate) return 'date';
    var t = typeof v;
    return t === 'string' || t === 'number' || t === 'bigint' || t === 'boolean' || t === 'function' ? t : 'other';
  }
  function fits(kinds, kind) {
    return kinds.indexOf('any') >= 0 || kinds.indexOf(kind) >= 0
      || (kinds.indexOf('text-or-list') >= 0 && (kind === 'string' || kind === 'list'))
      || (kinds.indexOf('collection') >= 0 && (kind === 'set' || kind === 'map'));
  }
  // The atoms the converted side calls, counted: how often each ran, and how often its
  // first argument was not a kind of value the atom is declared for.
  function counted(atoms) {
    var out = {};
    Object.keys(atoms).forEach(function (name) {
      var real = __smith[name], kinds = atoms[name];
      out[name] = function () {
        if (cur) {
          var c = cur.atoms[name] || (cur.atoms[name] = { calls: 0, wrongKind: 0, unknown: 0 });
          var kind = arguments.length ? kindOf(arguments[0]) : 'other';
          c.calls++;
          if (kind === null) c.unknown++; else if (!fits(kinds, kind)) c.wrongKind++;
        }
        return real.apply(this, arguments);
      };
    });
    return out;
  }

  function step(side, run) {
    var seed = (spec.seed + run * 7919) >>> 0;
    var trace = [];
    var ctx = { seed: seed, note: function (line) { if (trace.length < 300) trace.push(line); } };
    var rng = rngOf(seed);
    var tick = 1700000000000;
    function FakeDate() {
      if (!new.target) return new RealDate(FakeDate.now()).toString();
      return arguments.length ? Reflect.construct(RealDate, arguments, new.target) : Reflect.construct(RealDate, [FakeDate.now()], new.target);
    }
    FakeDate.prototype = RealDate.prototype;
    FakeDate.now = function () { tick += 1000; return tick; };
    FakeDate.parse = RealDate.parse; FakeDate.UTC = RealDate.UTC;
    globalThis.Date = FakeDate;
    var rnd = rngOf(seed ^ 0x9e3779b9);
    Math.random = function () { return rnd(); };

    var rec = { out: 'pending', trace: trace, args: '', atoms: {} };
    records[side + ':' + run] = rec;
    cur = rec;
    var args = [];
    spec.params.forEach(function (p, i) {
      var v = gen(p.d, rng, ctx, 'arg' + i, 0);
      if (p.rest) args.push.apply(args, v); else args.push(v);
    });
    rec.input = ser(args);
    var free = sides[side].free.map(function (name) { return stub(name, ctx); });
    var self = spec.method ? stub('this', ctx) : undefined;
    var settle = function (how) { return function (v) { rec.out = how + ' ' + ser(v); rec.args = ser(args); }; };
    try {
      var fn = sides[side].factory.apply(undefined, free);
      var r = fn.apply(self, args);
      if (r instanceof Promise) {
        r.then(settle('resolves'), function (e) { var x = thrown(e); rec.out = 'rejects ' + x.out.slice(7); rec.detail = x.detail; rec.args = ser(args); });
      } else {
        rec.out = 'returns ' + ser(r);
      }
    } catch (e) {
      var x = thrown(e);
      rec.out = x.out; rec.detail = x.detail;
    }
    rec.args = ser(args);
    return rec.out;
  }

  return {
    define: function (s, factories) { spec = s; sides = factories; records = {}; globalThis.__atoms = counted(s.atoms || {}); },
    step: step,
    timedOut: function (side, run) { (records[side + ':' + run] = records[side + ':' + run] || { trace: [], args: '' }).out = 'timeout'; },
    report: function () {
      var mismatches = [], compared = 0, exercised = 0, timeouts = 0, atoms = {};
      for (var run = 0; run < spec.runs; run++) {
        var a = records['original:' + run], b = records['converted:' + run];
        if (!a || !b || a.out === 'timeout' || b.out === 'timeout') { timeouts++; continue; }
        compared++;
        Object.keys(b.atoms).forEach(function (name) {
          var sum = atoms[name] || (atoms[name] = { calls: 0, wrongKind: 0, unknown: 0 });
          sum.calls += b.atoms[name].calls; sum.wrongKind += b.atoms[name].wrongKind; sum.unknown += b.atoms[name].unknown;
        });
        if (/^(returns|resolves)/.test(a.out)) exercised++;
        var ta = a.trace.join('\n'), tb = b.trace.join('\n');
        if (a.out !== b.out || a.args !== b.args || ta !== tb) {
          var at = 0;
          while (at < a.trace.length && a.trace[at] === b.trace[at]) at++;
          mismatches.push({
            run: run,
            differs: a.out !== b.out ? 'outcome' : a.args !== b.args ? 'arguments afterwards' : 'trace',
            input: a.input,
            original: { out: a.out, detail: a.detail, args: a.args, traceAt: a.trace[at] },
            converted: { out: b.out, detail: b.detail, args: b.args, traceAt: b.trace[at] },
          });
        }
      }
      return JSON.stringify({ compared: compared, exercised: exercised, timeouts: timeouts, mismatchCount: mismatches.length, mismatches: mismatches.slice(0, 3), atomCalls: atoms });
    },
    known: function (names) { return JSON.stringify(names.filter(function (n) { return n in globalThis; })); },
  };
})();
`;

// ---------------------------------------------------------------------------

async function createSandbox({ bundle }) {
  const { getQuickJS } = require('quickjs-emscripten');
  const QuickJS = await getQuickJS();
  const runtime = QuickJS.newRuntime();
  runtime.setMemoryLimit(256 * 1024 * 1024);
  runtime.setMaxStackSize(1024 * 1024);
  let deadline = Infinity;
  runtime.setInterruptHandler(() => Date.now() > deadline);

  function evaluate(vm, src, ms = STEP_MS) {
    deadline = Date.now() + ms;
    const r = vm.evalCode(src);
    if (r.error) {
      const e = vm.dump(r.error);
      r.error.dispose();
      deadline = Infinity;
      return { error: e };
    }
    const value = vm.dump(r.value);
    r.value.dispose();
    const jobs = runtime.executePendingJobs();
    if (jobs.error) { const e = vm.dump(jobs.error); jobs.error.dispose(); deadline = Infinity; return { value, error: e }; }
    deadline = Infinity;
    return { value };
  }

  // atomKinds: {atom: [kinds its first parameter takes]} for the atoms the converted side imports
  // paramTypes: [descriptor | null] per parameter (bench/atoms/checker-types.js), used where a
  //   parameter has no type of its own
  function checkPair({ original, converted, importDecl = '', kind = 'function', types = new Map(), runs = 25, seed = 1, atomKinds = {}, paramTypes = null }) {
    let a;
    let b;
    let params;
    try {
      a = prepareSide(original, kind, '');
      b = prepareSide(converted, kind, importDecl);
      params = paramsOf(original, kind, types);
      if (paramTypes) params = params.map((p, i) => (!p.rest && p.d.k === 'unknown' && paramTypes[i] ? { ...p, d: paramTypes[i] } : p));
    } catch (e) {
      return { status: 'not-runnable', why: `cannot prepare: ${e.message.split('\n')[0]}` };
    }
    if (a.skip || b.skip) return { status: 'not-runnable', why: a.skip || b.skip };
    if (a.generator) return { status: 'not-runnable', why: 'generator' };

    const vm = runtime.newContext();
    try {
      let r = evaluate(vm, `${bundle}\n${HARNESS}\n0`, 5000);
      if (r.error) return { status: 'not-runnable', why: `harness: ${r.error.message}` };
      // names the sandbox defines (Object, Math, JSON ...) are real; the rest are stubs
      const known = new Set(JSON.parse(evaluate(vm, `__h.known(${JSON.stringify([...new Set([...a.free, ...b.free])])})`).value));
      const side = (s) => {
        const free = s.free.filter((n) => !known.has(n));
        return `{ free: ${JSON.stringify(free)}, factory: function (${free.join(', ')}) {\n${s.body}\n} }`;
      };
      const atoms = Object.fromEntries(atomBindings(importDecl).map((x) => [x.atom, atomKinds[x.atom] || ['any']]));
      r = evaluate(vm, `__h.define(${JSON.stringify({ params, runs, seed, method: kind === 'method', atoms })}, { original: ${side(a)}, converted: ${side(b)} }); 0`);
      if (r.error) return { status: 'not-runnable', why: `cannot load: ${r.error.message}` };
      for (let run = 0; run < runs; run++) {
        for (const which of ['original', 'converted']) {
          r = evaluate(vm, `__h.step(${JSON.stringify(which)}, ${run})`);
          if (r.error) evaluate(vm, `__h.timedOut(${JSON.stringify(which)}, ${run}); 0`);
        }
      }
      r = evaluate(vm, '__h.report()');
      if (r.error) return { status: 'not-runnable', why: `report: ${r.error.message}` };
      const rep = JSON.parse(r.value);
      return { status: rep.mismatchCount ? 'different' : 'same', runs, ...rep };
    } finally {
      vm.dispose();
    }
  }

  return { checkPair, dispose: () => runtime.dispose() };
}

// ---------------------------------------------------------------------------

async function checkCorpus({ runs = 25, repo, ref, only = null } = {}) {
  const { loadCorpus } = require('../corpus');
  const snap = snapshotRuntime({ ...(repo ? { repo } : {}), ...(ref ? { ref } : {}) });
  const { compiled } = catalogFor(snap.dir, snap.sha);
  const sandbox = await createSandbox({ bundle: bundleRuntime(snap.dir) });
  const corpus = loadCorpus();
  const sources = new Map(corpus.sources.map((s) => [s.file, s.src]));
  const typeEnvs = new Map();
  const typesFor = (file) => {
    if (!typeEnvs.has(file)) typeEnvs.set(file, typesOfSource(sources.get(file) || ''));
    return typeEnvs.get(file);
  };
  const functions = [];
  const hash = (s) => [...s].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 7);
  try {
    for (const f of corpus.functions) {
      if (only && !only.test(f.name)) continue;
      const row = { name: f.name, kind: f.kind, file: path.relative(corpus.roots[0] ? path.dirname(corpus.roots[0]) : '', f.file) };
      if (f.jsx) { functions.push({ ...row, status: 'skipped', why: 'JSX' }); continue; }
      let out;
      try {
        out = toAtoms(f.code, { catalog: compiled, kind: f.kind });
      } catch (e) {
        functions.push({ ...row, status: 'not-runnable', why: `transform threw: ${e.message}` });
        continue;
      }
      if (!out.converted) { functions.push({ ...row, status: 'skipped', why: 'nothing converted' }); continue; }
      const res = sandbox.checkPair({ original: f.code, converted: out.body, importDecl: out.importDecl, kind: f.kind, types: typesFor(f.file), runs, seed: hash(f.name) });
      functions.push({ ...row, conversions: out.converted, atoms: Object.keys(out.atoms).sort(), ...res });
    }
  } finally {
    sandbox.dispose();
  }
  const count = (status) => functions.filter((x) => x.status === status).length;
  const checked = functions.filter((x) => x.status === 'same' || x.status === 'different');
  const sum = (key) => checked.reduce((n, x) => n + (x[key] || 0), 0);
  const summary = {
    runtime: snap.sha.slice(0, 7),
    functions: functions.length,
    checked: checked.length,
    same: count('same'),
    different: count('different'),
    skipped: count('skipped'),
    notRunnable: count('not-runnable'),
    runsPerFunction: runs,
    runsCompared: sum('compared'),
    runsExercised: sum('exercised'),
    runsTimedOut: sum('timeouts'),
    conversionsChecked: sum('conversions'),
  };
  return { summary, functions };
}

if (require.main === module) {
  const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : fallback; };
  const only = arg('--only', null);
  checkCorpus({ runs: Number(arg('--runs', 25)), only: only ? new RegExp(only) : null }).then((res) => {
    const outFile = arg('--out', path.join(__dirname, '..', 'results', 'atoms-equivalence.json'));
    if (!only) fs.writeFileSync(outFile, `${JSON.stringify(res, null, 1)}\n`);
    console.log(JSON.stringify(res.summary, null, 1));
    for (const f of res.functions.filter((x) => x.status === 'different')) {
      const m = f.mismatches[0];
      console.log(`\nDIFFERENT ${f.name} (${f.file}) ${f.mismatchCount}/${f.compared} runs, ${m.differs}`);
      console.log(`  input      ${m.input.slice(0, 200)}`);
      console.log(`  original   ${m.original.out.slice(0, 160)}${m.original.detail ? ` -- ${m.original.detail}` : ''}${m.differs === 'trace' ? `  trace: ${m.original.traceAt}` : ''}`);
      console.log(`  converted  ${m.converted.out.slice(0, 160)}${m.converted.detail ? ` -- ${m.converted.detail}` : ''}${m.differs === 'trace' ? `  trace: ${m.converted.traceAt}` : ''}`);
    }
    const why = {};
    for (const f of res.functions.filter((x) => x.status === 'not-runnable')) why[f.why] = (why[f.why] || 0) + 1;
    if (Object.keys(why).length) console.log('\nnot runnable:', why);
    process.exitCode = res.summary.different ? 1 : 0;
  });
}

module.exports = { createSandbox, checkCorpus, describeType, typesOfSource, prepareSide, atomBindings };
