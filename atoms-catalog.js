// Atom catalog loader for atoms-transform.js.
//
// A catalog is the atom runtime's src/atoms/catalog.json: a list of
// `{atom, js: [forms], reads, pure, mutates, module}` (an array, or an object
// holding that array under `atoms`/`entries`). Each `js` form is a JS snippet
// whose free names are the atom's parameters, e.g. `a + b`, `list.map(fn)`,
// `typeof value === 'string'`, `c ? a : b`. compileCatalog() parses every
// expression form into an AST pattern; atoms-transform.js matches code against
// those patterns. Statement-shaped forms (if/switch/try/while) are kept as
// keys only: control flow is rewritten by fixed rules, gated on the atom
// being present in the catalog.
//
// Parameter names, optionality and the kinds of value an atom's first
// parameter takes (number / string / list ...) come from the entry itself
// (`params`, used by the unit-test fixture) or from the runtime's TypeScript
// source (paramsFromSource), so `a + b` can pick plus() for numbers and
// join() for text. Deterministic; no I/O except reading the files named.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const parser = require('@babel/parser');

// Names a form may use that are NOT placeholders.
const GLOBALS = new Set([
  'Object', 'Array', 'Math', 'JSON', 'Number', 'String', 'Boolean', 'Symbol', 'Set', 'Map', 'WeakMap', 'WeakSet',
  'Date', 'Promise', 'Reflect', 'Intl', 'RegExp', 'BigInt', 'Error', 'TypeError', 'RangeError', 'URL',
  'URLSearchParams', 'undefined', 'NaN', 'Infinity', 'globalThis', 'parseInt', 'parseFloat', 'isNaN', 'isFinite',
  'encodeURIComponent', 'decodeURIComponent', 'structuredClone', 'console', 'setTimeout', 'clearTimeout',
  'setInterval', 'clearInterval', 'fetch', 'window', 'document', 'localStorage', 'sessionStorage', 'queueMicrotask',
]);

function stripForm(form) {
  return String(form).trim().replace(/^`+|`+$/g, '').replace(/;\s*$/, '').trim();
}

function parseExpr(src) {
  try {
    return parser.parseExpression(src, { plugins: ['typescript'] });
  } catch {
    return null;
  }
}

function parseStmt(src) {
  try {
    const ast = parser.parse(src, { sourceType: 'module', plugins: ['typescript'], allowReturnOutsideFunction: true });
    return ast.program.body[0] || null;
  } catch {
    return null;
  }
}

// The kind of value a TS type annotation (as source text) describes.
function kindOfTypeText(text) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!t) return 'any';
  if (/^(readonly )?\w+\[\]$|^(Readonly)?Array<[^|]*>$|^readonly [\w<>]+\[\]$/.test(t)) return 'list';
  if (/string/.test(t) && /\[\]/.test(t) && /\|/.test(t)) return 'text-or-list';
  if (/Map</.test(t) && /Set</.test(t)) return 'collection';
  if (/^string$/.test(t)) return 'string';
  if (/^number$/.test(t)) return 'number';
  if (/^bigint$/.test(t)) return 'bigint';
  if (/^boolean$/.test(t)) return 'boolean';
  if (/^\((.*)\) =>/.test(t) || /^Lazy</.test(t) || /^Visit</.test(t)) return 'function';
  if (/^(Readonly)?Set</.test(t)) return 'set';
  if (/^(Readonly)?Map</.test(t)) return 'map';
  if (/^Date$/.test(t)) return 'date';
  if (/^(readonly )?[\w<>]+\[\]( \| (null|undefined))*$/.test(t)) return 'list';
  return 'any';
}

