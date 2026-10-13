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

// ONE walker, two views. Every rule below emits into a single ordered item
// list; each item is either a CHIP ({text, type, start?, end?} -- start/end
// are the SOURCE node the chip came from, omitted for connectives that don't
// correspond to a single node) or GLUE (punctuation that only exists in the
// flat sentence: "'s", "(", ")"). A chip may also carry `en`, its spelling in
// the flat sentence when that differs from the chip label ("then" chip reads
// "; then"). `render()` joins the items into the flat English string and
// `chipsOf()` keeps only the chips -- so the sentence and the chips can never
// drift apart: there is no second switch to forget to update.
//
// A multi-word atom/verb name (camelToWords splits it into several English
// words) is still ONE chip, mapped to the one callee/property node it came
// from -- the words belong together and must move together.
//
// Spacing: items are joined with one space, except an item with glueL sticks
// to the item before it and an item with glueR sticks to the item after it.
function makeOut() {
  return { items: [], unhandled: [] };
}

function chip(out, text, type, node, opts) {
  const c = { text, type };
  if (node) {
    c.start = node.start;
    c.end = node.end;
  }
  out.items.push({
    chip: c,
    en: opts && opts.en !== undefined ? opts.en : text,
    glueL: !!(opts && opts.glueL),
    glueR: !!(opts && opts.glueR),
  });
}

function glue(out, en, opts) {
  out.items.push({ chip: null, en, glueL: !!(opts && opts.glueL), glueR: !!(opts && opts.glueR) });
}

// The one place a construct with no English rule is recorded: the
// placeholder chip itself, plus a structured {kind, type, start, end} entry.
const PLACEHOLDER_TEXT = { expr: '(...)', stmt: '(a step that does not translate cleanly)', pattern: '?' };

function noteUnhandled(out, kind, node) {
  out.unhandled.push({
    kind,
    type: node ? node.type : 'unknown',
    start: node && node.start != null ? node.start : null,
    end: node && node.end != null ? node.end : null,
  });
}

function placeholder(out, kind, node) {
  noteUnhandled(out, kind, node);
  chip(out, PLACEHOLDER_TEXT[kind], 'connective');
}

function render(items) {
  let s = '';
  let stickNext = true;
  for (const it of items) {
    const en = it.en == null ? '' : String(it.en);
    if (en === '') continue;
    if (s && !it.glueL && !stickNext) s += ' ';
    s += en;
    stickNext = it.glueR;
  }
  return s;
}

function chipsOf(items) {
  return items.filter((it) => it.chip).map((it) => it.chip);
}

// A declarator's `id` isn't always a plain Identifier -- destructuring
// (const [a, b] = args, the shape transform.js's extraction step itself
// produces for a multi-param original) gives an ArrayPattern/ObjectPattern
// instead, whose .name is undefined. Recurses so nested patterns
// ([a, [b, c]]) still render as something readable instead of "undefined".
function patternName(id, out) {
  if (id.type === 'Identifier') return id.name;
  if (id.type === 'ArrayPattern') return `[${id.elements.map((el) => (el ? patternName(el, out) : '')).join(', ')}]`;
  if (id.type === 'ObjectPattern') return `{${id.properties.map((p) => (p.key ? patternName(p.key, out) : '')).join(', ')}}`;
  noteUnhandled(out, 'pattern', id);
  return '?';
}

// Identifier/this read as the SUBJECT of whatever follows (a.equals(b): "a"
// is the subject); anything else is just an expression in that position.
function walkSubject(node, out) {
  if (node.type === 'Identifier') return chip(out, node.name === 'this' ? 'it' : node.name, 'subject', node);
  if (node.type === 'ThisExpression') return chip(out, 'it', 'subject', node);
  return walkExpr(node, out);
}

function walkArgs(nodes, out) {
  nodes.forEach((n, i) => {
    if (i > 0) chip(out, 'and', 'connective');
    walkExpr(n, out);
  });
}

