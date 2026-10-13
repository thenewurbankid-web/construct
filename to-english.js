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

// Placeholder sink: while toEnglish() renders a step, every fallback branch
// below records {kind, type, start, end} here, so callers get a structured
// list of what did not translate instead of having to grep the English.
let missSink = null;
function miss(kind, node) {
  if (missSink) missSink.push({ kind, type: node ? node.type : 'unknown', start: node && node.start != null ? node.start : null, end: node && node.end != null ? node.end : null });
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
      miss('expr', node);
      return '(...)';
  }
}

// A declarator's `id` isn't always a plain Identifier -- destructuring
// (const [a, b] = args, the shape transform.js's extraction step itself
// produces for a multi-param original) gives an ArrayPattern/ObjectPattern
// instead, whose .name is undefined. Recurses so nested patterns
// ([a, [b, c]]) still render as something readable instead of "undefined".
function patternName(id) {
  if (id.type === 'Identifier') return id.name;
  if (id.type === 'ArrayPattern') return `[${id.elements.map((el) => (el ? patternName(el) : '')).join(', ')}]`;
  if (id.type === 'ObjectPattern') return `{${id.properties.map((p) => (p.key ? patternName(p.key) : '')).join(', ')}}`;
  miss('pattern', id);
  return '?';
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
        .map((d) => `let ${patternName(d.id)} be ${d.init ? exprToEnglish(d.init) : 'undefined'}`)
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
      miss('stmt', node);
      return '(a step that does not translate cleanly)';
  }
}

// Token-producing mirror of exprToEnglish/stmtToEnglish below: same shape of
// switch, but instead of concatenating a string, each branch emits chips --
// {text, type, start, end} -- start/end are the SOURCE node this chip came
// from (so the demo can map a chip back to code), omitted for connectives
// that don't correspond to a single node ("and", ":", "otherwise", ...).
// A multi-word atom/verb name (camelToWords splits it into several English
// words) is still ONE chip, mapped to the one callee/property node it came
// from -- the words belong together and must move together.
function tokenizeSubject(node) {
  if (node.type === 'Identifier') {
    return [{ text: node.name === 'this' ? 'it' : node.name, type: 'subject', start: node.start, end: node.end }];
  }
  if (node.type === 'ThisExpression') {
    return [{ text: 'it', type: 'subject', start: node.start, end: node.end }];
  }
  return tokenizeExpr(node);
}

function tokenizeArgs(nodes) {
  const out = [];
  nodes.map(tokenizeExpr).forEach((tokens, i) => {
    if (i > 0) out.push({ text: 'and', type: 'connective' });
    out.push(...tokens);
  });
  return out;
}

function tokenizeExpr(node) {
  if (!node) return [];
  switch (node.type) {
    case 'Identifier':
      return [{ text: node.name === 'this' ? 'it' : node.name, type: 'arg', start: node.start, end: node.end }];
    case 'ThisExpression':
      return [{ text: 'it', type: 'arg', start: node.start, end: node.end }];
    case 'StringLiteral':
      return [{ text: `'${node.value}'`, type: 'arg', start: node.start, end: node.end }];
    case 'NumericLiteral':
    case 'BooleanLiteral':
      return [{ text: String(node.value), type: 'arg', start: node.start, end: node.end }];
    case 'NullLiteral':
      return [{ text: 'nothing', type: 'arg', start: node.start, end: node.end }];
    case 'MemberExpression':
      if (node.computed) {
        return [...tokenizeSubject(node.object), { text: 'at', type: 'connective' }, ...tokenizeExpr(node.property)];
      }
      return [...tokenizeSubject(node.object), { text: camelToWords(node.property.name || ''), type: 'verb', start: node.property.start, end: node.property.end }];
    case 'UnaryExpression':
      if (node.operator === '!') return [{ text: 'not', type: 'connective' }, ...tokenizeExpr(node.argument)];
      return [{ text: node.operator, type: 'connective' }, ...tokenizeExpr(node.argument)];
    case 'CallExpression': {
      const callee = node.callee;
      const argTokens = tokenizeArgs(node.arguments);
      if (callee.type === 'MemberExpression') {
        const subject = tokenizeSubject(callee.object);
        const verb = { text: camelToWords(callee.property.name || ''), type: 'verb', start: callee.property.start, end: callee.property.end };
        return [...subject, verb, ...argTokens];
      }
      const fn = { text: camelToWords(callee.name || ''), type: 'verb', start: callee.start, end: callee.end };
      return argTokens.length ? [fn, { text: 'of', type: 'connective' }, ...argTokens] : [fn];
    }
    case 'ArrowFunctionExpression':
      if (node.body.type === 'BlockStatement') return tokenizeBlock(node.body);
      return tokenizeExpr(node.body);
    case 'NewExpression': {
      const argTokens = tokenizeArgs(node.arguments);
      const head = [{ text: 'a new', type: 'connective' }, { text: node.callee.name, type: 'verb', start: node.callee.start, end: node.callee.end }];
      return argTokens.length ? [...head, { text: 'of', type: 'connective' }, ...argTokens] : head;
    }
    case 'BinaryExpression':
      return [...tokenizeExpr(node.left), { text: node.operator, type: 'connective' }, ...tokenizeExpr(node.right)];
    case 'AssignmentExpression':
      return [{ text: 'set', type: 'connective' }, ...tokenizeExpr(node.left), { text: 'to', type: 'connective' }, ...tokenizeExpr(node.right)];
    default:
      return [{ text: '(...)', type: 'connective' }];
  }
}

