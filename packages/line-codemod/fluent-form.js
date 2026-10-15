// Atom call -> fluent sentence (ENGLISH-RULES.md build step 5, spike t2-1).
//
//   toFluent(atomCall, catalog)  -> string | null
//   explainFluent(atomCall, catalog) -> { sentence, atom, reason }
//   fluentFor(code, opts)        -> { code, sentences, plain, reasons, atoms, untranslated, full }
//
// atomCall  `name(a, b)` as source text, or a Babel CallExpression whose callee is the atom name
//           (an Identifier). Argument source comes from `node.extra.source` when set, otherwise from
//           @babel/generator.
// catalog   the raw catalog.json object ({ atoms: [...] }) or a compiled catalog
//           (atoms-catalog.js compileCatalog/loadCatalog, `atoms` is a Map).
//
// The catalog's `fluent` is a call chain such as `checks().if(a).is().less().than(b)`. Its slots
// are the chain arguments that are a bare name (`a`) or a thunk of a bare name (`() => b`,
// `(e) => recover`). Slots map to call arguments by name when every slot name is one of the
// atom's parameters (catalog `check[0].params` order, or the compiled params), else by position.
// A thunk slot takes a function argument as it is and wraps any other argument in `() =>`.
// Missing trailing arguments drop the tail of the chain from the first segment that needs them
// (`when(c, () => a)` -> `when(c).yields(() => a)`). An argument the sentence has no slot for, a
// spread argument, or a non-trailing gap makes the result null, with the reason in explainFluent.
// choose and match take a list / object of cases, so they are built case by case.
// No model involved: deterministic.
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default || require('@babel/traverse');
const generate = require('@babel/generator').default || require('@babel/generator');
const { toAtoms } = require('./atoms-transform');

const PARSE_OPTS = { sourceType: 'module', plugins: ['typescript', 'jsx'], errorRecovery: false };

const isFn = (n) => n && (n.type === 'ArrowFunctionExpression' || n.type === 'FunctionExpression');
const src = (n) => (n.extra && typeof n.extra.source === 'string' ? n.extra.source : generate(n, { comments: false }).code);

// catalog -> Map atom -> { fluent, params: [name] }
const indexCache = new WeakMap();
function indexOf(catalog) {
  if (!catalog || typeof catalog !== 'object') throw new Error('toFluent: a catalog is required');
  if (indexCache.has(catalog)) return indexCache.get(catalog);
  const idx = new Map();
  const add = (entry, compiledParams) => {
    if (!entry || !entry.atom) return;
    const checkParams = Array.isArray(entry.check) && entry.check[0] && entry.check[0].params ? entry.check[0].params.map(([n]) => n) : null;
    const params = checkParams || (compiledParams ? compiledParams.map((p) => p.name) : null);
    idx.set(entry.atom, { fluent: entry.fluent || null, params: params || [] });
  };
  if (catalog.atoms instanceof Map) for (const info of catalog.atoms.values()) add(info.entry, info.params);
  else for (const e of [].concat(catalog.atoms || catalog)) add(e, null);
  indexCache.set(catalog, idx);
  return idx;
}

// `a().b(x).c(() => y)` -> [{ name, args }] (root first); null when the fluent is not a plain chain
function chainOf(expr) {
  const segs = [];
  let n = expr;
  while (n && n.type === 'CallExpression') {
    if (n.callee.type === 'Identifier') { segs.unshift({ name: n.callee.name, args: n.arguments }); return segs; }
    if (n.callee.type !== 'MemberExpression' || n.callee.computed || n.callee.property.type !== 'Identifier') return null;
    segs.unshift({ name: n.callee.property.name, args: n.arguments });
    n = n.callee.object;
  }
  return null;
}

