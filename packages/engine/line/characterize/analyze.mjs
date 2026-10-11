// iv2-tests -- the static half of the characterizer: read a route closure with the TypeScript checker and say what can be
// driven from a test and with what. No execution, no writes, no LLM.
//
//   subjects   every exported function of the closure: pure functions (called with inputs), hooks (renderHook) and React
//              components (rendered with props), each with the SHAPE of what it takes (from its declared types)
//   shapes     a small JSON vocabulary for those types (string, number, literal, union, object with optional props, array,
//              Set, Map, Date, function, React node ...) that the jest-side runtime samples and mutates
//   pools      literals mined from the closure: every string and number, plus "keyed" pools that link a literal to the
//              property or variable it is compared with (`p.kind === 'x'`, `switch (p.kind)`, `VALID.has(raw)`,
//              `MAP[p.kind]`, `name.includes('x')`), so a sampled input reaches the branch that tests for it
//   env        what the closure reads from outside and the test must control or watch: data hooks (`use*Query`,
//              `use*Mutation`) by module, the router (`next/navigation`), search-param and storage keys, effect objects to
//              spy on (toast, analytics), global host elements the app's layout mounts (a toast container) and the
//              app's own render helper (`renderWithProviders`) when it has one
import fs from 'node:fs';
import path from 'node:path';
import { ts } from '@construct/ast/lazy';

const DATA_HOOK = /^use(Lazy)?[A-Z]\w*(Query|Mutation)$/;
const ROUTER_MODULES = new Set(['next/navigation', 'next/router', 'react-router-dom', 'react-router']);
/** The react-spa routers; their mock is virtual, so an app's tests run whether or not jest can resolve them. */
export const REACT_ROUTER_MODULES = Object.freeze(['react-router-dom', 'react-router']);
const EFFECT_OBJECT = /toast|analytics|track|matomo|telemetry|logger|notif/i;
const STYLE_ATTRS = new Set(['className', 'class', 'style', 'd', 'viewBox', 'fill', 'stroke', 'xmlns', 'strokeLinecap', 'strokeLinejoin', 'strokeWidth', 'width', 'height', 'transform', 'clipPath', 'id', 'key', 'variant', 'size']);
const MAX_LIT = 120;

/**
 * A JSON description of a value's type, sampled by the jest-side runtime. `k` is the kind (str, num, bool, lit, null,
 * undef, any, union, arr, tuple, set, map, date, fn, node, dom, file, promise, obj, ref); the other fields depend on it
 * (`v` a literal, `of` members or element, `key`/`val` a map's, `props`/`idx` an object's, `id` a ref's table entry).
 * @typedef {{k: string} & Record<string, any>} Shape
 */

/**
 * @typedef {object} Subject One exported function the characterizer drives.
 * @property {string} id Stable slug, `<file stem>.<export>`.
 * @property {string} file App-relative file.
 * @property {string} exportName `default`, the export's name, or `object.method` for a function held in an exported object.
 * @property {'pure'|'hook'|'component'} kind How it is driven.
 * @property {Shape[]} params Parameter shapes (pure and hook).
 * @property {string[]} paramNames Parameter names (they key the literal pools).
 * @property {Shape|null} props The props shape (component).
 */

/**
 * @typedef {object} ClosureAnalysis
 * @property {Subject[]} subjects
 * @property {Record<string, Shape>} shapes The shape table `ref` shapes point into.
 * @property {{strings: string[], numbers: number[], byKey: Record<string, (string|number)[]>}} pools
 * @property {object} env Hook modules, router, spies, search and storage keys, hosts, render helper, pathname.
 */