// Exported function signatures in one TS source: name -> {params, firstKinds}.
// `params` are the implementation's (the last declaration's) parameters;
// `firstKinds` is the set of kinds the first parameter takes across overloads.
function signaturesFromSource(src, file = 'atoms.ts') {
  let ast;
  try {
    ast = parser.parse(src, { sourceType: 'module', plugins: ['typescript'] });
  } catch {
    return {};
  }
  const out = {};
  const textOf = (n) => (n ? src.slice(n.start, n.end) : '');
  for (const st of ast.program.body) {
    const d = st.type === 'ExportNamedDeclaration' ? st.declaration : null;
    if (!d || (d.type !== 'FunctionDeclaration' && d.type !== 'TSDeclareFunction') || !d.id) continue;
    const name = d.id.name;
    const params = d.params.map((p) => {
      let node = p;
      let optional = false;
      let rest = false;
      if (node.type === 'TSParameterProperty') node = node.parameter;
      if (node.type === 'AssignmentPattern') { optional = true; node = node.left; }
      if (node.type === 'RestElement') { rest = true; optional = true; node = node.argument; }
      if (node.optional) optional = true;
      const ann = node.typeAnnotation && node.typeAnnotation.typeAnnotation;
      return { name: node.type === 'Identifier' ? node.name : null, optional, rest, type: textOf(ann) };
    }).filter((p) => p.name !== 'this');
    const entry = out[name] || { params: [], overloads: [], file };
    entry.overloads.push(params);
    if (d.type === 'FunctionDeclaration') entry.params = params; // the implementation
    out[name] = entry;
  }
  for (const e of Object.values(out)) {
    if (!e.params.length && e.overloads.length) e.params = e.overloads[e.overloads.length - 1];
    // A generated wrapper implements its overloads as `(...args: any[])`: the parameters a
    // caller sees are the declared ones, so take the widest overload.
    // (An instance wrapper keeps its receiver: `(text: any, ...args: any[])`.)
    const declared = e.overloads.slice(0, -1);
    const last = e.params[e.params.length - 1];
    if (declared.length && last && last.rest) {
      e.params = declared.reduce((widest, ps) => (ps.length > widest.length ? ps : widest));
    }
    // the fewest arguments any declared signature accepts
    const required = (ps) => ps.filter((q) => !q.optional).length;
    e.minArity = Math.min(...(declared.length ? declared : e.overloads).map(required));
    // An implementation signature (typed any/unknown) is not one a caller sees; use the overloads when there are several.
    const visible = e.overloads.length > 1 ? e.overloads.slice(0, -1) : e.overloads;
    e.firstKinds = [...new Set(visible.map((ps) => kindOfTypeText(ps[0] && ps[0].type)))].sort();
  }
  return out;
}

// Every exported function of every .ts file under the runtime's src/atoms,
// subfolders included (src/atoms/generated holds the generated wrappers).
function paramsFromSource(root) {
  const dir = fs.existsSync(path.join(root, 'src', 'atoms')) ? path.join(root, 'src', 'atoms') : root;
  const out = {};
  if (!fs.existsSync(dir)) return out;
  const walk = (d, prefix) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      if (e.isDirectory()) walk(path.join(d, e.name), `${prefix}${e.name}/`);
      else if (e.name.endsWith('.ts') && !e.name.endsWith('.d.ts')) {
        Object.assign(out, signaturesFromSource(fs.readFileSync(path.join(d, e.name), 'utf8'), `${prefix}${e.name}`));
      }
    }
  };
  walk(dir, '');
  return out;
}

function entriesOf(catalog) {
  if (Array.isArray(catalog)) return catalog;
  if (catalog && Array.isArray(catalog.atoms)) return catalog.atoms;
  if (catalog && Array.isArray(catalog.entries)) return catalog.entries;
  return [];
}

// Every placeholder in a pattern, in source order, with whether it sits in a
// lazily evaluated position (right side of && || ??, a ?: branch).
function arrowBound(pattern) {
  const out = new Set();
  const visit = (n) => {
    if (!n || typeof n.type !== 'string') return;
    if (n.type === 'ArrowFunctionExpression' || n.type === 'FunctionExpression') {
      const pat = (p) => {
        if (!p) return;
        if (p.type === 'Identifier') out.add(p.name);
        else if (p.type === 'AssignmentPattern') pat(p.left);
        else if (p.type === 'RestElement') pat(p.argument);
        else if (p.type === 'ArrayPattern') p.elements.forEach(pat);
        else if (p.type === 'ObjectPattern') p.properties.forEach((x) => pat(x.value || x.argument));
      };
      n.params.forEach(pat);
    }
    for (const key of Object.keys(n)) {
      if (['loc', 'start', 'end', 'extra'].includes(key)) continue;
      const v = n[key];
      if (Array.isArray(v)) v.forEach(visit);
      else if (v && typeof v.type === 'string') visit(v);
    }
  };
  visit(pattern);
  return out;
}