const templateCache = new Map();
function templateOf(fluent) {
  if (templateCache.has(fluent)) return templateCache.get(fluent);
  let t = null;
  try {
    const segs = chainOf(parser.parseExpression(fluent));
    if (segs) {
      t = segs.map((s) => ({
        name: s.name,
        args: s.args.map((a) => {
          if (a.type === 'Identifier') return { slot: a.name, thunk: false };
          if (isFn(a) && a.body.type === 'Identifier') return { slot: a.body.name, thunk: true, params: a.params.map((p) => src(p)) };
          return { text: src(a) };
        }),
      }));
    }
  } catch { t = null; }
  templateCache.set(fluent, t);
  return t;
}

function parseCall(atomCall) {
  if (typeof atomCall === 'string') {
    let e;
    try { e = parser.parseExpression(atomCall, { plugins: ['typescript', 'jsx'] }); } catch { return null; }
    if (!e || e.type !== 'CallExpression') return null;
    // keep each argument as written (the generator would reprint `(e) => x` as `e => x`)
    for (const a of e.arguments) a.extra = { ...(a.extra || {}), source: atomCall.slice(a.start, a.end) };
    return e;
  }
  return atomCall && atomCall.type === 'CallExpression' ? atomCall : null;
}

const fail = (atom, reason) => ({ sentence: null, atom, reason });

function thunkOf(arg, s) {
  return isFn(arg) ? s : `() => ${s}`;
}

function chooseSentence(args) {
  const [cases, fallback] = args;
  if (!cases || cases.type !== 'ArrayExpression' || args.length > 2) return { reason: 'choose cases are not a list literal' };
  const parts = ['chooses()'];
  for (const c of cases.elements) {
    if (!c || c.type !== 'ArrayExpression' || c.elements.length !== 2 || c.elements.some((x) => !x || x.type === 'SpreadElement')) return { reason: 'choose case is not a [condition, value] pair' };
    parts.push(`when(${src(c.elements[0])})`, `yields(${thunkOf(c.elements[1], src(c.elements[1]))})`);
  }
  if (fallback) parts.push(`otherwise(${thunkOf(fallback, src(fallback))})`);
  return { sentence: parts.join('.') };
}

function matchSentence(args) {
  const [value, cases, fallback] = args;
  if (!value || !cases || cases.type !== 'ObjectExpression' || args.length > 3) return { reason: 'match cases are not an object literal' };
  const parts = [`matches()`, `value(${src(value)})`];
  for (const p of cases.properties) {
    if (p.type !== 'ObjectProperty' || p.computed) return { reason: 'match case is computed or spread' };
    const key = p.key.type === 'Identifier' ? JSON.stringify(p.key.name) : src(p.key);
    parts.push(`on(${key})`, `yields(${thunkOf(p.value, src(p.value))})`);
  }
  if (fallback) parts.push(`otherwise(${thunkOf(fallback, src(fallback))})`);
  return { sentence: parts.join('.') };
}

