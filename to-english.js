const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const generate = require('@babel/generator').default;
const t = require('@babel/types');
const { chunkCode } = require('./chunker');
const { canonicalizeFunction, booleanBindings } = require('./canonical');
const plainWords = require('./plain-words');

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
// `style` is 'plain' (the default: calls read as their result, operators in
// words) or 'exact' (the original word-for-word reading). `bools` is the set
// of names known to be boolean in the function being described (canonical.js's
// inference), used to tell "not x" from "there is no x".
function makeOut(settings) {
  return {
    items: [], unhandled: [], optDepth: 0, jsxDepth: 0,
    style: settings && settings.style === 'exact' ? 'exact' : 'plain',
    bools: (settings && settings.bools) || new Set(),
  };
}

const isPlain = (out) => out.style === 'plain';

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

// Renders a sub-expression to a plain string inside a pattern label (a
// default value, a computed key), keeping any unhandled entries it hits.
function inlineEnglish(node, out) {
  const sub = makeOut(out);
  walkExpr(node, sub);
  out.unhandled.push(...sub.unhandled);
  return render(sub.items);
}

function keyName(key) {
  if (key.type === 'Identifier') return key.name;
  if (key.type === 'PrivateName') return key.id.name;
  if (key.type === 'StringLiteral') return `'${key.value}'`;
  if (key.value != null) return String(key.value);
  return null;
}

// A binding pattern as one label: the name(s) it binds, in code-like
// shape. `const [a, b] = args` -> "[a, b]"; `{ a, b: c, d = 1, ...rest }`
// -> "{a, b as c, d (default 1), ...rest}" -- rename-aware: `b: c` binds c,
// read from b, so both names appear.
function patternName(id, out) {
  switch (id.type) {
    case 'Identifier':
      return id.name;
    case 'ArrayPattern':
      return `[${id.elements.map((el) => (el ? patternName(el, out) : '')).join(', ')}]`;
    case 'ObjectPattern':
      return `{${id.properties.map((p) => {
        if (p.type === 'RestElement') return patternName(p, out);
        const value = patternName(p.value, out);
        if (p.shorthand) return value;
        const key = p.computed ? `[${inlineEnglish(p.key, out)}]` : keyName(p.key);
        return `${key} as ${value}`;
      }).join(', ')}}`;
    case 'RestElement':
      return `...${patternName(id.argument, out)}`;
    case 'AssignmentPattern':
      return `${patternName(id.left, out)} (default ${inlineEnglish(id.right, out)})`;
    case 'TSParameterProperty':
      return patternName(id.parameter, out);
    case 'TSAsExpression':
    case 'TSSatisfiesExpression':
    case 'TSTypeAssertion':
    case 'TSNonNullExpression':
      return patternName(id.expression, out);
    case 'MemberExpression':
    case 'OptionalMemberExpression':
      return inlineEnglish(id, out);
    case 'VoidPattern':
      return '(ignored)';
    default:
      noteUnhandled(out, 'pattern', id);
      return PLACEHOLDER_TEXT.pattern;
  }
}

// Identifier/this read as the SUBJECT of whatever follows (a.equals(b): "a"
// is the subject); anything else is just an expression in that position.
function walkSubject(node, out) {
  if (node.type === 'Identifier') return chip(out, node.name === 'this' ? 'it' : node.name, 'subject', node);
  if (node.type === 'ThisExpression') return chip(out, 'it', 'subject', node);
  return walkExpr(node, out);
}

// An expression that is NOT part of the current optional chain's spine (a
// call argument, a computed key, a list element): it starts its own chain.
function walkDetached(node, out) {
  const saved = out.optDepth;
  const savedTest = out.inTest;
  out.optDepth = 0;
  out.inTest = false;
  walkExpr(node, out);
  out.optDepth = saved;
  out.inTest = savedTest;
}

// Walks a condition: a yes/no position where plain style drops "whether".
function walkTest(node, out) {
  const saved = out.inTest;
  out.inTest = true;
  walkExpr(node, out);
  out.inTest = saved;
}

function walkList(nodes, out, sep = 'and') {
  nodes.forEach((n, i) => {
    if (i > 0) chip(out, sep, 'connective');
    if (n === null) chip(out, 'an empty slot', 'arg');
    else walkDetached(n, out);
  });
}

function walkArgs(nodes, out) {
  walkList(nodes, out);
}

// `a?.b`, `a?.()`: the whole chain is "nothing" when any optional link is
// missing, so "(if any)" is said once, after the outermost link.
function walkOptionalRoot(node, out, walkInner) {
  if (out.optDepth > 0) return walkInner();
  out.optDepth++;
  walkInner();
  out.optDepth--;
  chip(out, '(if any)', 'connective');
}

function walkMember(node, out) {
  walkSubject(node.object, out);
  if (node.computed) {
    chip(out, 'at', 'connective');
    return walkDetached(node.property, out);
  }
  glue(out, "'s", { glueL: true });
  return chip(out, propertyWords(node.property), 'verb', node.property);
}

function propertyWords(prop) {
  return camelToWords(prop.name || (prop.id && prop.id.name) || '');
}

// A known-boolean value (plain style): a comparison, a '!', a ': boolean'
// binding, a yes/no call by name (startsWith, isValid, includes ...), or
// and/or of those.
function isBooleanish(e, out) {
  if (!e) return false;
  switch (e.type) {
    case 'BooleanLiteral':
      return true;
    case 'UnaryExpression':
      return e.operator === '!';
    case 'BinaryExpression':
      return ['===', '!==', '==', '!=', '<', '>', '<=', '>=', 'instanceof', 'in'].includes(e.operator);
    case 'Identifier':
      return out.bools.has(e.name);
    case 'LogicalExpression':
      return (e.operator === '&&' || e.operator === '||') && isBooleanish(e.left, out) && isBooleanish(e.right, out);
    case 'CallExpression':
    case 'OptionalCallExpression': {
      const c = e.callee;
      const name = c.type === 'Identifier' ? c.name : c.property && !c.computed ? c.property.name || (c.property.id && c.property.id.name) : null;
      return !!name && plainWords.BOOLEAN_CALL.test(name);
    }
    case 'TSAsExpression':
      return !!e.typeAnnotation && e.typeAnnotation.type === 'TSBooleanKeyword';
    case 'TSNonNullExpression':
    case 'ParenthesizedExpression':
      return isBooleanish(e.expression, out);
    default:
      return false;
  }
}