/** The app's compiler options (its tsconfig), made safe for analysis. */
function compilerOptions(appRoot) {
  const cfgPath = ts.findConfigFile(appRoot, ts.sys.fileExists, 'tsconfig.json');
  if (!cfgPath) return { jsx: ts.JsxEmit.ReactJSX, allowJs: true, skipLibCheck: true, noEmit: true };
  const cfg = ts.readConfigFile(cfgPath, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(cfg.config ?? {}, ts.sys, path.dirname(cfgPath));
  return { ...parsed.options, noEmit: true, skipLibCheck: true, incremental: false, composite: false };
}

const posix = (p) => p.split(path.sep).join('/');

/** Shapes from types, with object types kept once in a table and referenced by id (types are often recursive). */
class ShapeTable {
  constructor(checker) {
    this.c = checker;
    this.table = {};
    this.ids = new Map();
    this.n = 0;
  }

  name(type) {
    const s = type.aliasSymbol ?? type.getSymbol?.();
    return s ? s.getName() : '';
  }

  fromLib(type) {
    const s = type.getSymbol?.() ?? type.aliasSymbol;
    const decl = s?.declarations?.[0];
    const file = decl?.getSourceFile?.().fileName ?? '';
    return { file, lib: /node_modules\/typescript\/lib\//.test(file), external: /node_modules\//.test(file) };
  }

  /**
   * @param {any} type A ts.Type.
   * @param {number} [depth]
   * @returns {Shape}
   */
  of(type, depth = 0) {
    const F = ts.TypeFlags;
    const f = type.flags;
    if (f & (F.Any | F.Unknown)) return { k: 'any' };
    if (f & F.StringLiteral) return { k: 'lit', v: type.value };
    if (f & F.NumberLiteral) return { k: 'lit', v: type.value };
    if (f & F.BooleanLiteral) return { k: 'lit', v: type.intrinsicName === 'true' };
    if (f & (F.String | F.TemplateLiteral | F.StringMapping)) return { k: 'str' };
    if (f & F.Number) return { k: 'num' };
    if (f & F.BigInt) return { k: 'num' };
    if (f & F.Boolean) return { k: 'bool' };
    if (f & F.Null) return { k: 'null' };
    if (f & (F.Undefined | F.Void)) return { k: 'undef' };
    if (f & F.Never) return { k: 'undef' };
    if (f & F.EnumLiteral && type.isUnion?.()) return { k: 'union', of: type.types.map((t) => this.of(t, depth)) };
    if (f & F.TypeParameter) {
      const base = this.c.getBaseConstraintOfType(type);
      return base && base !== type ? this.of(base, depth) : { k: 'any' };
    }
    const nm = this.name(type);
    if (/^(ReactNode|ReactElement|ReactPortal|ReactChild|Element|JSXElementConstructor)$/.test(nm) && this.fromLib(type).external) return { k: 'node' };
    if (type.isUnion?.()) {
      const parts = type.types;
      const lits = parts.filter((t) => t.flags & F.BooleanLiteral);
      const rest = parts.filter((t) => !(t.flags & F.BooleanLiteral));
      const of = rest.map((t) => this.of(t, depth));
      if (lits.length === 2) of.push({ k: 'bool' });
      else if (lits.length === 1) of.push(this.of(lits[0], depth));
      if (of.some((s) => s.k === 'node')) return { k: 'node' };
      return of.length === 1 ? of[0] : { k: 'union', of };
    }
    if (type.isIntersection?.()) {
      const objs = type.types.map((t) => this.of(t, depth));
      const props = [];
      for (const s of objs) {
        const o = s.k === 'ref' ? this.table[s.id] : s;
        if (o?.k === 'obj') for (const p of o.props) if (!props.some((q) => q.n === p.n)) props.push(p);
      }
      return props.length ? this.register(type, () => ({ k: 'obj', props })) : objs[0] ?? { k: 'any' };
    }
    if (this.c.isArrayType?.(type)) {
      const [el] = this.c.getTypeArguments(type);
      return { k: 'arr', of: el ? this.of(el, depth + 1) : { k: 'any' } };
    }
    if (this.c.isTupleType?.(type)) return { k: 'tuple', of: this.c.getTypeArguments(type).map((t) => this.of(t, depth + 1)) };
    if (f & F.Object) {
      const where = this.fromLib(type);
      const args = type.aliasTypeArguments ?? (type.objectFlags & ts.ObjectFlags.Reference ? this.c.getTypeArguments(type) : []);
      if (/^(Set|ReadonlySet)$/.test(nm)) return { k: 'set', of: args[0] ? this.of(args[0], depth + 1) : { k: 'any' } };
      if (/^(Map|ReadonlyMap)$/.test(nm)) return { k: 'map', key: args[0] ? this.of(args[0], depth + 1) : { k: 'str' }, val: args[1] ? this.of(args[1], depth + 1) : { k: 'any' } };
      if (nm === 'Date') return { k: 'date' };
      if (nm === 'Promise' || nm === 'PromiseLike') return { k: 'promise', of: args[0] ? this.of(args[0], depth + 1) : { k: 'any' } };
      if (nm === 'File' || nm === 'Blob') return { k: 'file' };
      if (/^(HTML\w*Element|Element|Node|SVG\w*Element|EventTarget)$/.test(nm)) return { k: 'dom' };
      if (type.getCallSignatures().length && !type.getProperties().length) return { k: 'fn' };
      if (type.getCallSignatures().length) return { k: 'fn' };
      if (where.lib || (where.external && !/^(Record|Partial|Required|Pick|Omit|Readonly)$/.test(nm) && type.getProperties().length > 25)) return { k: 'any' };
      if (depth > 12) return { k: 'any' };
      return this.register(type, () => {
        const props = [];
        for (const sym of this.c.getPropertiesOfType(type)) {
          const pt = this.c.getTypeOfSymbol(sym);
          props.push({ n: sym.getName(), s: this.of(pt, depth + 1), opt: Boolean(sym.flags & ts.SymbolFlags.Optional) });
        }
        const idx = this.c.getIndexInfosOfType(type).find((i) => i.keyType.flags & F.String);
        return { k: 'obj', props, ...(idx ? { idx: this.of(idx.type, depth + 1) } : {}) };
      });
    }
    return { k: 'any' };
  }

  register(type, build) {
    if (this.ids.has(type)) return { k: 'ref', id: this.ids.get(type) };
    const id = `t${this.n++}`;
    this.ids.set(type, id);
    this.table[id] = { k: 'any' };
    this.table[id] = build();
    return { k: 'ref', id };
  }
}

const unwrap = (n) => { let x = n; while (x && (ts.isParenthesizedExpression(x) || ts.isNonNullExpression(x) || ts.isAsExpression(x))) x = x.expression; return x; };

/** The text a literal-bearing expression is "about": the property or variable name it reads. */
let CHECKER = null;

/** The text of a `const NAME = 'text'` an identifier refers to (storage keys are often named constants). */
function constString(ident) {
  if (!CHECKER || !ident || !ts.isIdentifier(ident)) return null;
  const decl = CHECKER.getSymbolAtLocation(ident)?.valueDeclaration;
  return decl && ts.isVariableDeclaration(decl) && decl.initializer && ts.isStringLiteralLike(decl.initializer) ? decl.initializer.text : null;
}

function keyOf(node) {
  let n = node;
  while (n && (ts.isParenthesizedExpression(n) || ts.isNonNullExpression(n) || ts.isAsExpression(n) || ts.isTypeOfExpression?.(n))) n = n.expression;
  if (!n) return null;
  if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)) {
    const m = n.expression.name.text;
    const a0 = n.arguments[0];
    const name = a0 ? (ts.isStringLiteralLike(a0) ? a0.text : constString(a0)) : null;
    if ((m === 'get' || m === 'getItem' || m === 'getAll' || m === 'has') && name !== null) {
      const host = n.expression.expression.getText();
      if (/storage/i.test(host)) return `storage:${name}`;
      if (/search|params|query/i.test(host)) return `search:${name}`;
      return null;
    }
    if (/^(toLowerCase|toUpperCase|trim|toString|valueOf|toLocaleLowerCase)$/.test(m)) return keyOf(n.expression.expression);
    return null;
  }
  if (ts.isPropertyAccessExpression(n)) return n.name.text;
  if (ts.isElementAccessExpression(n) && n.argumentExpression && ts.isStringLiteralLike(n.argumentExpression)) return n.argumentExpression.text;
  if (ts.isIdentifier(n)) return n.text;
  return null;
}

