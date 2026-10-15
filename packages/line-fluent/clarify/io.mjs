// Clarify from code, first step (owner, 2026-10-15): from the code alone, guess what goes in and what comes out, and
// confirm both with the person or agent before any sentence is suggested.
//
//   inputs       the code's free names (not globals like Math, not names it declares itself)
//   input kinds  for each input, the first readable kind the code runs on without breaking: a list of numbers, some
//                text, a number, a record, ...
//   output       what the code gives on those readable inputs, and whether it changes an input in place
//   fixed parts  callbacks in the code (`(a, b) => a - b`): not inputs, so a sentence must carry them as written
import * as acorn from 'acorn';
import { runAnswer } from '../gate/equivalence/equivalence.mjs';
import { show } from './sentences.mjs';

/** Readable values per kind, with the plain words a person reads for that kind. */
export const KINDS = [
  { kind: 'list of numbers', gen: 'list', value: [10, 2, 1] },
  { kind: 'list of records', gen: 'list', value: [{ name: 'pen', price: 2 }, { name: 'bag', price: 30 }] },
  { kind: 'list of text', gen: 'list', value: ['pear', 'apple', 'fig'] },
  { kind: 'number', gen: 'num', value: 3 },
  { kind: 'text', gen: 'text', value: 'Hello world' },
  { kind: 'record', gen: 'obj', value: { name: 'Ann', age: 30 } },
  { kind: 'yes or no', gen: 'bool', value: true },
  { kind: 'date', gen: 'date', value: new Date('2026-01-15T00:00:00Z') },
  { kind: 'single item', gen: 'prim', value: 'apple' },
];
const byKind = Object.fromEntries(KINDS.map((k) => [k.kind, k]));

const LIST_METHODS = new Set(['map', 'filter', 'reduce', 'find', 'findIndex', 'some', 'every', 'forEach', 'sort', 'toSorted', 'slice', 'splice', 'push', 'pop', 'shift', 'unshift', 'concat', 'join', 'includes', 'indexOf', 'flat', 'flatMap', 'reverse', 'toReversed', 'at', 'length', 'fill']);
const TEXT_METHODS = new Set(['toUpperCase', 'toLowerCase', 'trim', 'split', 'startsWith', 'endsWith', 'padStart', 'padEnd', 'replace', 'replaceAll', 'charAt', 'substring']);
const NUMERIC_OPS = new Set(['-', '*', '/', '%', '**', '>', '<', '>=', '<=']);
const ELEMENT_CALLBACKS = new Set(['map', 'filter', 'find', 'findIndex', 'some', 'every', 'forEach', 'flatMap']);

const cloneValue = (v) => {
  try {
    return structuredClone(v);
  } catch {
    return v;
  }
};

/** The code's free names, in order of first use, and its callbacks (fixed parts). */
export function readCode(code) {
  const ast = acorn.parseExpressionAt(code, 0, { ecmaVersion: 'latest' });
  const declared = new Set();
  const used = [];
  const fixed = [];
  const hints = {};
  const hint = (name, kind) => ((hints[name] ??= []).push(kind));
  const visit = (node, parent, key) => {
    if (node?.type === 'MemberExpression' && node.object.type === 'Identifier' && !node.computed) {
      const m = node.property.name;
      if (LIST_METHODS.has(m)) hint(node.object.name, 'list');
      else if (TEXT_METHODS.has(m)) hint(node.object.name, 'text');
      else hint(node.object.name, 'record');
    }
    if (node?.type === 'BinaryExpression' && NUMERIC_OPS.has(node.operator)) {
      for (const side of [node.left, node.right]) if (side.type === 'Identifier') hint(side.name, 'number');
    }
    if (node?.type === 'CallExpression' && node.callee.type === 'MemberExpression' && !node.callee.computed) {
      const m = node.callee.property.name;
      const owner = node.callee.object.type === 'Identifier' ? node.callee.object.name : null;
      if (['push', 'unshift', 'includes', 'indexOf'].includes(m)) for (const a of node.arguments) if (a.type === 'Identifier') hint(a.name, 'item');
      // A callback over the list's items that reads a property of its item: the list holds records.
      const cb = node.arguments[0];
      if (owner && ELEMENT_CALLBACKS.has(m) && cb && /FunctionExpression$/.test(cb.type) && cb.params[0]?.type === 'Identifier') {
        const item = cb.params[0].name;
        if (new RegExp(`\\b${item}\\.[A-Za-z_$]`).test(code.slice(cb.start, cb.end))) hint(owner, 'records');
      }
    }
    if (!node || typeof node.type !== 'string') return;
    if (node.type === 'ArrowFunctionExpression' || node.type === 'FunctionExpression') {
      fixed.push(code.slice(node.start, node.end));
      for (const p of node.params) collectNames(p, declared);
    }
    if (node.type === 'VariableDeclarator') collectNames(node.id, declared);
    if (node.type === 'Identifier') {
      const isProperty = parent && ((parent.type === 'MemberExpression' && key === 'property' && !parent.computed) || (parent.type === 'Property' && key === 'key' && !parent.computed));
      if (!isProperty && !used.includes(node.name)) used.push(node.name);
    }
    for (const [k, v] of Object.entries(node)) {
      if (k === 'start' || k === 'end') continue;
      if (Array.isArray(v)) v.forEach((c) => visit(c, node, k));
      else if (v && typeof v === 'object') visit(v, node, k);
    }
  };
  visit(ast, null, null);
  const inputs = used.filter((n) => !declared.has(n) && !(n in globalThis) && n !== 'undefined');
  return { inputs, fixed, hints };
}