function walkJoined(nodes, out, sep = 'and') {
  nodes.forEach((n, i) => {
    if (i > 0) chip(out, sep, 'connective');
    walkDetached(n, out);
  });
}

// Plain style: a call reads as its result (plain-words.js has the tables).
// Returns false when no plain reading applies, so the exact one is used.
function plainCall(node, out) {
  const callee = node.callee;
  let name;
  let receiver = null;
  if (callee.type === 'Identifier') {
    name = callee.name;
  } else if ((callee.type === 'MemberExpression' || callee.type === 'OptionalMemberExpression') && !callee.computed) {
    name = callee.property.name || (callee.property.id && callee.property.id.name);
    receiver = callee.object;
  }
  if (!name) return false;
  const calleeNode = receiver ? callee.property : callee;
  const [verb, ...rest] = camelToWords(name).split(' ').filter(Boolean);
  const noun = rest.join(' ');
  const args = node.arguments;
  if (args.some((a) => a.type === 'SpreadElement' || a.type === 'ArgumentPlaceholder')) return false;
  const rule = noun ? plainWords.PREFIX_RULES[verb] : null;
  // The subject `a` of the table: a method's receiver, or a free function's
  // first argument; `extra` are the remaining arguments.
  const subject = receiver ? [receiver] : args.slice(0, 1);
  const extra = receiver ? args : args.slice(1);
  const walkSubjectOf = () => (receiver ? walkSubject(receiver, out) : walkDetached(args[0], out));
  const withExtra = (word = 'with') => {
    if (!extra.length) return;
    chip(out, word, 'connective');
    walkJoined(extra, out);
  };
  if (rule === 'the-for') {
    if (receiver) {
      walkSubject(receiver, out);
      glue(out, "'s", { glueL: true });
      chip(out, noun, 'verb', calleeNode);
      if (args.length) {
        chip(out, 'for', 'connective');
        walkJoined(args, out);
      }
      return true;
    }
    chip(out, 'the', 'connective');
    chip(out, noun, 'verb', calleeNode);
    if (args.length) {
      chip(out, 'for', 'connective');
      walkJoined(args, out);
    }
    return true;
  }
  if (!rule && !receiver && noun && args.length && plainWords.VERBS.has(verb)) {
    walkJoined(args, out);
    chip(out, 'with', 'connective');
    chip(out, `${noun} ${plainWords.pastParticiple(verb)}`, 'verb', calleeNode);
    return true;
  }
  if (!rule || !subject.length) return false;
  if (rule === 'whether') {
    // Inside a condition ("if a and b is X") the "whether" is implied.
    if (!out.inTest) chip(out, 'whether', 'connective');
    walkSubjectOf();
    chip(out, `${verb} ${noun}`, 'verb', calleeNode);
    walkJoined(extra, out);
    return true;
  }
  if (rule === 'new-from') {
    chip(out, 'a new', 'connective');
    chip(out, noun, 'verb', calleeNode);
    chip(out, 'from', 'connective');
    walkSubjectOf();
    withExtra();
    return true;
  }
  const PHRASE = { as: 'as', 'formatted-as': 'formatted as', 'converted-to': 'converted to', 'parsed-as': 'parsed as' };
  walkSubjectOf();
  // convertToDate: the noun already starts with "to".
  const object = rule === 'converted-to' ? noun.replace(/^to /, '') : noun;
  chip(out, `${PHRASE[rule]} ${object}`, 'verb', calleeNode);
  withExtra();
  return true;
}

function walkCall(node, out) {
  const callee = node.callee;
  if (isPlain(out) && plainCall(node, out)) return;
  if ((callee.type === 'MemberExpression' || callee.type === 'OptionalMemberExpression') && !callee.computed) {
    walkSubject(callee.object, out);
    chip(out, propertyWords(callee.property), 'verb', callee.property);
    return walkArgs(node.arguments, out);
  }
  if (callee.type === 'Identifier') {
    chip(out, camelToWords(callee.name), 'verb', callee);
    if (node.arguments.length) {
      chip(out, 'of', 'connective');
      walkArgs(node.arguments, out);
    }
    return;
  }
  // Any other callee -- a computed lookup (handlers[name](e)), an IIFE, a
  // call result (f(a)(b)), super(...) -- has no name to use as a verb (it
  // used to render as an empty one), so it reads "call <callee> with <args>".
  chip(out, 'call', 'connective');
  walkExpr(callee, out);
  if (node.arguments.length) {
    chip(out, 'with', 'connective');
    walkArgs(node.arguments, out);
  }
}

// A template's text pieces and ${} values, in order: "text of 'Hi ' and name".
function walkTemplateParts(tpl, out) {
  const parts = [];
  tpl.quasis.forEach((q, i) => {
    const text = q.value.cooked != null ? q.value.cooked : q.value.raw;
    if (text !== '') parts.push({ q, text });
    if (i < tpl.expressions.length) parts.push({ e: tpl.expressions[i] });
  });
  parts.forEach((p, i) => {
    if (i > 0) chip(out, 'and', 'connective');
    if (p.e) walkDetached(p.e, out);
    else chip(out, `'${p.text}'`, 'arg', p.q);
  });
}

const LOGICAL_WORDS = { '&&': 'and', '||': 'or', '??': 'if present, otherwise' };
const UNARY_WORDS = { typeof: 'the type of', void: 'nothing, after', delete: 'delete' };

function walkFunctionValue(node, out) {
  // Renders the closure's BODY, not the closure itself -- "() => x" reads as
  // just "x". Without this, any call taking a callback (like
  // ifIt/elseIfIt/elseIt) rendered every argument as a bare "(...)"
  // placeholder, losing the actual condition/result entirely.
  const saved = out.optDepth;
  out.optDepth = 0;
  if (node.body.type === 'BlockStatement') walkBlock(node.body, out);
  else walkExpr(node.body, out);
  out.optDepth = saved;
}