// Every name a pattern calls or constructs directly: `f` in `f(x)` and in `new f(x)`.
function calledNames(pattern) {
  const out = new Set();
  const visit = (n) => {
    if (!n || typeof n.type !== 'string') return;
    if (/CallExpression$|^NewExpression$/.test(n.type) && n.callee.type === 'Identifier') out.add(n.callee.name);
    for (const key of Object.keys(n)) {
      if (['loc', 'start', 'end', 'extra'].includes(key)) continue;
      const v = n[key];
      if (Array.isArray(v)) v.forEach(visit);
      else if (v && typeof v.type === 'string') visit(v);
    }
  };
  visit(pattern);
  return out;
}

function placeholdersOf(pattern, isPlaceholder) {
  const seen = [];
  const lazy = new Set();
  const eager = new Set();
  const visit = (n, isLazy, parentKey, parent) => {
    if (!n || typeof n.type !== 'string') return;
    if (n.type === 'Identifier') {
      const isProp = parent && (parent.type === 'MemberExpression' || parent.type === 'OptionalMemberExpression') && parentKey === 'property' && !parent.computed;
      const isKey = parent && parent.type === 'ObjectProperty' && parentKey === 'key' && !parent.computed;
      if (!isProp && !isKey && isPlaceholder(n.name)) {
        if (!seen.includes(n.name)) seen.push(n.name);
        (isLazy ? lazy : eager).add(n.name);
      }
      return;
    }
    for (const key of Object.keys(n)) {
      if (['loc', 'start', 'end', 'extra', 'leadingComments', 'trailingComments', 'innerComments', 'range'].includes(key)) continue;
      const v = n[key];
      let childLazy = isLazy;
      if (n.type === 'LogicalExpression' && key === 'right') childLazy = true;
      if (n.type === 'ConditionalExpression' && (key === 'consequent' || key === 'alternate')) childLazy = true;
      if (Array.isArray(v)) v.forEach((c) => visit(c, childLazy, key, n));
      else if (v && typeof v.type === 'string') visit(v, childLazy, key, n);
    }
  };
  visit(pattern, false, null, null);
  // `value === null || value === undefined`: value is read on the left first, so it is not deferred
  eager.forEach((name) => lazy.delete(name));
  return { names: seen, lazy };
}

function nodeSize(n) {
  if (!n || typeof n !== 'object') return 0;
  let s = typeof n.type === 'string' ? 1 : 0;
  for (const key of Object.keys(n)) {
    if (['loc', 'start', 'end', 'extra', 'leadingComments', 'trailingComments', 'innerComments'].includes(key)) continue;
    const v = n[key];
    if (Array.isArray(v)) v.forEach((c) => { s += nodeSize(c); });
    else if (v && typeof v.type === 'string') s += nodeSize(v);
  }
  return s;
}

// A stable short key for the top of an expression/statement shape, used both
// to index patterns and to name untranslated forms in reports.
function shapeKey(n) {
  if (!n) return 'unknown';
  switch (n.type) {
    case 'BinaryExpression':
    case 'LogicalExpression':
      return `${n.type} ${n.operator}`;
    case 'UnaryExpression':
      return `${n.type} ${n.operator}`;
    case 'UpdateExpression':
      return `${n.type} ${n.operator}`;
    case 'AssignmentExpression':
      return `${n.type} ${n.operator}`;
    case 'CallExpression':
    case 'OptionalCallExpression':
    case 'NewExpression': {
      const c = n.callee;
      if (c.type === 'Identifier') return `${n.type} ${n.type === 'NewExpression' ? 'new ' : ''}${c.name}()`;
      if ((c.type === 'MemberExpression' || c.type === 'OptionalMemberExpression') && !c.computed && c.property.type === 'Identifier') {
        if (c.object.type === 'Identifier' && GLOBALS.has(c.object.name)) return `${n.type} ${c.object.name}.${c.property.name}()`;
        return `${n.type} .${c.property.name}()`;
      }
      return n.type;
    }
    case 'MemberExpression':
    case 'OptionalMemberExpression':
      if (!n.computed && n.property.type === 'Identifier') return `${n.type} .${n.property.name}`;
      return `${n.type} [computed]`;
    default:
      return n.type;
  }
}