function tokenizeBlock(node, depth) {
  if (!node) return [];
  if (node.type === 'BlockStatement') {
    const out = [];
    node.body.forEach((s, i) => {
      if (i > 0) out.push({ text: 'then', type: 'connective' });
      out.push(...tokenizeStmt(s, depth));
    });
    return out;
  }
  return tokenizeStmt(node, depth);
}

function tokenizeStmt(node, depth = 0) {
  switch (node.type) {
    case 'ReturnStatement':
      return node.argument
        ? [{ text: 'return', type: 'connective' }, ...tokenizeExpr(node.argument)]
        : [{ text: 'return', type: 'connective' }];
    case 'ExpressionStatement':
      return tokenizeExpr(node.expression);
    case 'VariableDeclaration': {
      const out = [];
      node.declarations.forEach((d, i) => {
        if (i > 0) out.push({ text: ',', type: 'connective' });
        out.push({ text: 'let', type: 'connective' });
        out.push({ text: patternName(d.id), type: 'subject', start: d.id.start, end: d.id.end });
        out.push({ text: 'be', type: 'connective' });
        out.push(...(d.init ? tokenizeExpr(d.init) : [{ text: 'undefined', type: 'arg' }]));
      });
      return out;
    }
    case 'IfStatement': {
      const out = [
        { text: 'if', type: 'connective' },
        ...tokenizeExpr(node.test),
        { text: ':', type: 'connective' },
        ...tokenizeBlock(node.consequent, depth + 1),
      ];
      if (node.alternate) out.push({ text: 'otherwise', type: 'connective' }, ...tokenizeBlock(node.alternate, depth + 1));
      return out;
    }
    case 'ForInStatement':
    case 'ForOfStatement': {
      const kw = node.type === 'ForInStatement' ? 'in' : 'of';
      const varTokens = node.left.declarations
        ? [{ text: node.left.declarations[0].id.name, type: 'subject', start: node.left.declarations[0].id.start, end: node.left.declarations[0].id.end }]
        : tokenizeExpr(node.left);
      return [
        { text: 'for each', type: 'connective' },
        ...varTokens,
        { text: kw, type: 'connective' },
        ...tokenizeExpr(node.right),
        { text: ':', type: 'connective' },
        ...tokenizeBlock(node.body, depth + 1),
      ];
    }
    case 'BlockStatement':
      return tokenizeBlock(node, depth);
    default:
      return [{ text: '(a step that does not translate cleanly)', type: 'connective' }];
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
    missSink = [];
    let english;
    try {
      english = stmtToEnglish(s);
    } finally {
      var stepMisses = missSink.map(shift);
      missSink = null;
    }
    return {
    english,
    unhandled: stepMisses,
    code: wrapped.slice(s.start, s.end),
    start: s.start - prefixLen,
    end: s.end - prefixLen,
    // Same step, as chips instead of a flat string -- each chip's start/end
    // (when present) are shifted by the same class-wrapper offset as the
    // step's own start/end, so both stay in the same coordinate space as
    // `code` above.
    tokens: tokenizeStmt(s).map((tok) => ({
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