// ---- JSX -----------------------------------------------------------------
// "shows a <Tag> with attr as value and flag containing 'text' and a <Child>".
// Only the outermost element says "shows"; nested ones read "a <li> ...".
function jsxName(n) {
  if (n.type === 'JSXIdentifier') return n.name;
  if (n.type === 'JSXMemberExpression') return `${jsxName(n.object)}.${jsxName(n.property)}`;
  if (n.type === 'JSXNamespacedName') return `${n.namespace.name}:${n.name.name}`;
  return '?';
}

function meaningfulChildren(children) {
  return children.filter((c) => {
    if (c.type === 'JSXText') return c.value.trim() !== '';
    if (c.type === 'JSXExpressionContainer') return c.expression.type !== 'JSXEmptyExpression';
    return true;
  });
}

function walkJsxValue(node, out) {
  if (node.type === 'JSXExpressionContainer') {
    if (node.expression.type === 'JSXEmptyExpression') return chip(out, 'nothing', 'arg', node);
    return walkDetached(node.expression, out);
  }
  if (node.type === 'JSXText') return chip(out, `'${node.value.replace(/\s+/g, ' ').trim()}'`, 'arg', node);
  if (node.type === 'JSXSpreadChild') {
    chip(out, 'everything in', 'connective');
    return walkDetached(node.expression, out);
  }
  return walkDetached(node, out);
}

function walkJsx(node, out) {
  const nested = out.jsxDepth > 0;
  out.jsxDepth++;
  if (node.type === 'JSXFragment') {
    chip(out, nested ? 'a group' : 'shows a group', 'connective');
  } else {
    const open = node.openingElement;
    chip(out, nested ? 'a' : 'shows a', 'connective');
    chip(out, `<${jsxName(open.name)}>`, 'verb', open.name);
    if (open.attributes.length) {
      chip(out, 'with', 'connective');
      open.attributes.forEach((a, i) => {
        if (i > 0) chip(out, 'and', 'connective');
        if (a.type === 'JSXSpreadAttribute') {
          chip(out, 'everything in', 'connective');
          return walkDetached(a.argument, out);
        }
        chip(out, jsxName(a.name), 'subject', a.name);
        if (a.value) {
          chip(out, 'as', 'connective');
          walkJsxValue(a.value, out);
        }
      });
    }
  }
  const kids = meaningfulChildren(node.children);
  if (kids.length) {
    chip(out, 'containing', 'connective');
    kids.forEach((c, i) => {
      if (i > 0) chip(out, 'and', 'connective');
      walkJsxValue(c, out);
    });
  }
  out.jsxDepth--;
}

// ---- expressions ----------------------------------------------------------
// One rule per Babel Expression type (smith-coverage.test.js checks the
// table against @babel/types, so a new node type can't silently fall back to
// "(...)").
const transparent = (node, out) => walkExpr(node.expression, out);