const litValue = (n) => {
  if (!n) return undefined;
  if (ts.isStringLiteralLike(n)) return n.text;
  if (ts.isNumericLiteral(n)) return Number(n.text);
  if (ts.isPrefixUnaryExpression(n) && n.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(n.operand)) return -Number(n.operand.text);
  return undefined;
};

/** The literals a `const X = new Set([...])`, `const X = [...]` or `const X = {...}` holds (keys of an object). */
function constLiterals(checker, ident) {
  const sym = checker.getSymbolAtLocation(ident);
  const decl = sym?.valueDeclaration ?? sym?.declarations?.[0];
  if (!decl || !ts.isVariableDeclaration(decl) || !decl.initializer) return [];
  let init = decl.initializer;
  while (ts.isAsExpression(init) || ts.isSatisfiesExpression?.(init) || ts.isParenthesizedExpression(init)) init = init.expression;
  if (ts.isNewExpression(init) && init.arguments?.[0]) init = init.arguments[0];
  if (ts.isArrayLiteralExpression(init)) return init.elements.map(litValue).filter((v) => v !== undefined);
  if (ts.isObjectLiteralExpression(init)) {
    return init.properties.map((p) => (p.name && (ts.isIdentifier(p.name) || ts.isStringLiteralLike(p.name) || ts.isNumericLiteral(p.name)) ? (ts.isNumericLiteral(p.name) ? Number(p.name.text) : p.name.text) : undefined)).filter((v) => v !== undefined);
  }
  return [];
}