function explainFluent(atomCall, catalog) {
  const idx = indexOf(catalog);
  const call = parseCall(atomCall);
  if (!call || call.callee.type !== 'Identifier') return fail(null, 'not an atom call');
  const atom = call.callee.name;
  const info = idx.get(atom);
  if (!info) return fail(atom, 'not a catalog atom');
  if (!info.fluent) return fail(atom, 'atom has no fluent');
  const args = call.arguments;
  if (args.some((a) => a.type === 'SpreadElement' || a.type === 'ArgumentPlaceholder')) return fail(atom, 'spread argument');
  if (atom === 'choose' || atom === 'match') {
    const r = atom === 'choose' ? chooseSentence(args) : matchSentence(args);
    return r.sentence ? { sentence: r.sentence, atom, reason: null } : fail(atom, r.reason);
  }
  const tpl = templateOf(info.fluent);
  if (!tpl) return fail(atom, 'fluent is not a call chain');
  const slots = tpl.flatMap((s) => s.args.filter((a) => a.slot));
  const byName = slots.length > 0 && slots.every((s) => info.params.includes(s.slot));
  const argIndex = (s, i) => (byName ? info.params.indexOf(s.slot) : i);
  const covered = new Set(slots.map(argIndex));
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    const isUndef = a.type === 'Identifier' && a.name === 'undefined';
    if (!covered.has(i) && !isUndef) return fail(atom, `argument ${i + 1} has no place in the sentence`);
  }
  // Groups: the segments up to and including each slot's segment (`.and().recovers().with(recover)`).
  // A group whose argument is missing (or `undefined`) is left out; the words after the last
  // slot stay only when that slot's group is kept. A group with two slots needs both or neither.
  const groups = [];
  let cur = [];
  for (const seg of tpl) {
    cur.push(seg);
    if (seg.args.some((a) => a.slot)) { groups.push(cur); cur = []; }
  }
  const tail = cur;
  const missing = (arg) => !arg || (arg.type === 'Identifier' && arg.name === 'undefined');
  const out = [];
  let slotNo = 0;
  let lastKept = true;
  for (let gi = 0; gi < groups.length; gi++) {
    const rendered = [];
    let have = 0, lack = 0;
    for (const seg of groups[gi]) {
      const parts = [];
      for (const a of seg.args) {
        if (!a.slot) { parts.push(a.text); continue; }
        const arg = args[argIndex(a, slotNo++)];
        if (missing(arg)) { lack++; continue; }
        have++;
        parts.push(a.thunk ? thunkOf(arg, src(arg)) : src(arg));
      }
      rendered.push(`${seg.name}(${parts.join(', ')})`);
    }
    if (have && lack) return fail(atom, 'a step of the sentence is only partly given');
    if (lack && gi === 0) return fail(atom, 'first argument is missing');
    lastKept = !lack;
    if (!lack) out.push(...rendered);
  }
  if (lastKept) for (const seg of tail) out.push(`${seg.name}(${seg.args.map((a) => a.text).join(', ')})`);
  if (out.length === 0) return fail(atom, 'first argument is missing');
  return { sentence: out.join('.'), atom, reason: null };
}

function toFluent(atomCall, catalog) {
  return explainFluent(atomCall, catalog).sentence;
}

// toAtoms, then every atom call (innermost first) becomes its fluent sentence.
// opts: toAtoms options (catalog required). full = nothing left untranslated by toAtoms, every atom
// call became a sentence, and at least one atom call was made.
function fluentFor(code, opts = {}) {
  const res = toAtoms(code, opts);
  const localToAtom = new Map(Object.entries(res.atoms || {}).map(([atom, local]) => [local, atom]));
  const ast = parser.parse(res.code, PARSE_OPTS);
  const sentences = [];
  const reasons = [];
  traverse(ast, {
    ImportDeclaration(p) { p.skip(); },
    CallExpression: {
      exit(p) {
        const n = p.node;
        if (n.callee.type !== 'Identifier' || !localToAtom.has(n.callee.name)) return;
        const atom = localToAtom.get(n.callee.name);
        const named = { ...n, callee: { type: 'Identifier', name: atom } };
        const r = explainFluent(named, opts.catalog);
        if (!r.sentence) { reasons.push({ atom, reason: r.reason }); return; }
        sentences.push({ atom, sentence: r.sentence });
        // a sentence lifted out of its function or class (`new.target`, `#x`) does not parse on
        // its own; the generator prints an identifier's name as it is, so it stands in for the text
        let repl;
        try { repl = parser.parseExpression(r.sentence, { plugins: ['typescript', 'jsx'], allowNewTargetOutsideFunction: true }); } catch { repl = { type: 'Identifier', name: r.sentence }; }
        p.replaceWith(repl);
        p.skip();
      },
    },
  });
  const out = generate(ast, { comments: true, retainLines: false }).code;
  return {
    code: out,
    sentences,
    plain: reasons.length,
    reasons,
    atoms: res.atoms,
    untranslated: res.untranslated,
    full: res.untranslated.length === 0 && reasons.length === 0 && sentences.length > 0,
  };
}

module.exports = { toFluent, explainFluent, fluentFor };