const EXPR_RULES = {
  Identifier: (node, out) => chip(out, node.name === 'this' ? 'it' : node.name, 'arg', node),
  ThisExpression: (node, out) => chip(out, 'it', 'arg', node),
  Super: (node, out) => chip(out, 'the parent', 'subject', node),
  Import: (node, out) => chip(out, 'import', 'verb', node),
  PrivateName: (node, out) => chip(out, camelToWords(node.id.name), 'verb', node),
  StringLiteral: (node, out) => chip(out, `'${node.value}'`, 'arg', node),
  NumericLiteral: (node, out) => chip(out, String(node.value), 'arg', node),
  BooleanLiteral: (node, out) => chip(out, String(node.value), 'arg', node),
  BigIntLiteral: (node, out) => chip(out, String(node.value), 'arg', node),
  NullLiteral: (node, out) => chip(out, 'nothing', 'arg', node),
  RegExpLiteral: (node, out) => chip(out, `the pattern /${node.pattern}/${node.flags}`, 'arg', node),
  TemplateLiteral: (node, out) => {
    if (isPlain(out)) {
      // the text "{href}/": one chip, the ${} parts inline in braces.
      const text = node.quasis.map((q, i) => {
        const raw = q.value.cooked != null ? q.value.cooked : q.value.raw;
        return i < node.expressions.length ? `${raw}{${inlineEnglish(node.expressions[i], out)}}` : raw;
      }).join('');
      return chip(out, `the text "${text}"`, 'arg', node);
    }
    if (!node.expressions.length) {
      const q = node.quasis[0];
      return chip(out, `'${q.value.cooked != null ? q.value.cooked : q.value.raw}'`, 'arg', node);
    }
    chip(out, 'text of', 'connective');
    return walkTemplateParts(node, out);
  },
  TaggedTemplateExpression: (node, out) => {
    if (node.tag.type === 'Identifier') chip(out, camelToWords(node.tag.name), 'verb', node.tag);
    else walkExpr(node.tag, out);
    chip(out, 'of', 'connective');
    if (!node.quasi.expressions.length) return EXPR_RULES.TemplateLiteral(node.quasi, out);
    return walkTemplateParts(node.quasi, out);
  },
  // computed: true is bracket notation with a dynamic key (obj[x]) --
  // property is a VALUE expression (a variable, a literal), not a fixed
  // field name, so it must be rendered as an expression, not word-split
  // like a property name. Treating both cases the same was the bug:
  // this.rules[name] rendered as "rules's name" (implying a literal nested
  // field this.rules.name), when it's actually a lookup BY the variable name.
  MemberExpression: walkMember,
  OptionalMemberExpression: (node, out) => walkOptionalRoot(node, out, () => walkMember(node, out)),
  CallExpression: walkCall,
  OptionalCallExpression: (node, out) => walkOptionalRoot(node, out, () => walkCall(node, out)),
  ImportExpression: (node, out) => {
    chip(out, 'load module', 'verb', null);
    chip(out, 'of', 'connective');
    return walkArgs(node.options ? [node.source, node.options] : [node.source], out);
  },
  NewExpression: (node, out) => {
    chip(out, 'a new', 'connective');
    const callee = node.callee;
    if (callee.type === 'Identifier') {
      chip(out, callee.name, 'verb', callee);
    } else if ((callee.type === 'MemberExpression') && !callee.computed) {
      // new a.B() used to read "a new undefined": the class is B, from a.
      chip(out, callee.property.name, 'verb', callee.property);
      chip(out, 'from', 'connective');
      walkSubject(callee.object, out);
    } else {
      walkExpr(callee, out);
    }
    if (node.arguments.length) {
      chip(out, 'of', 'connective');
      walkArgs(node.arguments, out);
    }
  },
  UnaryExpression: (node, out) => {
    if (node.operator === '!' && isPlain(out)) {
      // Not known boolean: '!x' is a check that x is missing/empty.
      if (!isBooleanish(node.argument, out)) {
        chip(out, 'there is no', 'connective');
        return walkExpr(node.argument, out);
      }
      chip(out, 'not', 'connective');
      const simple = ['Identifier', 'MemberExpression', 'OptionalMemberExpression', 'CallExpression', 'OptionalCallExpression', 'ThisExpression'].includes(node.argument.type);
      if (simple || isGrouped(node.argument)) return walkTest(node.argument, out);
      glue(out, '(', { glueR: true });
      walkTest(node.argument, out);
      return glue(out, ')', { glueL: true });
    }
    if (node.operator === '!') {
      chip(out, 'not', 'connective');
      if (isGrouped(node.argument)) return walkExpr(node.argument, out);
      glue(out, '(', { glueR: true });
      walkExpr(node.argument, out);
      return glue(out, ')', { glueL: true });
    }
    if (UNARY_WORDS[node.operator]) {
      chip(out, UNARY_WORDS[node.operator], 'connective');
      return walkExpr(node.argument, out);
    }
    chip(out, node.operator, 'connective', null, { glueR: true });
    return walkExpr(node.argument, out);
  },
  UpdateExpression: (node, out) => {
    chip(out, node.operator === '++' ? 'increase' : 'decrease', 'connective');
    walkExpr(node.argument, out);
    chip(out, 'by 1', 'connective');
  },
  BinaryExpression: (node, out) => {
    walkExpr(node.left, out);
    chip(out, (isPlain(out) && plainWords.PLAIN_BINARY[node.operator]) || node.operator, 'connective');
    walkExpr(node.right, out);
  },
  LogicalExpression: (node, out) => {
    const operand = node.operator === '??' ? walkExpr : walkTest;
    operand(node.left, out);
    chip(out, (isPlain(out) ? plainWords.PLAIN_LOGICAL : LOGICAL_WORDS)[node.operator] || node.operator, 'connective');
    operand(node.right, out);
  },
  ConditionalExpression: (node, out) => {
    chip(out, 'if', 'connective');
    walkTest(node.test, out);
    chip(out, 'then', 'connective');
    walkExpr(node.consequent, out);
    chip(out, 'otherwise', 'connective', null, { en: ', otherwise', glueL: true });
    walkExpr(node.alternate, out);
  },
  AssignmentExpression: (node, out) => {
    const op = node.operator;
    if (op === '+=' || op === '-=') {
      chip(out, op === '+=' ? 'add' : 'subtract', 'connective');
      walkExpr(node.right, out);
      chip(out, op === '+=' ? 'to' : 'from', 'connective');
      return walkExpr(node.left, out);
    }
    chip(out, 'set', 'connective');
    walkExpr(node.left, out);
    chip(out, 'to', 'connective');
    if (op !== '=') {
      const bare = op.slice(0, -1);
      walkExpr(node.left, out);
      chip(out, LOGICAL_WORDS[bare] || bare, 'connective');
    }
    walkExpr(node.right, out);
  },
  SequenceExpression: (node, out) => {
    node.expressions.forEach((e, i) => {
      if (i > 0) chip(out, 'then', 'connective', null, { en: ', then', glueL: true });
      walkExpr(e, out);
    });
  },
  ParenthesizedExpression: transparent,
  ArrowFunctionExpression: walkFunctionValue,
  FunctionExpression: walkFunctionValue,
  ClassExpression: (node, out) => {
    chip(out, 'a class', 'connective');
    if (node.id) chip(out, node.id.name, 'verb', node.id);
  },
  MetaProperty: (node, out) => chip(out, `${node.meta.name}.${node.property.name}`, 'arg', node),
  YieldExpression: (node, out) => {
    chip(out, node.delegate ? 'yield each of' : 'yield', 'connective');
    walkExpr(node.argument, out);
  },
  AwaitExpression: (node, out) => {
    chip(out, 'wait for', 'connective');
    walkExpr(node.argument, out);
  },
  SpreadElement: (node, out) => {
    chip(out, 'everything in', 'connective');
    walkExpr(node.argument, out);
  },
  ArgumentPlaceholder: (node, out) => chip(out, 'a value given later', 'arg', node),
  ObjectExpression: (node, out) => {
    if (!node.properties.length) return chip(out, 'an empty object', 'arg', node);
    chip(out, 'an object with', 'connective');
    node.properties.forEach((p, i) => {
      if (i > 0) chip(out, 'and', 'connective');
      if (p.type === 'SpreadElement') return EXPR_RULES.SpreadElement(p, out);
      if (p.type === 'ObjectProperty' && p.shorthand) return walkDetached(p.value, out);
      if (p.computed) {
        chip(out, 'key', 'connective');
        walkDetached(p.key, out);
      } else {
        chip(out, keyName(p.key), 'subject', p.key);
      }
      chip(out, 'as', 'connective');
      if (p.type === 'ObjectMethod') return walkFunctionValue(p, out);
      return walkDetached(p.value, out);
    });
  },
  ArrayExpression: (node, out) => {
    if (!node.elements.length) return chip(out, 'an empty list', 'arg', node);
    chip(out, 'a list of', 'connective');
    walkList(node.elements, out);
  },
  JSXElement: walkJsx,
  JSXFragment: walkJsx,
  // Types are erased at runtime, so a type assertion reads as its value.
  TSAsExpression: transparent,
  TSSatisfiesExpression: transparent,
  TSTypeAssertion: transparent,
  TSNonNullExpression: transparent,
  TSInstantiationExpression: transparent,
  TypeCastExpression: transparent,
  BindExpression: (node, out) => {
    if (node.object) walkSubject(node.object, out);
    chip(out, 'bound to', 'connective');
    walkExpr(node.callee, out);
  },
  DoExpression: (node, out) => walkBlock(node.body, out),
  ModuleExpression: (node, out) => chip(out, 'an inline module', 'arg', node),
  TopicReference: (node, out) => chip(out, 'the piped value', 'arg', node),
  PipelineBareFunction: (node, out) => walkExpr(node.callee, out),
  PipelinePrimaryTopicReference: (node, out) => chip(out, 'the piped value', 'arg', node),
  PipelineTopicExpression: transparent,
};