/** Statements of a source file walked once, collecting literal pools. */
function mineLiterals(sf, checker, pools) {
  const addKey = (key, v) => {
    if (key == null || v === undefined) return;
    if (!pools.byKey[key]) pools.byKey[key] = [];
    if (!pools.byKey[key].includes(v)) pools.byKey[key].push(v);
  };
  const aliases = new Map(); // variable name -> the search:/storage: keys it was read from
  const alias = (name, key) => { if (!aliases.has(name)) aliases.set(name, new Set()); aliases.get(name).add(key); };
  const visit = (node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return;
    if (ts.isJsxAttribute(node) && STYLE_ATTRS.has(node.name.getText())) return;
    if (ts.isStringLiteralLike(node) && !ts.isImportTypeNode?.(node.parent) && !ts.isLiteralTypeNode(node.parent) && !ts.isPropertyAssignment(node.parent) && node.text.length <= MAX_LIT) pools.strings.add(node.text);
    if (ts.isPropertyAssignment(node) && ts.isStringLiteralLike(node.initializer) && node.initializer.text.length <= MAX_LIT) pools.strings.add(node.initializer.text);
    if (ts.isNumericLiteral(node)) pools.numbers.add(Number(node.text));
    if (ts.isVariableDeclaration(node) && node.initializer && ts.isIdentifier(node.name)) {
      const k = keyOf(node.initializer);
      // `const t = section.title.toLowerCase()`: what `t` is compared with is what `title` should hold
      if (k && k !== node.name.text) alias(node.name.text, k);
      let found = null;
      const findGet = (n) => { if (found) return; const kk = ts.isCallExpression(n) ? keyOf(n) : null; if (kk && /^(search|storage):/.test(kk)) found = kk; else ts.forEachChild(n, findGet); };
      findGet(node.initializer);
      if (found) {
        alias(node.name.text, found);
        // every constant set/array/object the initializer reads feeds the key's pool (`(sp.get('k') ?? '').split(',').filter(v => VALID.has(v))`)
        const scan = (n) => { if (ts.isIdentifier(n)) for (const v of constLiterals(checker, n)) addKey(found, v); ts.forEachChild(n, scan); };
        scan(node.initializer);
      }
    }
    if (ts.isBinaryExpression(node)) {
      const op = node.operatorToken.kind;
      const K = ts.SyntaxKind;
      if ([K.EqualsEqualsEqualsToken, K.ExclamationEqualsEqualsToken, K.EqualsEqualsToken, K.ExclamationEqualsToken, K.LessThanToken, K.GreaterThanToken, K.LessThanEqualsToken, K.GreaterThanEqualsToken].includes(op)) {
        const l = litValue(node.left);
        const r = litValue(node.right);
        if (r !== undefined) { addKey(keyOf(node.left), r); if (typeof r === 'number') { addKey(keyOf(node.left), r + 1); addKey(keyOf(node.left), r - 1); } }
        if (l !== undefined) { addKey(keyOf(node.right), l); if (typeof l === 'number') { addKey(keyOf(node.right), l + 1); addKey(keyOf(node.right), l - 1); } }
      }
    }
    if (ts.isCallExpression(node) && /^(search|storage):/.test(keyOf(node) ?? '')) {
      // `(sp.get('k') ?? '').split(',').filter((v) => VALID.has(v))`: the constant sets the surrounding expression reads
      let box = node.parent;
      while (box && !ts.isPropertyAssignment(box) && !ts.isVariableDeclaration(box) && !ts.isStatement(box)) box = box.parent;
      if (box && !ts.isBlock(box)) {
        const k = keyOf(node);
        const scan = (n) => { if (ts.isIdentifier(n)) for (const v of constLiterals(checker, n)) addKey(k, v); ts.forEachChild(n, scan); };
        scan(box);
      }
    }
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const m = node.expression.name.text;
      const target = node.expression.expression;
      const a0 = node.arguments[0];
      if (/^(includes|startsWith|endsWith|indexOf)$/.test(m) && a0) {
        const v = litValue(a0);
        if (v !== undefined) addKey(keyOf(target), v);
        // [..literals].includes(x) / VALID.has(x)
        if (ts.isArrayLiteralExpression(target)) for (const e of target.elements) addKey(keyOf(a0), litValue(e));
        if (ts.isIdentifier(target)) for (const v2 of constLiterals(checker, target)) addKey(keyOf(a0), v2);
      }
      if (m === 'has' && a0 && ts.isIdentifier(target)) for (const v2 of constLiterals(checker, target)) addKey(keyOf(a0), v2);
      if (m === 'match' || m === 'test') {
        // a regex test: no literal to add, but keep the pattern's plain words as strings
        const reNode = /** @type {any} */ (a0 ?? target);
        const re = ts.isRegularExpressionLiteral(reNode) ? reNode.text : null;
        if (re) for (const w of re.replace(/\\[nstdwbWSD]/g, ' ').split(/[^A-Za-z0-9 ?&*:_-]+/).filter((x) => x.trim().length > 2)) pools.strings.add(w.replace(/\\/g, ''));
      }
    }
    if (ts.isSwitchStatement(node)) {
      const k = keyOf(node.expression);
      for (const c of node.caseBlock.clauses) if (ts.isCaseClause(c)) addKey(k, litValue(c.expression));
    }
    if (ts.isElementAccessExpression(node) && ts.isIdentifier(node.expression) && node.argumentExpression) {
      for (const v of constLiterals(checker, node.expression)) addKey(keyOf(node.argumentExpression), v);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  // a variable read from one key and tested in its own scope: `const raw = sp.get('tab'); return VALID_TABS.has(raw)`
  const scoped = (n) => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer) {
      const k = keyOf(n.initializer);
      const block = n.parent?.parent?.parent;
      if (k && /^(search|storage):/.test(k) && block) {
        const scan = (m) => {
          const arg = m.arguments?.[0] && unwrap(m.arguments[0]);
          if (ts.isCallExpression(m) && ts.isPropertyAccessExpression(m.expression) && /^(has|includes)$/.test(m.expression.name.text) && arg && ts.isIdentifier(arg) && arg.text === /** @type {any} */ (n.name).text && ts.isIdentifier(m.expression.expression)) for (const v of constLiterals(checker, m.expression.expression)) addKey(k, v);
          if (ts.isBinaryExpression(m) && ts.isIdentifier(unwrap(m.left)) && /** @type {any} */ (unwrap(m.left)).text === /** @type {any} */ (n.name).text) addKey(k, litValue(m.right));
          ts.forEachChild(m, scan);
        };
        scan(block);
      }
    }
    ts.forEachChild(n, scoped);
  };
  scoped(sf);
  // `const { status: recomputeStatus } = useX()`: what `recomputeStatus` is compared with is what `status` should hold
  const bindings = (n) => {
    if (ts.isBindingElement(n) && ts.isIdentifier(n.name)) {
      const prop = n.propertyName && (ts.isIdentifier(n.propertyName) || ts.isStringLiteralLike(n.propertyName)) ? n.propertyName.text : null;
      if (prop && prop !== n.name.text) alias(n.name.text, prop);
    }
    ts.forEachChild(n, bindings);
  };
  bindings(sf);
  // follow chains (`current` -> `recomputeStatus` -> `status`)
  for (let pass = 0; pass < 3; pass++) for (const [name, keys] of aliases) for (const key of keys) for (const v of pools.byKey[name] ?? []) addKey(key, v);
}