function walkExpr(node, out) {
  if (!node) return;
  switch (node.type) {
    case 'Identifier':
      return chip(out, node.name === 'this' ? 'it' : node.name, 'arg', node);
    case 'ThisExpression':
      return chip(out, 'it', 'arg', node);
    case 'StringLiteral':
      return chip(out, `'${node.value}'`, 'arg', node);
    case 'NumericLiteral':
    case 'BooleanLiteral':
      return chip(out, String(node.value), 'arg', node);
    case 'NullLiteral':
      return chip(out, 'nothing', 'arg', node);
    case 'MemberExpression':
      // computed: true is bracket notation with a dynamic key (obj[x]) --
      // property is a VALUE expression (a variable, a literal), not a fixed
      // field name, so it must be rendered as an expression, not word-split
      // like a property name. Treating both cases the same was the bug:
      // this.rules[name] rendered as "rules's name" (implying a literal
      // nested field this.rules.name), when it's actually a lookup BY the
      // variable name -- a different meaning entirely.
      walkSubject(node.object, out);
      if (node.computed) {
        chip(out, 'at', 'connective');
        return walkExpr(node.property, out);
      }
      glue(out, "'s", { glueL: true });
      return chip(out, camelToWords(node.property.name || ''), 'verb', node.property);
    case 'UnaryExpression':
      if (node.operator === '!') {
        chip(out, 'not', 'connective');
        glue(out, '(', { glueR: true });
        walkExpr(node.argument, out);
        return glue(out, ')', { glueL: true });
      }
      chip(out, node.operator, 'connective', null, { glueR: true });
      return walkExpr(node.argument, out);
    case 'CallExpression': {
      const callee = node.callee;
      if (callee.type === 'MemberExpression') {
        walkSubject(callee.object, out);
        chip(out, camelToWords(callee.property.name || ''), 'verb', callee.property);
        return walkArgs(node.arguments, out);
      }
      chip(out, camelToWords(callee.name || ''), 'verb', callee);
      if (node.arguments.length) {
        chip(out, 'of', 'connective');
        walkArgs(node.arguments, out);
      }
      return;
    }
    case 'ArrowFunctionExpression':
      // Renders the closure's BODY, not the closure itself -- "() => x"
      // reads as just "x". Without this, any call taking a callback (like
      // ifIt/elseIfIt/elseIt) rendered every argument as a bare "(...)"
      // placeholder, losing the actual condition/result entirely.
      if (node.body.type === 'BlockStatement') return walkBlock(node.body, out);
      return walkExpr(node.body, out);
    case 'NewExpression':
      chip(out, 'a new', 'connective');
      chip(out, node.callee.name, 'verb', node.callee, { en: String(node.callee.name) });
      if (node.arguments.length) {
        chip(out, 'of', 'connective');
        walkArgs(node.arguments, out);
      }
      return;
    case 'BinaryExpression':
      walkExpr(node.left, out);
      chip(out, node.operator, 'connective');
      return walkExpr(node.right, out);
    case 'AssignmentExpression':
      chip(out, 'set', 'connective');
      walkExpr(node.left, out);
      chip(out, 'to', 'connective');
      return walkExpr(node.right, out);
    default:
      return placeholder(out, 'expr', node);
  }
}

function walkBlock(node, out) {
  if (!node) return;
  if (node.type === 'BlockStatement') {
    node.body.forEach((s, i) => {
      if (i > 0) chip(out, 'then', 'connective', null, { en: '; then', glueL: true });
      walkStmt(s, out);
    });
    return;
  }
  walkStmt(node, out);
}

function walkStmt(node, out) {
  switch (node.type) {
    case 'ReturnStatement':
      chip(out, 'return', 'connective');
      return walkExpr(node.argument, out);
    case 'ExpressionStatement':
      return walkExpr(node.expression, out);
    case 'VariableDeclaration':
      node.declarations.forEach((d, i) => {
        if (i > 0) chip(out, ',', 'connective', null, { glueL: true });
        chip(out, 'let', 'connective');
        chip(out, patternName(d.id, out), 'subject', d.id);
        chip(out, 'be', 'connective');
        if (d.init) walkExpr(d.init, out);
        else chip(out, 'undefined', 'arg');
      });
      return;
    case 'IfStatement':
      chip(out, 'if', 'connective');
      walkExpr(node.test, out);
      chip(out, ':', 'connective', null, { glueL: true });
      walkBlock(node.consequent, out);
      if (node.alternate) {
        chip(out, 'otherwise', 'connective', null, { en: ', otherwise', glueL: true });
        walkBlock(node.alternate, out);
      }
      return;
    case 'ForInStatement':
    case 'ForOfStatement': {
      chip(out, 'for each', 'connective');
      if (node.left.declarations) {
        const id = node.left.declarations[0].id;
        chip(out, id.name, 'subject', id, { en: String(id.name) });
      } else {
        walkExpr(node.left, out);
      }
      chip(out, node.type === 'ForInStatement' ? 'in' : 'of', 'connective');
      walkExpr(node.right, out);
      chip(out, ':', 'connective', null, { glueL: true });
      return walkBlock(node.body, out);
    }
    case 'BlockStatement':
      return walkBlock(node, out);
    default:
      return placeholder(out, 'stmt', node);
  }
}