// Operators whose grouping changes the meaning: when the source wrote them in
// parentheses, the sentence keeps the parentheses (glue only, never a chip),
// so `sum * (1 - d)` doesn't read as "sum * 1 - d".
const GROUPED = new Set(['BinaryExpression', 'LogicalExpression', 'ConditionalExpression', 'AssignmentExpression', 'SequenceExpression']);

function isGrouped(node) {
  return !!(node && node.extra && node.extra.parenthesized && GROUPED.has(node.type));
}

function walkExpr(node, out) {
  if (!node) return;
  const rule = EXPR_RULES[node.type];
  if (!rule) return placeholder(out, 'expr', node);
  if (!isGrouped(node)) return rule(node, out);
  glue(out, '(', { glueR: true });
  rule(node, out);
  glue(out, ')', { glueL: true });
}

function walkBlock(node, out) {
  if (!node) return;
  if (node.type === 'BlockStatement') {
    walkStmtList(node.body, out);
    return;
  }
  walkStmt(node, out);
}

function walkStmtList(stmts, out) {
  stmts.forEach((s, i) => {
    if (i > 0) chip(out, 'then', 'connective', null, { en: '; then', glueL: true });
    walkStmt(s, out);
  });
}

// "return x"; in plain style a yes/no value reads "return whether x" (unless
// its own reading already starts with "whether").
function walkReturn(arg, out) {
  chip(out, 'return', 'connective');
  if (!arg) return;
  if (!isPlain(out) || !isBooleanish(arg, out) || arg.type === 'BooleanLiteral') return walkExpr(arg, out);
  const sub = makeOut(out);
  sub.optDepth = out.optDepth;
  walkExpr(arg, sub);
  if (!(sub.items[0] && sub.items[0].en === 'whether')) chip(out, 'whether', 'connective');
  out.items.push(...sub.items);
  out.unhandled.push(...sub.unhandled);
}

function colon(out) {
  chip(out, ':', 'connective', null, { glueL: true });
}

function walkParams(params, out) {
  params.forEach((p, i) => {
    if (i > 0) chip(out, 'and', 'connective');
    chip(out, patternName(p, out), 'subject', p);
  });
}

// "define the type Props", "define a class Store" -- a declaration inside a
// body is named, not expanded.
function definesNamed(label) {
  return (node, out) => {
    chip(out, label, 'connective');
    const id = node.id;
    if (id) chip(out, id.type === 'StringLiteral' ? id.value : id.name || jsxName(id), 'verb', id);
  };
}

// switch cases with an empty body fall through into the next one, so they
// share its sentence: "when 'a' or 'b': ...".
function walkSwitch(node, out) {
  chip(out, 'depending on', 'connective');
  walkExpr(node.discriminant, out);
  colon(out);
  let pending = [];
  let first = true;
  node.cases.forEach((c, idx) => {
    pending.push(c);
    const isLast = idx === node.cases.length - 1;
    if (!c.consequent.length && !isLast) return;
    if (!first) glue(out, ';', { glueL: true });
    first = false;
    const tests = pending.filter((p) => p.test);
    const hasDefault = pending.some((p) => !p.test);
    if (tests.length) {
      chip(out, 'when', 'connective');
      tests.forEach((p, i) => {
        if (i > 0) chip(out, 'or', 'connective');
        walkExpr(p.test, out);
      });
    }
    if (hasDefault) chip(out, tests.length ? 'or otherwise' : 'otherwise', 'connective');
    colon(out);
    let body = c.consequent.length === 1 && c.consequent[0].type === 'BlockStatement' ? c.consequent[0].body : c.consequent;
    const last = body[body.length - 1];
    if (last && last.type === 'BreakStatement' && !last.label) body = body.slice(0, -1);
    if (body.length) walkStmtList(body, out);
    else chip(out, 'nothing', 'connective');
    pending = [];
  });
}