/**
 * RTK Query's naming convention, read back: `use<Endpoint>Query` is the hook of endpoint `<endpoint>`, whose response
 * type is the first type argument of its `build.query<Response, Args>(...)` call. Finds that call in the API module either
 * as `endpoints: (build) => ({ endpoint: build.query<...>() })` or next to an `endpoint: 'name'` property (a config
 * array), for APIs whose generated hook types are erased to `any`.
 */
function endpointResponseTypes(sf, checker) {
  const out = new Map();
  const visit = (n) => {
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && /^(query|mutation)$/.test(n.expression.name.text) && n.typeArguments?.length) {
      let name = null;
      for (let p = n.parent; p && !name; p = p.parent) {
        if (ts.isPropertyAssignment(p) && p.initializer === n) name = p.name.getText(sf);
        if (ts.isObjectLiteralExpression(p)) {
          const ep = p.properties.find((q) => ts.isPropertyAssignment(q) && q.name.getText(sf) === 'endpoint' && ts.isStringLiteralLike(q.initializer));
          if (ep) name = /** @type {any} */ (ep).initializer.text;
        }
      }
      if (name) out.set(name, checker.getTypeFromTypeNode(n.typeArguments[0]));
      // a config factory (`function makeConfig(base, endpoint) { ... endpoint, builder.query<T>() }`): its calls name the endpoints
      for (let p = n.parent; p; p = p.parent) if (ts.isFunctionDeclaration(p) && p.name) { factories.set(p.name.text, checker.getTypeFromTypeNode(n.typeArguments[0])); break; }
    }
    ts.forEachChild(n, visit);
  };
  const factories = new Map();
  visit(sf);
  const calls = (n) => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && factories.has(n.expression.text)) {
      for (const a of n.arguments) if (ts.isStringLiteralLike(a) && !out.has(a.text)) out.set(a.text, factories.get(n.expression.text));
    }
    ts.forEachChild(n, calls);
  };
  calls(sf);
  return out;
}

/** True when a function type returns JSX (a React component). */
function returnsJsx(checker, sig) {
  const rt = checker.getReturnTypeOfSignature(sig);
  const txt = checker.typeToString(rt);
  return /(JSX\.Element|ReactElement|ReactNode|Element\b|ReactPortal)/.test(txt);
}