/** The kinds to try for one input, the code's own evidence first. */
function kindsFor(evidence = []) {
  const order = [];
  const add = (k) => byKind[k] && !order.includes(byKind[k]) && order.push(byKind[k]);
  if (evidence.includes('records')) add('list of records');
  if (evidence.includes('list')) {
    add('list of numbers');
    add('list of text');
    add('list of records');
  }
  if (evidence.includes('text')) add('text');
  if (evidence.includes('number')) add('number');
  if (evidence.includes('item')) add('single item');
  if (evidence.includes('record')) add('record');
  for (const k of KINDS) add(k.kind);
  return order;
}

function collectNames(pattern, into) {
  if (!pattern) return;
  if (pattern.type === 'Identifier') into.add(pattern.name);
  else if (pattern.type === 'ObjectPattern') pattern.properties.forEach((p) => collectNames(p.value ?? p.argument, into));
  else if (pattern.type === 'ArrayPattern') pattern.elements.forEach((e) => collectNames(e, into));
  else if (pattern.type === 'RestElement') collectNames(pattern.argument, into);
  else if (pattern.type === 'AssignmentPattern') collectNames(pattern.left, into);
}

/**
 * The guess: each input with the first kind the code runs on, the output on those values, and whether the code
 * changes an input in place.
 * @param {string} code A JS expression.
 * @returns {Promise<{inputs: {name: string, kind: string, gen: string, value: any}[], fixed: string[], output: string | null, changes: string[], given: string}>} The guess.
 */
export async function guessIO(code) {
  const { inputs: names, fixed, hints } = readCode(code);
  const chosen = names.map((n) => kindsFor(hints[n])[0]);
  // Each input in turn takes the first kind under which the code runs and gives something.
  for (let i = 0; i < names.length; i++) {
    for (const k of kindsFor(hints[names[i]])) {
      const trial = chosen.map((c, j) => (j === i ? k : c));
      const r = await runAnswer(code, names, trial.map((t) => cloneValue(t.value)));
      if (!r.throws && r.ok !== undefined && !(Array.isArray(r.ok) && r.ok.length === 0 && k !== kindsFor(hints[names[i]]).at(-1))) {
        chosen[i] = k;
        break;
      }
    }
  }
  const values = chosen.map((c) => cloneValue(c.value));
  const before = values.map(show);
  const r = await runAnswer(code, names, values);
  const changes = names.filter((n, i) => show(values[i]) !== before[i]);
  return {
    inputs: names.map((name, i) => ({ name, kind: chosen[i].kind, gen: chosen[i].gen, value: chosen[i].value })),
    fixed,
    output: r.throws ? null : show(r.ok),
    changes,
    given: names.length ? `With ${names.map((n, i) => `${n} = ${before[i]}`).join(' and ')}` : 'With nothing given',
  };
}

/** The two questions, in plain words: what goes in, then what comes out. */
export function ioQuestions(guess) {
  const ins = guess.inputs.length
    ? `It takes ${guess.inputs.map((x) => `${x.name} (${/^[aeiou]/.test(x.kind) ? 'an' : 'a'} ${x.kind})`).join(' and ')}. Is that right? (yes, or say what each one is)`
    : 'It takes nothing. Is that right? (yes, or say what it takes)';
  const keeps = guess.inputs.filter((x) => !guess.changes.includes(x.name)).map((x) => x.name);
  const effect = [
    guess.changes.length ? `changes ${guess.changes.join(' and ')} in place` : '',
    keeps.length ? `leaves ${keeps.join(' and ')} as ${keeps.length > 1 ? 'they were' : 'it was'}` : '',
  ].filter(Boolean).join(' and ');
  const out = guess.output === null
    ? `${guess.given}, it gives an error. What is it meant to do? (say it in your words)`
    : `${guess.given}, it gives ${guess.output}${effect ? ` and ${effect}` : ''}. In your words, what is it for?`;
  return { inputs: ins, output: out };
}