const STMT_RULES = {
  ReturnStatement: (node, out) => walkReturn(node.argument, out),
  ExpressionStatement: (node, out) => walkExpr(node.expression, out),
  VariableDeclaration: (node, out) => {
    node.declarations.forEach((d, i) => {
      if (i > 0) chip(out, ',', 'connective', null, { glueL: true });
      chip(out, 'let', 'connective');
      chip(out, patternName(d.id, out), 'subject', d.id);
      chip(out, 'be', 'connective');
      if (d.init) walkExpr(d.init, out);
      else chip(out, 'undefined', 'arg');
    });
  },
  IfStatement: (node, out) => {
    chip(out, 'if', 'connective');
    walkTest(node.test, out);
    if (isPlain(out)) chip(out, ',', 'connective', null, { glueL: true });
    else colon(out);
    walkBlock(node.consequent, out);
    if (node.alternate) {
      chip(out, 'otherwise', 'connective', null, { en: ', otherwise', glueL: true });
      walkBlock(node.alternate, out);
    }
  },
  ForInStatement: walkForEach,
  ForOfStatement: walkForEach,
  ForStatement: (node, out) => {
    if (node.init) {
      chip(out, 'starting with', 'connective');
      if (node.init.type === 'VariableDeclaration') walkStmt(node.init, out);
      else walkExpr(node.init, out);
    }
    const lead = !!node.init;
    if (node.test) {
      chip(out, 'repeat while', 'connective', null, lead && { en: ', repeat while', glueL: true });
      walkExpr(node.test, out);
    } else {
      chip(out, 'repeat forever', 'connective', null, lead && { en: ', repeat forever', glueL: true });
    }
    if (node.update) {
      chip(out, 'after each pass', 'connective', null, { en: ', after each pass', glueL: true });
      walkExpr(node.update, out);
    }
    colon(out);
    walkBlock(node.body, out);
  },
  WhileStatement: (node, out) => {
    chip(out, 'while', 'connective');
    walkExpr(node.test, out);
    colon(out);
    walkBlock(node.body, out);
  },
  DoWhileStatement: (node, out) => {
    chip(out, 'repeat', 'connective');
    colon(out);
    walkBlock(node.body, out);
    chip(out, 'as long as', 'connective', null, { en: ', as long as', glueL: true });
    walkExpr(node.test, out);
  },
  SwitchStatement: walkSwitch,
  TryStatement: (node, out) => {
    chip(out, 'try', 'connective');
    colon(out);
    walkBlock(node.block, out);
    if (node.handler) {
      chip(out, 'if it fails', 'connective', null, { en: ', if it fails', glueL: true });
      if (node.handler.param) {
        chip(out, 'with', 'connective');
        chip(out, patternName(node.handler.param, out), 'subject', node.handler.param);
      }
      colon(out);
      walkBlock(node.handler.body, out);
    }
    if (node.finalizer) {
      chip(out, 'finally', 'connective', null, { en: ', finally', glueL: true });
      colon(out);
      walkBlock(node.finalizer, out);
    }
  },
  ThrowStatement: (node, out) => {
    chip(out, 'fail with', 'connective');
    walkExpr(node.argument, out);
  },
  BreakStatement: (node, out) => chip(out, node.label ? `stop ${node.label.name}` : 'stop the loop', 'connective', node),
  ContinueStatement: (node, out) => chip(out, node.label ? `continue ${node.label.name}` : 'skip to the next pass', 'connective', node),
  EmptyStatement: (node, out) => chip(out, 'do nothing', 'connective', node),
  DebuggerStatement: (node, out) => chip(out, 'pause for the debugger', 'connective', node),
  LabeledStatement: (node, out) => {
    chip(out, `at ${node.label.name}`, 'connective', node.label);
    colon(out);
    walkStmt(node.body, out);
  },
  WithStatement: (node, out) => {
    chip(out, 'with the fields of', 'connective');
    walkExpr(node.object, out);
    colon(out);
    walkBlock(node.body, out);
  },
  BlockStatement: (node, out) => walkBlock(node, out),
  FunctionDeclaration: (node, out) => {
    chip(out, 'define', 'connective');
    if (node.id) chip(out, camelToWords(node.id.name), 'verb', node.id);
    if (node.params.length) {
      chip(out, 'using', 'connective');
      walkParams(node.params, out);
    }
    colon(out);
    walkBlock(node.body, out);
  },
  ClassDeclaration: definesNamed('define a class'),
  TSDeclareFunction: definesNamed('declare the function'),
  TSTypeAliasDeclaration: definesNamed('define the type'),
  TSInterfaceDeclaration: definesNamed('define the type'),
  TSEnumDeclaration: definesNamed('define the choices'),
  TSModuleDeclaration: definesNamed('define the namespace'),
  TSImportEqualsDeclaration: definesNamed('import'),
  TSNamespaceExportDeclaration: definesNamed('export the namespace'),
  TSExportAssignment: (node, out) => {
    chip(out, 'export', 'connective');
    walkExpr(node.expression, out);
  },
  ImportDeclaration: (node, out) => {
    chip(out, 'import from', 'connective');
    walkExpr(node.source, out);
  },
  ExportAllDeclaration: (node, out) => {
    chip(out, 'export everything from', 'connective');
    walkExpr(node.source, out);
  },
  ExportNamedDeclaration: (node, out) => {
    chip(out, 'export', 'connective');
    if (node.declaration) return walkStmt(node.declaration, out);
    node.specifiers.forEach((s, i) => {
      if (i > 0) chip(out, 'and', 'connective');
      chip(out, keyName(s.exported) || 'names', 'subject', s.exported);
    });
    if (node.source) {
      chip(out, 'from', 'connective');
      walkExpr(node.source, out);
    }
  },
  ExportDefaultDeclaration: (node, out) => {
    chip(out, 'export as the default', 'connective');
    const d = node.declaration;
    if (STMT_RULES[d.type] && !EXPR_RULES[d.type]) return walkStmt(d, out);
    return walkExpr(d, out);
  },
  // Flow declarations: named, like the TS ones above.
  DeclareClass: definesNamed('declare a class'),
  DeclareFunction: definesNamed('declare the function'),
  DeclareInterface: definesNamed('declare the type'),
  DeclareModule: definesNamed('declare the module'),
  DeclareModuleExports: (node, out) => chip(out, 'declare the module exports', 'connective', node),
  DeclareTypeAlias: definesNamed('declare the type'),
  DeclareOpaqueType: definesNamed('declare the type'),
  DeclareVariable: definesNamed('declare'),
  DeclareExportDeclaration: (node, out) => {
    chip(out, 'declare an export', 'connective');
    if (node.declaration) walkStmt(node.declaration, out);
  },
  DeclareExportAllDeclaration: (node, out) => {
    chip(out, 'declare an export of everything from', 'connective');
    walkExpr(node.source, out);
  },
  InterfaceDeclaration: definesNamed('define the type'),
  OpaqueType: definesNamed('define the type'),
  TypeAlias: definesNamed('define the type'),
  EnumDeclaration: definesNamed('define the choices'),
};

function walkForEach(node, out) {
  chip(out, 'for each', 'connective');
  if (node.left.declarations) {
    // patternName, not id.name: a destructured loop variable
    // (for (const [k, v] of ...)) has no .name and used to read "undefined".
    const id = node.left.declarations[0].id;
    chip(out, patternName(id, out), 'subject', id);
  } else {
    walkExpr(node.left, out);
  }
  chip(out, node.type === 'ForInStatement' ? 'in' : 'of', 'connective');
  walkExpr(node.right, out);
  colon(out);
  walkBlock(node.body, out);
}