/** The node's resolved module file (absolute), or the bare specifier for a package. */
function resolveSpecifier(spec, fromFile, options) {
  const r = ts.resolveModuleName(spec, fromFile, options, ts.sys).resolvedModule;
  if (!r || r.isExternalLibraryImport || /node_modules/.test(r.resolvedFileName)) return { bare: spec, file: r?.resolvedFileName ?? null };
  return { bare: null, file: path.resolve(r.resolvedFileName) };
}

/** The app-relative path of the first file under src/ (or the app root) exporting `renderWithProviders`. */
function findRenderHelper(appRoot) {
  const roots = ['src/libs', 'src/lib', 'src/test', 'src/tests', 'src/utils', 'test', 'tests', 'src'].map((d) => path.join(appRoot, d)).filter((d) => fs.existsSync(d));
  for (const dir of roots) {
    for (const name of fs.readdirSync(dir)) {
      if (!/^(test-utils|testUtils|test-utils\.tsx?|render)\.(t|j)sx?$/.test(name) && !/^test-utils\.(t|j)sx?$/.test(name)) continue;
      const file = path.join(dir, name);
      if (/export\s+function\s+renderWithProviders\b/.test(fs.readFileSync(file, 'utf8'))) return { file: posix(path.relative(appRoot, file)), exportName: 'renderWithProviders' };
    }
  }
  return null;
}

/**
 * Global host elements the app's root layout mounts from a package the closure also imports (a toast container, say), so
 * what the closure sends to them renders in the test too.
 */