// Chips for one statement -- the step's word chips the demo edits, and what
// reorderChip() re-derives to find which chips moved.
function tokenizeStmt(node) {
  const out = makeOut();
  walkStmt(node, out);
  return chipsOf(out.items);
}

// The same statement as a flat sentence plus its chips and unhandled list,
// all from one walk.
function describeStmt(node) {
  const out = makeOut();
  walkStmt(node, out);
  return { english: render(out.items), tokens: chipsOf(out.items), unhandled: out.unhandled };
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
  const paramMisses = [];

  traverse(ast, {
    ClassMethod(path) {
      name = path.node.key.name;
      params = path.node.params.map((p) => p.name || (paramMisses.push({ kind: 'pattern', type: p.type, start: p.start, end: p.end }), '?'));
      body = path.node.body;
      path.stop();
    },
    FunctionDeclaration(path) {
      if (!path.parentPath.isProgram()) return;
      name = path.node.id ? path.node.id.name : '(anonymous)';
      params = path.node.params.map((p) => p.name || (paramMisses.push({ kind: 'pattern', type: p.type, start: p.start, end: p.end }), '?'));
      body = path.node.body;
      path.stop();
    },
  });

  if (!body) {
    return { english: '(could not find a function/method to describe)', steps: [], title: null, unhandled: [] };
  }

  const title = `${camelToWords(name)}${params.length ? ' using ' + params.join(' and ') : ''}`;
  const shift = (u) => ({ ...u, start: u.start != null ? u.start - prefixLen : null, end: u.end != null ? u.end - prefixLen : null });
  const steps = body.body.map((s) => {
    const d = describeStmt(s);
    return {
      english: d.english,
      unhandled: d.unhandled.map(shift),
      code: wrapped.slice(s.start, s.end),
      start: s.start - prefixLen,
      end: s.end - prefixLen,
      // Same step, as chips instead of a flat string -- each chip's start/end
      // (when present) are shifted by the same class-wrapper offset as the
      // step's own start/end, so both stay in the same coordinate space as
      // `code` above.
      tokens: d.tokens.map((tok) => ({
        ...tok,
        start: tok.start != null ? tok.start - prefixLen : null,
        end: tok.end != null ? tok.end - prefixLen : null,
      })),
    };
  });
  const english = `${title}: ${steps.map((s) => s.english).join('; then ')}.`;
  return { english, steps, title, unhandled: [...paramMisses.map(shift), ...steps.flatMap((s) => s.unhandled)] };
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

// Same call-site walk as extractAtoms, but keeps first-use order (instead of
// sorting) and counts repeats -- what the demo's single cross-example atom
// list needs: the order the reader hits each atom for the first time, and
// how many times it's actually called. Ordered by the position of the
// CALLEE NAME ITSELF (the method/function identifier), not the enclosing
// CallExpression's start: a whole chain like
// ifIt(v).greaterThanOrEqual(min).and(v) shares one start position (the
// leftmost `ifIt`) across every nested call in it, so sorting by that would
// leave every atom in the chain tied. The name's own token position is
// unique per call and increases left-to-right, matching reading order.
function extractAtomUsage(code, kind) {
  const wrapped = kind === 'method' ? `class __W__ {\n${code}\n}` : code;
  const ast = parser.parse(wrapped, { sourceType: 'module' });
  const counts = {};
  const firstStart = {};
  traverse(ast, {
    CallExpression(path) {
      const callee = path.node.callee;
      let name = null;
      let nameStart = path.node.start;
      if (callee.type === 'MemberExpression' && callee.property.name) {
        name = callee.property.name;
        nameStart = callee.property.start;
      } else if (callee.type === 'Identifier') {
        name = callee.name;
        nameStart = callee.start;
      }
      if (!name) return;
      counts[name] = (counts[name] || 0) + 1;
      if (!(name in firstStart) || nameStart < firstStart[name]) firstStart[name] = nameStart;
    },
  });
  return Object.keys(counts)
    .sort((a, b) => firstStart[a] - firstStart[b])
    .map((name) => ({ name, count: counts[name] }));
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
// `plugins` defaults to plain JS (existing demo caller, unchanged) --
// unplug.js passes ['typescript', 'jsx'] to reorder statements inside a
// .tsx source function.
function reorderSteps(code, kind, order, { plugins = [] } = {}) {
  const wrapped = kind === 'method' ? `class __W__ {\n${code}\n}` : code;
  const ast = parser.parse(wrapped, { sourceType: 'module', plugins });
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

// Parameter names of a registered atom, read straight off its own stored
// function source -- so a step calling it never has to carry its own copy
// of the signature that could drift out of sync.
function atomParamNames(atomCode) {
  const ast = parser.parse(atomCode, { sourceType: 'module' });
  let params = [];
  traverse(ast, {
    FunctionDeclaration(path) {
      params = path.node.params.map((p) => p.name || '?');
      path.stop();
    },
  });
  return params;
}

// Builds the replacement statement for a step now resolved to a known atom
// -- a call to that atom, in the SHAPE of the step it's replacing (still a
// return, still assigned to the same variable, or just a bare call), with
// the atom's own parameter names passed through as-is. That only reads
// right when the surrounding scope already has bindings with those names,
// which is the same "same word, same thing" convention every atom in this
// codebase already relies on (a.equals(b), not a.equals(someOtherName)).
function buildStepFromAtom(originalStmt, atomName, paramNames) {
  const call = `${atomName}(${paramNames.join(', ')})`;
  if (originalStmt.type === 'ReturnStatement') return `return ${call};`;
  if (originalStmt.type === 'VariableDeclaration' && originalStmt.declarations.length === 1 && originalStmt.declarations[0].id.type === 'Identifier') {
    return `${originalStmt.kind} ${originalStmt.declarations[0].id.name} = ${call};`;
  }
  return `${call};`;
}

// Swaps the statement at stepIndex for a call to a resolved atom, keeping
// the original statement's shape (see buildStepFromAtom). This is the
// "wording is recognized -> code updates" half of editable steps.
function applyAtomToStep(code, kind, stepIndex, atomName, paramNames) {
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

  if (!bodyPath) throw new Error('could not find a function/method to edit');
  const stmts = bodyPath.node.body;
  if (stepIndex < 0 || stepIndex >= stmts.length) throw new Error('step index out of range');

  const replacementCode = buildStepFromAtom(stmts[stepIndex], atomName, paramNames);
  // allowReturnOutsideFunction: buildStepFromAtom can produce a bare
  // "return ...;" (the step being replaced was itself a return), which
  // Babel otherwise rejects as a standalone snippet even though it's about
  // to be spliced back into a real function body below.
  const replacementAst = parser.parse(replacementCode, { sourceType: 'module', allowReturnOutsideFunction: true });
  const newStmt = replacementAst.program.body[0];
  if (!newStmt) throw new Error('could not build a statement from the atom call');
  stmts[stepIndex] = newStmt;

  const output = generate(ast, { retainLines: false }).code;
  if (kind !== 'method') return output;
  const chunks = chunkCode(output);
  return chunks.length ? chunks[0].code : output;
}

function findBody(ast) {
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
  return bodyPath;
}

// Reordering a step's WORD chips (see tokenizeStmt above), block 6: this
// only has a real code meaning in exactly one case -- two `arg` chips
// swapping position within the SAME call's argument list, a true argument
// reorder. Every other requested move (a connective, a verb, two args from
// different calls, more than one displaced position at once) has no
// deterministic code transformation, so the code is returned unchanged with
// a `broken` reason -- the demo still moves the chip visually (the caller's
// job, not this function's) and shows that reason, same red-on-break UX as
// reorderSteps above.
//
// `order`: the full new chip order, as a permutation of ORIGINAL token
// indices (same convention as reorderSteps' statement-level `order`) --
// e.g. [0, 2, 1, 3] swaps the chips originally at positions 1 and 2.
function reorderChip(code, kind, stepIndex, order) {
  const wrapped = kind === 'method' ? `class __W__ {\n${code}\n}` : code;
  const ast = parser.parse(wrapped, { sourceType: 'module' });
  const bodyPath = findBody(ast);
  if (!bodyPath) throw new Error('could not find a function/method to edit');
  const stmts = bodyPath.node.body;
  if (stepIndex < 0 || stepIndex >= stmts.length) throw new Error('step index out of range');
  const stmt = stmts[stepIndex];

  const oldTokens = tokenizeStmt(stmt);
  if (!Array.isArray(order) || order.length !== oldTokens.length) {
    throw new Error('order must be a permutation of every chip in the step');
  }

  // The demo's chip UI only ever displaces two chips at a time (a single
  // drag, or one Alt+Left/Right) -- find those two positions (not
  // necessarily adjacent: a connective often sits between two argument
  // chips), or bail out as "no single swap" if more than two moved.
  const displaced = [];
  for (let pos = 0; pos < order.length; pos++) {
    if (order[pos] !== pos) displaced.push(pos);
  }
  if (displaced.length !== 2 || order[displaced[0]] !== displaced[1] || order[displaced[1]] !== displaced[0]) {
    return { code, broken: { reason: 'that move does not correspond to a single word swap' } };
  }
  const swap = displaced;

  const [posA, posB] = swap;
  const chipA = oldTokens[posA];
  const chipB = oldTokens[posB];
  if (chipA.type !== 'arg' || chipB.type !== 'arg' || chipA.start == null || chipB.start == null) {
    return {
      code,
      broken: { reason: `"${chipB.text}" can't trade places with "${chipA.text}" -- only two argument words can swap, and only within the same call` },
    };
  }

  let callA = null, nodeA = null, nodeB = null;
  traverse(ast, {
    CallExpression(path) {
      path.node.arguments.forEach((arg) => {
        if (arg.start === chipA.start && arg.end === chipA.end) { nodeA = arg; callA = path.node; }
        if (arg.start === chipB.start && arg.end === chipB.end) { nodeB = arg; if (!callA) callA = path.node; }
      });
    },
  });

  if (!nodeA || !nodeB || !callA || !callA.arguments.includes(nodeA) || !callA.arguments.includes(nodeB) || nodeA === nodeB) {
    return {
      code,
      broken: { reason: `"${chipA.text}" and "${chipB.text}" are not arguments of the same call, so swapping them has no code meaning` },
    };
  }

  const argIdxA = callA.arguments.indexOf(nodeA);
  const argIdxB = callA.arguments.indexOf(nodeB);
  [callA.arguments[argIdxA], callA.arguments[argIdxB]] = [callA.arguments[argIdxB], callA.arguments[argIdxA]];

  const output = generate(ast, { retainLines: false }).code;
  if (kind !== 'method') return { code: output, broken: null };
  const chunks = chunkCode(output);
  return { code: chunks.length ? chunks[0].code : output, broken: null };
}

// Block 7 (adding words): every identifier a NEW word could sensibly refer
// to at a given step -- the function/method's own params, plus every name
// declared by an EARLIER step (so a step can't reference something defined
// after it, same ordering rule block 3's use/def check already enforces).
// Shares patternName's destructuring handling so `const [a, b] = args`
// contributes `a` and `b`, not `undefined`.
function collectPatternNames(id) {
  if (id.type === 'Identifier') return [id.name];
  if (id.type === 'ArrayPattern') return id.elements.flatMap((el) => (el ? collectPatternNames(el) : []));
  if (id.type === 'ObjectPattern') return id.properties.flatMap((p) => (p.value ? collectPatternNames(p.value) : []));
  return [];
}

function inScopeIdentifiers(code, kind, stepIndex) {
  const wrapped = kind === 'method' ? `class __W__ {\n${code}\n}` : code;
  const ast = parser.parse(wrapped, { sourceType: 'module' });
  const bodyPath = findBody(ast);
  if (!bodyPath) return [];

  let params = [];
  traverse(ast, {
    ClassMethod(path) { params = path.node.params.map((p) => p.name).filter(Boolean); path.stop(); },
    FunctionDeclaration(path) {
      if (!path.parentPath.isProgram()) return;
      params = path.node.params.map((p) => p.name).filter(Boolean);
      path.stop();
    },
  });

  const stmts = bodyPath.node.body;
  const names = new Set(params);
  for (let idx = 0; idx < stepIndex && idx < stmts.length; idx++) {
    const s = stmts[idx];
    if (s.type === 'VariableDeclaration') {
      s.declarations.forEach((d) => collectPatternNames(d.id).forEach((n) => names.add(n)));
    }
  }
  return [...names];
}

// The one expression a step's chips actually describe -- what buildStepFromAtom
// (block 4) and reorderChip (block 6) each already special-case per statement
// shape. Centralized here since insertAtomCall/insertArgument below both need
// to read AND replace/mutate it.
function stmtExprRef(stmt) {
  if (stmt.type === 'ReturnStatement' && stmt.argument) {
    return { get: () => stmt.argument, set: (v) => { stmt.argument = v; } };
  }
  if (stmt.type === 'ExpressionStatement') {
    return { get: () => stmt.expression, set: (v) => { stmt.expression = v; } };
  }
  if (stmt.type === 'VariableDeclaration' && stmt.declarations.length === 1 && stmt.declarations[0].init) {
    return { get: () => stmt.declarations[0].init, set: (v) => { stmt.declarations[0].init = v; } };
  }
  return null;
}

// "A known atom -> inserted as a call/chain link at that position": appends
// `.atomName(...)` onto the step's own expression, the atom's OWN param
// names (after the first, which becomes the implicit subject/receiver --
// same "same word, same thing" scoping convention buildStepFromAtom already
// relies on) passed straight through as argument identifiers.
function insertAtomCall(code, kind, stepIndex, atomName, paramNames) {
  const wrapped = kind === 'method' ? `class __W__ {\n${code}\n}` : code;
  const ast = parser.parse(wrapped, { sourceType: 'module' });
  const bodyPath = findBody(ast);
  if (!bodyPath) throw new Error('could not find a function/method to edit');
  const stmts = bodyPath.node.body;
  if (stepIndex < 0 || stepIndex >= stmts.length) throw new Error('step index out of range');

  const ref = stmtExprRef(stmts[stepIndex]);
  if (!ref) throw new Error('cannot chain a new atom onto this kind of step');

  const argNames = paramNames.slice(1);
  ref.set(t.callExpression(
    t.memberExpression(ref.get(), t.identifier(atomName)),
    argNames.map((n) => t.identifier(n)),
  ));

  const output = generate(ast, { retainLines: false }).code;
  if (kind !== 'method') return output;
  const chunks = chunkCode(output);
  return chunks.length ? chunks[0].code : output;
}

// "A known in-scope identifier -> inserted as an argument": appended to the
// end of the step's own outermost call's argument list.
function insertArgument(code, kind, stepIndex, identifierName) {
  const wrapped = kind === 'method' ? `class __W__ {\n${code}\n}` : code;
  const ast = parser.parse(wrapped, { sourceType: 'module' });
  const bodyPath = findBody(ast);
  if (!bodyPath) throw new Error('could not find a function/method to edit');
  const stmts = bodyPath.node.body;
  if (stepIndex < 0 || stepIndex >= stmts.length) throw new Error('step index out of range');

  const ref = stmtExprRef(stmts[stepIndex]);
  const expr = ref && ref.get();
  if (!expr || expr.type !== 'CallExpression') throw new Error('this step has no call to add an argument to');
  expr.arguments.push(t.identifier(identifierName));

  const output = generate(ast, { retainLines: false }).code;
  if (kind !== 'method') return output;
  const chunks = chunkCode(output);
  return chunks.length ? chunks[0].code : output;
}

module.exports = {
  toEnglish,
  camelToWords,
  extractAtoms,
  extractAtomUsage,
  reorderSteps,
  atomParamNames,
  buildStepFromAtom,
  applyAtomToStep,
  tokenizeStmt,
  reorderChip,
  inScopeIdentifiers,
  insertAtomCall,
  insertArgument,
};