function walkStmt(node, out) {
  const rule = STMT_RULES[node.type];
  if (rule) return rule(node, out);
  return placeholder(out, 'stmt', node);
}

// Chips for one statement -- the step's word chips the demo edits, and what
// reorderChip() re-derives to find which chips moved.
function tokenizeStmt(node, settings) {
  const out = makeOut(settings);
  walkStmt(node, out);
  return chipsOf(out.items);
}

// The same statement as a flat sentence plus its chips and unhandled list,
// all from one walk.
function describeStmt(node, settings) {
  const out = makeOut(settings);
  walkStmt(node, out);
  return { english: render(out.items), tokens: chipsOf(out.items), unhandled: out.unhandled };
}

function describeImplicitReturn(expr, settings) {
  const out = makeOut(settings);
  walkReturn(expr, out);
  return { english: render(out.items), tokens: chipsOf(out.items), unhandled: out.unhandled };
}

// Every parse in Smith reads TypeScript and JSX: Construct's own code is
// .ts/.tsx, and plain JS parses the same way under these plugins.
const PARSE_PLUGINS = ['typescript', 'jsx'];
const PARSE_OPTS = { sourceType: 'module', plugins: PARSE_PLUGINS };

// A method chunk lifted out of its class (`find(id) { return this.#items.get(id); }`)
// refers to private fields the throwaway wrapper class doesn't declare. That
// one complaint is about the wrapper, not the code, so it is tolerated; any
// other syntax error still throws, same as before.
const TOLERATED_PARSE_ERRORS = new Set(['InvalidPrivateFieldResolution']);

function parseForEnglish(wrapped) {
  const ast = parser.parse(wrapped, { ...PARSE_OPTS, errorRecovery: true });
  const fatal = (ast.errors || []).find((e) => !TOLERATED_PARSE_ERRORS.has(e.reasonCode));
  if (fatal) throw fatal;
  return ast;
}

function isFnExpr(node) {
  return !!node && (node.type === 'ArrowFunctionExpression' || node.type === 'FunctionExpression');
}

function methodName(node) {
  const k = node.key;
  if (!k) return '(anonymous)';
  if (k.type === 'PrivateName') return k.id.name;
  return k.name || (k.value != null ? String(k.value) : '(computed)');
}

// Every describable function at the top of a module, in source order:
// function declarations, class methods (of top-level classes), and
// arrow/function expressions bound to a top-level name -- each also when
// wrapped in `export` / `export default`. Bodiless shapes (TS overloads,
// abstract methods, `declare function`) are skipped.
function topLevelFunctions(program) {
  const found = [];
  const fromClass = (cls) => {
    for (const m of cls.body.body) {
      if ((m.type === 'ClassMethod' || m.type === 'ClassPrivateMethod') && m.body) {
        found.push({ name: methodName(m), kind: 'method', node: m, decl: m });
      }
    }
  };
  const fromDecl = (d, outer, defaultName) => {
    if (!d) return;
    if (d.type === 'FunctionDeclaration' && d.body) {
      found.push({ name: d.id ? d.id.name : defaultName || '(anonymous)', kind: 'function', node: d, decl: outer });
    } else if (d.type === 'ClassDeclaration' || d.type === 'ClassExpression') {
      fromClass(d);
    } else if (d.type === 'VariableDeclaration') {
      for (const v of d.declarations) {
        if (v.id.type === 'Identifier' && isFnExpr(v.init)) found.push({ name: v.id.name, kind: 'function', node: v.init, decl: outer });
      }
    } else if (isFnExpr(d)) {
      found.push({ name: defaultName || '(anonymous)', kind: 'function', node: d, decl: outer });
    }
  };
  for (const stmt of program.body) {
    if (stmt.type === 'ExportNamedDeclaration') fromDecl(stmt.declaration, stmt);
    else if (stmt.type === 'ExportDefaultDeclaration') fromDecl(stmt.declaration, stmt, 'default');
    else fromDecl(stmt, stmt);
  }
  return found;
}

// The pre-TS lookup, kept as a fallback so anything the old toEnglish found
// is still found: the first class method anywhere, or a top-level function.
function legacyFirstFunction(ast) {
  let hit = null;
  traverse(ast, {
    ClassMethod(path) {
      if (!path.node.body) return;
      hit = { name: methodName(path.node), kind: 'method', node: path.node, decl: path.node };
      path.stop();
    },
    FunctionDeclaration(path) {
      if (!path.parentPath.isProgram()) return;
      hit = { name: path.node.id ? path.node.id.name : '(anonymous)', kind: 'function', node: path.node, decl: path.node };
      path.stop();
    },
  });
  return hit;
}

function paramText(p, out) {
  return patternName(p, out);
}

function describeFunction(fn, wrapped, prefixLen, style) {
  const shiftN = (n) => (n != null ? n - prefixLen : null);
  const shift = (u) => ({ ...u, start: shiftN(u.start), end: shiftN(u.end) });
  const node = fn.node;
  const settings = { style, bools: booleanBindings(node) };
  const paramsOut = makeOut(settings);
  const params = node.params.map((p) => paramText(p, paramsOut));
  const title = `${camelToWords(fn.name)}${params.length ? ' using ' + params.join(' and ') : ''}`;
  const stepOf = (s, d) => ({
    english: d.english,
    unhandled: d.unhandled.map(shift),
    code: wrapped.slice(s.start, s.end),
    start: shiftN(s.start),
    end: shiftN(s.end),
    // Same step, as chips instead of a flat string -- each chip's start/end
    // (when present) are shifted by the same class-wrapper offset as the
    // step's own start/end, so both stay in the same coordinate space as
    // `code` above.
    tokens: d.tokens.map((tok) => ({ ...tok, start: shiftN(tok.start), end: shiftN(tok.end) })),
  });
  const steps = node.body.type === 'BlockStatement'
    ? node.body.body.map((s) => stepOf(s, describeStmt(s, settings)))
    // An expression-bodied arrow (`const f = (a) => a.b`) is one implicit
    // return step whose code is the expression itself.
    : [stepOf(node.body, describeImplicitReturn(node.body, settings))];
  const english = `${title}: ${steps.map((s) => s.english).join('; then ')}.`;
  return {
    name: fn.name,
    kind: fn.kind,
    title,
    english,
    steps,
    unhandled: [...paramsOut.unhandled.map(shift), ...steps.flatMap((s) => s.unhandled)],
    start: shiftN(fn.decl.start),
    end: shiftN(fn.decl.end),
  };
}