function findHosts(appRoot, closurePackages) {
  const candidates = ['src/app/layout.tsx', 'app/layout.tsx', 'src/pages/_app.tsx', 'src/App.tsx', 'src/main.tsx'];
  const appDir = ['src/app', 'app'].map((d) => path.join(appRoot, d)).find((d) => fs.existsSync(d));
  if (appDir) for (const e of fs.readdirSync(appDir)) if (fs.existsSync(path.join(appDir, e, 'layout.tsx'))) candidates.push(posix(path.relative(appRoot, path.join(appDir, e, 'layout.tsx'))));
  const hosts = [];
  for (const rel of candidates) {
    const file = path.join(appRoot, rel);
    if (!fs.existsSync(file)) continue;
    const sf = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const imported = new Map();
    for (const st of sf.statements) {
      if (!ts.isImportDeclaration(st) || !st.importClause) continue;
      const spec = /** @type {any} */ (st.moduleSpecifier).text;
      if (spec.startsWith('.') || spec.startsWith('@/') || !closurePackages.has(spec)) continue;
      for (const el of st.importClause.namedBindings && ts.isNamedImports(st.importClause.namedBindings) ? st.importClause.namedBindings.elements : []) imported.set(el.name.text, { spec, exportName: (el.propertyName ?? el.name).text });
    }
    const visit = (n) => {
      if (ts.isJsxSelfClosingElement(n) && imported.has(n.tagName.getText(sf))) {
        const h = imported.get(n.tagName.getText(sf));
        if (!hosts.some((x) => x.spec === h.spec && x.exportName === h.exportName)) hosts.push(h);
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  return hosts;
}

/**
 * The URL path of a Next.js App Router page: `/opportunity` from `src/app/[locale]/(group)/opportunity/page.tsx`.
 * @param {string} appRoot Absolute app root.
 * @param {string} entry The page file (app-relative or absolute).
 * @returns {string}
 */
export function pathnameOfEntry(appRoot, entry) {
  const rel = posix(path.relative(appRoot, path.resolve(appRoot, entry)));
  const m = rel.match(/(?:^|\/)app\/(.*)\/page\.[jt]sx?$/);
  if (!m) return '/';
  const segs = m[1].split('/').filter((s) => !/^\(.*\)$/.test(s) && !/^\[locale\]$/.test(s) && !s.startsWith('@'));
  return `/${segs.join('/')}`;
}

/**
 * Read a route closure statically: its subjects, the shapes of their inputs, the literal pools and what the test must
 * mock or watch.
 *
 * @param {string} appRoot Absolute root of the target app.
 * @param {{files: string[], routes?: {route?: string, entry: string}[]}} closure App-relative (or absolute) closure files.
 * @returns {ClosureAnalysis}
 *
 * @example
 * analyzeClosure('/app', { files: ['src/utils/sum.ts'] }).subjects[0]; // => { id: 'sum.sum', kind: 'pure', ... }
 */
export function analyzeClosure(appRoot, closure) {
  const abs = closure.files.map((f) => path.resolve(appRoot, f));
  const options = compilerOptions(appRoot);
  const program = ts.createProgram(abs, options);
  const checker = program.getTypeChecker();
  CHECKER = checker;
  const shapes = new ShapeTable(checker);
  const pools = { strings: new Set(), numbers: new Set(), byKey: {} };
  const subjects = [];
  const hookModules = {}; // module id -> { file|null, bare|null, hooks: {name: {kind, data: Shape}} }
  const spies = [];
  const routerNames = new Set();
  const routerModules = new Set();
  const paramKeys = new Set();
  const jsonFiles = new Set();
  const closurePackages = new Set();
  const searchKeys = new Set();
  const storageKeys = new Set();

  for (const file of abs) {
    const sf = program.getSourceFile(file);
    if (!sf) continue;
    const rel = posix(path.relative(appRoot, file));
    mineLiterals(sf, checker, pools);

    // imports: data hooks, router, effect objects
    const importedFrom = new Map(); // local name -> {spec, exportName, resolved}
    for (const st of sf.statements) {
      if (!ts.isImportDeclaration(st) || !st.importClause || st.importClause.isTypeOnly) continue;
      const spec = /** @type {any} */ (st.moduleSpecifier).text;
      const resolved = resolveSpecifier(spec, file, options);
      if (resolved.bare) closurePackages.add(spec);
      // sample data the code imports (a JSON fixture): its values seed the route params' pool
      if (/\.json$/.test(spec) && !resolved.bare) jsonFiles.add(resolved.file ?? path.resolve(path.dirname(file), spec));
      const ic = st.importClause;
      if (ic.name) importedFrom.set(ic.name.text, { spec, exportName: 'default', resolved });
      if (ic.namedBindings && ts.isNamedImports(ic.namedBindings)) {
        for (const el of ic.namedBindings.elements) {
          if (el.isTypeOnly) continue;
          const exportName = (el.propertyName ?? el.name).text;
          importedFrom.set(el.name.text, { spec, exportName, resolved });
          if (ROUTER_MODULES.has(spec)) { routerNames.add(exportName); routerModules.add(spec); }
          // data hooks are the app's I/O boundary: always answered by the scenario, even when their module is in the closure
          if (DATA_HOOK.test(exportName)) {
            const key = resolved.bare ?? resolved.file;
            hookModules[key] ??= { bare: resolved.bare, file: resolved.file ? posix(path.relative(appRoot, resolved.file)) : null, hooks: {} };
            hookModules[key].hooks[exportName] ??= { kind: /Mutation$/.test(exportName) ? 'mutation' : /^useLazy/.test(exportName) ? 'lazy' : 'query', data: { k: 'any' } };
          }
        }
      }
    }

    const visit = (node) => {
      if (ts.isCallExpression(node)) {
        const callee = node.expression;
        // data hook call: the shape of `data` from the call's own return type
        if (ts.isIdentifier(callee) && importedFrom.has(callee.text) && DATA_HOOK.test(importedFrom.get(callee.text).exportName)) {
          const imp = importedFrom.get(callee.text);
          const key = imp.resolved.bare ?? imp.resolved.file;
          const h = hookModules[key]?.hooks[imp.exportName];
          if (h && h.kind === 'query' && h.data.k === 'any') {
            const rt = checker.getTypeAtLocation(node);
            const dataSym = rt.getProperty?.('data');
            if (dataSym) h.data = shapes.of(checker.getNonNullableType(checker.getTypeOfSymbol(dataSym)));
          }
        }
        // effect objects: imported `x.method(...)` where x looks like toast/analytics, or any spy-able named import call
        if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) && importedFrom.has(callee.expression.text)) {
          const imp = importedFrom.get(callee.expression.text);
          if (EFFECT_OBJECT.test(callee.expression.text) || EFFECT_OBJECT.test(imp.spec)) {
            const id = { module: imp.resolved.bare ?? posix(path.relative(appRoot, imp.resolved.file ?? '')), bare: Boolean(imp.resolved.bare), exportName: imp.exportName, method: callee.name.text };
            if (!spies.some((s) => s.module === id.module && s.exportName === id.exportName && s.method === id.method)) spies.push(id);
          }
        }
        const k = keyOf(node);
        if (k?.startsWith('search:')) searchKeys.add(k.slice(7));
        if (k?.startsWith('storage:')) storageKeys.add(k.slice(8));
        // `const { id } = useParams()`: the route params the code reads
        if (ts.isIdentifier(callee) && importedFrom.get(callee.text)?.exportName === 'useParams' && ROUTER_MODULES.has(importedFrom.get(callee.text).spec)
          && ts.isVariableDeclaration(node.parent) && ts.isObjectBindingPattern(node.parent.name)) {
          for (const el of node.parent.name.elements) paramKeys.add((el.propertyName ?? el.name).getText(sf));
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);

    // subjects: every exported value that is a function, or an object of functions
    const modSym = checker.getSymbolAtLocation(sf);
    if (!modSym) continue;
    const stem = path.basename(file).replace(/\.[^.]+$/, '');
    for (const exp of checker.getExportsOfModule(modSym)) {
      const sym = exp.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exp) : exp;
      if (!(sym.flags & (ts.SymbolFlags.Function | ts.SymbolFlags.Variable))) continue;
      const decl = sym.valueDeclaration ?? sym.declarations?.[0];
      if (!decl || decl.getSourceFile() !== sf) continue;
      const type = checker.getTypeOfSymbolAtLocation(sym, decl);
      const exportName = exp.getName();
      const addFn = (name, fnType) => {
        const sig = fnType.getCallSignatures()[0];
        if (!sig) return;
        const params = sig.getParameters().map((p) => {
          const pt = checker.getTypeOfSymbol(p);
          const s = shapes.of(pt);
          const pd = p.valueDeclaration;
          const optional = Boolean(pd && (pd.questionToken || pd.initializer));
          return optional && s.k !== 'undef' ? { k: 'union', of: [s, { k: 'undef' }] } : s;
        });
        const local = name.split('.').pop();
        const isHook = /^use[A-Z0-9]/.test(local);
        const jsx = returnsJsx(checker, sig);
        const isComponent = !isHook && jsx && (/^[A-Z]/.test(local) || local === 'default') && params.length <= 2;
        subjects.push({
          id: `${stem}.${name}`.replace(/[^A-Za-z0-9.]+/g, '-'),
          file: rel,
          exportName: name,
          kind: isHook ? 'hook' : isComponent ? 'component' : 'pure',
          params: isComponent ? [] : params,
          paramNames: isComponent ? [] : sig.getParameters().map((p) => p.getName()),
          props: isComponent ? (params[0] ?? { k: 'obj', props: [] }) : null,
        });
      };
      if (type.getCallSignatures().length) addFn(exportName, type);
      else if (type.flags & ts.TypeFlags.Object) {
        for (const p of checker.getPropertiesOfType(type)) {
          const pt = checker.getTypeOfSymbol(p);
          if (pt.getCallSignatures().length) addFn(`${exportName}.${p.getName()}`, pt);
        }
      }
    }
  }

  // hook data the call sites left as `any`: read the endpoint's declared response type in the API module
  for (const mod of Object.values(hookModules)) {
    const sf = mod.file ? program.getSourceFile(path.resolve(appRoot, mod.file)) : null;
    if (!sf) continue;
    const types = endpointResponseTypes(sf, checker);
    for (const [hook, h] of Object.entries(mod.hooks)) {
      if (h.data.k !== 'any') continue;
      const ep = hook.replace(/^use(Lazy)?/, '').replace(/(Query|Mutation)$/, '');
      const t = types.get(ep.charAt(0).toLowerCase() + ep.slice(1));
      if (t) h.data = shapes.of(t);
    }
  }
  const hookModuleList = Object.values(hookModules);

  const routes = closure.routes ?? [];
  for (const r of routes) for (const m of String(r.route ?? '').matchAll(/:([A-Za-z_]\w*)/g)) paramKeys.add(m[1]);
  // the params' pool: values under the same key in the JSON fixtures the closure imports
  for (const f of [...jsonFiles, ...closure.files.filter((x) => /\.json$/.test(x)).map((x) => path.resolve(appRoot, x))]) {
    let data = null;
    try { data = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { data = null; }
    const walk = (v, depth = 0) => {
      if (depth > 6 || v === null || typeof v !== 'object') return;
      if (Array.isArray(v)) { v.slice(0, 200).forEach((x) => walk(x, depth + 1)); return; }
      for (const [k, x] of Object.entries(v)) {
        if (paramKeys.has(k) && (typeof x === 'string' || typeof x === 'number')) (pools.byKey[`param:${k}`] ??= []).includes(String(x)) || pools.byKey[`param:${k}`].push(String(x));
        else walk(x, depth + 1);
      }
    };
    walk(data);
  }
  return {
    subjects,
    shapes: shapes.table,
    pools: { strings: [...pools.strings], numbers: [...pools.numbers].filter(Number.isFinite), byKey: pools.byKey },
    env: {
      hookModules: hookModuleList,
      router: [...routerNames],
      routerModules: [...routerModules].sort(),
      // route params (`/alerts/:id`) of the closure's routes: a scenario sets them for useParams
      paramKeys: [...paramKeys].sort(),
      spies,
      searchKeys: [...searchKeys],
      storageKeys: [...storageKeys],
      hosts: findHosts(appRoot, closurePackages),
      renderHelper: findRenderHelper(appRoot),
      pathname: routes[0]?.route ?? (routes[0]?.entry ? pathnameOfEntry(appRoot, routes[0].entry) : '/'),
    },
  };
}