// catalog -> {entries, patterns, atoms: Set, version, statementForms}
function compileCatalog(catalog, { signatures = {} } = {}) {
  const entries = entriesOf(catalog);
  const raw = JSON.stringify(catalog);
  const version = (catalog && !Array.isArray(catalog) && (catalog.version || catalog.catalogVersion))
    || `sha1:${crypto.createHash('sha1').update(raw).digest('hex').slice(0, 12)}`;
  const patterns = [];
  const atoms = new Map();
  const statementForms = {};
  for (const entry of entries) {
    if (!entry || !entry.atom) continue;
    const sig = signatures[entry.atom] || {};
    const params = entry.params
      ? entry.params.map((p) => (typeof p === 'string' ? { name: p.replace(/[?.]/g, ''), optional: /\?$/.test(p) || /^\.\.\./.test(p), rest: /^\.\.\./.test(p), type: '' } : p))
      : sig.params || null;
    const firstKinds = entry.firstKinds || sig.firstKinds || ['any'];
    const minArity = entry.params ? params.filter((q) => !q.optional).length : sig.minArity == null ? null : sig.minArity;
    const info = { atom: entry.atom, entry, params, minArity, firstKinds, module: entry.module || null };
    atoms.set(entry.atom, info);
    for (const form of [].concat(entry.js || [])) {
      const src = stripForm(form);
      if (!src) continue;
      const expr = parseExpr(src);
      if (!expr || expr.type === 'ArrowFunctionExpression') {
        const st = parseStmt(src);
        const key = st ? shapeKey(st) : src;
        (statementForms[key] = statementForms[key] || []).push(entry.atom);
        continue;
      }
      // free names of the form are its placeholders; names bound by an arrow
      // inside the form (`(a, b) => a + b`) are pattern variables: they only
      // match an identifier, the same one each time, and are never arguments.
      // The function a form calls by name (`encodeURI(uri)`, `new SyntaxError(message)`) is that
      // global, not a placeholder.
      const vars = arrowBound(expr);
      const called = calledNames(expr);
      const ph = placeholdersOf(expr, (name) => !GLOBALS.has(name) && !vars.has(name) && !called.has(name));
      // A form with nothing to bind is a rewrite only when it is a call (`Date.now()`,
      // `Math.random()`, `new Date()`) of an atom that can be called with no arguments.
      const constant = !ph.names.length;
      if (constant && (!/^(CallExpression|NewExpression)$/.test(expr.type) || minArity !== 0)) continue;
      patterns.push({
        constant,
        // the built-in changes its receiver and the atom returns a changed copy instead: not the same thing
        copying: !!entry.replacesMutation,
        atom: entry.atom,
        info,
        form: src,
        pattern: expr,
        key: shapeKey(expr),
        placeholders: ph.names,
        vars: [...vars],
        lazy: ph.lazy,
        size: nodeSize(expr),
      });
    }
  }
  // Larger (more specific) patterns first, then catalog order.
  patterns.sort((a, b) => b.size - a.size);
  return { entries, patterns, atoms, version, statementForms };
}

function loadCatalog(catalogPath, { runtimeRoot } = {}) {
  const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
  const root = runtimeRoot || path.resolve(path.dirname(catalogPath), '..', '..');
  return compileCatalog(catalog, { signatures: paramsFromSource(root) });
}

module.exports = {
  GLOBALS,
  compileCatalog,
  loadCatalog,
  paramsFromSource,
  signaturesFromSource,
  kindOfTypeText,
  shapeKey,
  stripForm,
};