// kind: 'method' | 'function' -- same convention as the rest of the tool,
// so the caller can pass a chunk straight from /api/chunk.
//
// Returns { english, steps, title, unhandled }. `english` is the original
// flat string ("title: step1; then step2; ...") kept for compatibility with
// existing callers. `steps` is the same information un-flattened -- one
// entry per top-level statement of the body, each with its own English, its
// own code slice, its node range, its chips and its `unhandled` list -- so a
// caller (the demo's step-row editor) can address, reorder, or rebuild
// around a single statement instead of the whole block. `unhandled` is every
// placeholder in the description as {kind, type, start, end}.
//
// `{ canonical: true }` first rewrites each function into canonical form
// (canonical.js) so equivalent code reads as the same sentence; off by
// default, so the plain description reads the code exactly as written.
//
// `{ style: 'plain' }` (the default) reads calls as their result and
// operators in words ("pathname with locale stripped", "path equals href",
// "there is no pathname"); `{ style: 'exact' }` is the original
// word-for-word reading ("strip locale of pathname", "path === href").
//
// By default only the FIRST function in `code` is described (the original
// behaviour). `{ all: true }` also returns `functions`: one
// {name, kind, title, english, steps, unhandled, start, end} per describable
// function in the module, in source order (see topLevelFunctions).
function describeSource(code, kind, options) {
  const prefixLen = kind === 'method' ? `class __W__ {\n`.length : 0;
  const wrapped = kind === 'method' ? `class __W__ {\n${code}\n}` : code;
  const ast = parseForEnglish(wrapped);
  let fns = topLevelFunctions(ast.program);
  if (!fns.length) {
    const legacy = legacyFirstFunction(ast);
    if (legacy) fns = [legacy];
  }
  if (!fns.length) {
    const none = { english: '(could not find a function/method to describe)', steps: [], title: null, unhandled: [] };
    return options.all ? { ...none, functions: [] } : none;
  }
  const chosen = options.all ? fns : fns.slice(0, 1);
  // { canonical: true }: equivalent forms read the same (canonical.js). The
  // AST here is this call's own fresh parse, so rewriting it in place is safe.
  if (options.canonical) chosen.forEach((fn) => canonicalizeFunction(fn.node));
  const style = options.style === 'exact' ? 'exact' : 'plain';
  const described = chosen.map((fn) => describeFunction(fn, wrapped, prefixLen, style));
  const first = described[0];
  const result = { english: first.english, steps: first.steps, title: first.title, unhandled: first.unhandled };
  if (options.all) result.functions = described;
  return result;
}

// Memoized by a hash of (code, kind, options). toEnglish is pure -- the
// result depends only on those inputs -- so a repeat call (the demo re-asks
// for the same function after every keystroke-free action, the golden and
// property tests walk the same corpus) skips the parse and walk. In memory
// only, bounded (least recently used entry evicted first), never on disk.
// Each call returns its own deep copy, so a caller mutating the result can't
// corrupt the cache. Parse errors are not cached; they throw every time.
const crypto = require('crypto');

const CACHE_LIMIT = 500;
const englishCache = new Map();
const cacheStats = { hits: 0, misses: 0 };

function cacheKey(code, kind, options) {
  return crypto.createHash('sha256').update(`${kind}\0${options && options.all ? 'all' : 'first'}\0${options && options.canonical ? 'canonical' : 'as-written'}\0${options && options.style === 'exact' ? 'exact' : 'plain'}\0${code}`).digest('hex');
}

function toEnglish(code, kind, options = {}) {
  const key = cacheKey(code, kind, options);
  if (englishCache.has(key)) {
    const hit = englishCache.get(key);
    englishCache.delete(key);
    englishCache.set(key, hit);
    cacheStats.hits++;
    return structuredClone(hit);
  }
  cacheStats.misses++;
  const result = describeSource(code, kind, options);
  englishCache.set(key, result);
  if (englishCache.size > CACHE_LIMIT) englishCache.delete(englishCache.keys().next().value);
  return structuredClone(result);
}

function clearEnglishCache() {
  englishCache.clear();
  cacheStats.hits = 0;
  cacheStats.misses = 0;
}

function englishCacheStats() {
  return { ...cacheStats, size: englishCache.size, limit: CACHE_LIMIT };
}

// Every method/function actually CALLED in the refactored code -- the real
// atoms this block ended up using (equals, greaterThan, and, if, is, ...),
// not a guess. Deterministic AST walk, same as everything else here.
function extractAtoms(code, kind) {
  const wrapped = kind === 'method' ? `class __W__ {\n${code}\n}` : code;
  const ast = parser.parse(wrapped, PARSE_OPTS);
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
  const ast = parser.parse(wrapped, PARSE_OPTS);
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
  const ast = parser.parse(atomCode, PARSE_OPTS);
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
// `style` must match the style the chips were read in (toEnglish's default,
// 'plain', unless the caller asked for 'exact').
function reorderChip(code, kind, stepIndex, order, { style = 'plain' } = {}) {
  const wrapped = kind === 'method' ? `class __W__ {\n${code}\n}` : code;
  const ast = parser.parse(wrapped, { sourceType: 'module' });
  const bodyPath = findBody(ast);
  if (!bodyPath) throw new Error('could not find a function/method to edit');
  const stmts = bodyPath.node.body;
  if (stepIndex < 0 || stepIndex >= stmts.length) throw new Error('step index out of range');
  const stmt = stmts[stepIndex];

  const oldTokens = tokenizeStmt(stmt, { style, bools: booleanBindings(bodyPath.parent) });
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
  clearEnglishCache,
  englishCacheStats,
  PARSE_PLUGINS,
  EXPR_RULES,
  STMT_RULES,
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
