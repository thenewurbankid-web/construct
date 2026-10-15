// Atoms: what happens to code our English can't say in one clean sentence.
//
// Every statement must read as valid English — grammatical (lint-clean), with
// no gap, and short enough to read as one sentence. A statement that doesn't
// is wrapped into an atom: its own function, named after what it does in
// plain words. The name is decided by the user or a small model, answering a
// plain-English question (no code); the same answer becomes the atom's
// correction (corrections.mjs), so its call site then reads exactly as they
// said it: `const ok = checkOrderIsComplete(order)` -> "Declares `ok` as the
// result of checking the order is complete with `order`".
//
// planAtoms() finds the statements and works out each atom's inputs (the
// enclosing function's parameters and locals it reads) and output (the local
// it declares, or the value it returns). A statement that can't be lifted out
// mechanically — it returns/breaks/continues from inside, uses `this`, or
// assigns more than one outer local — is reported as needing a person, never
// skipped silently. applyAtom() does the extraction with the TypeScript
// compiler API: same source, one function more, the statement replaced by a
// call.
import { ts } from '../../packages/ast/index.mjs';
import { describeStatement, describeExpr } from './prose.mjs';
import { lintSentence, GAP_PATTERNS, maskSpans } from './grammar-eval.mjs';
import { plainWords, doesMarker } from './corrections.mjs';
import { verb } from './grammar.mjs';
import { readFileSync } from 'node:fs';
import { splitIdentifier, setMarkedFunctions } from './user-lexicon.mjs';
import { parseAnswer } from './corrections.mjs';

/** A sentence longer than this many words (outside code spans) is wrapped. */
export const MAX_SENTENCE_WORDS = 40;

/** An expression whose English is longer than this is a candidate atom. */
export const MAX_PHRASE_WORDS = 14;

function englishWords(english) {
  return maskSpans(english).split(/\s+/).filter(Boolean).length;
}

/**
 * Why a sentence doesn't stand as valid English on its own.
 * @param {string} english The sentence.
 * @returns {string | null} The reason, or null when it reads fine.
 */
export function whyNotEnglish(english) {
  const masked = maskSpans(english);
  const broken = lintSentence(english);
  if (broken.length) return `it reads badly (${broken.join(', ')})`;
  if (GAP_PATTERNS.some((p) => p.test(masked.replace(/X/g, '`')))) return 'our English has no grammar for it yet';
  const words = masked.split(/\s+/).filter(Boolean).length;
  if (words > MAX_SENTENCE_WORDS) return `it takes ${words} words to say, more than one readable sentence`;
  return null;
}

function functionsIn(sf) {
  const out = [];
  const visit = (node) => {
    if ((ts.isFunctionDeclaration(node) || ts.isArrowFunction(node) || ts.isFunctionExpression(node) || ts.isMethodDeclaration(node)) && node.body && ts.isBlock(node.body)) out.push(node);
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

function declaredNames(nameNode, out = new Set()) {
  if (ts.isIdentifier(nameNode)) out.add(nameNode.text);
  else if (ts.isObjectBindingPattern(nameNode) || ts.isArrayBindingPattern(nameNode)) {
    for (const el of nameNode.elements) if (!ts.isOmittedExpression(el)) declaredNames(el.name, out);
  }
  return out;
}

/** Names declared by one statement: `const {a, b} = ...` -> a, b. */
function namesDeclaredBy(stmt) {
  const out = new Set();
  if (ts.isVariableStatement(stmt)) for (const d of stmt.declarationList.declarations) declaredNames(d.name, out);
  return out;
}

/** Identifiers a node reads (not property names, not names it declares itself). */
function identifiersRead(node) {
  const reads = new Set();
  const declaredInside = new Set();
  const visit = (n) => {
    if (ts.isVariableDeclaration(n) || ts.isParameter(n)) declaredNames(n.name, declaredInside);
    if (ts.isIdentifier(n)) {
      const p = n.parent;
      const isPropertyName = (ts.isPropertyAccessExpression(p) && p.name === n) || (ts.isPropertyAssignment(p) && p.name === n) || ts.isBindingElement(p) && p.propertyName === n;
      if (!isPropertyName) reads.add(n.text);
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  for (const d of declaredInside) reads.delete(d);
  return reads;
}

/** Locals a node assigns (`x = ...`, `x += ...`, `x++`), not counting its own declarations. */
function outerAssignments(node, outer) {
  const out = new Set();
  const visit = (n) => {
    if (ts.isBinaryExpression(n) && n.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && n.operatorToken.kind <= ts.SyntaxKind.LastAssignment && ts.isIdentifier(n.left) && outer.has(n.left.text)) out.add(n.left.text);
    if ((ts.isPostfixUnaryExpression(n) || ts.isPrefixUnaryExpression(n)) && ts.isIdentifier(n.operand) && outer.has(n.operand.text) && (n.operator === ts.SyntaxKind.PlusPlusToken || n.operator === ts.SyntaxKind.MinusMinusToken)) out.add(n.operand.text);
    if (!ts.isFunctionLike(n) || n === node) ts.forEachChild(n, visit);
  };
  visit(node);
  return out;
}

/** Whether control leaves the statement from inside it (other than through a nested function). */
function escapesControl(stmt) {
  let escapes = false;
  let usesThis = false;
  let awaits = false;
  const visit = (n, loopDepth) => {
    if (ts.isFunctionLike(n) && n !== stmt) return;
    if (ts.isReturnStatement(n) && n !== stmt) escapes = true;
    if ((ts.isBreakStatement(n) || ts.isContinueStatement(n)) && !n.label && loopDepth === 0) escapes = true;
    if (n.kind === ts.SyntaxKind.ThisKeyword) usesThis = true;
    if (ts.isAwaitExpression(n)) awaits = true;
    const loop = ts.isIterationStatement(n, false) || ts.isSwitchStatement(n);
    ts.forEachChild(n, (c) => visit(c, loopDepth + (loop ? 1 : 0)));
  };
  visit(stmt, 0);
  return { escapes, usesThis, awaits };
}

/**
 * Every statement in `source` whose English isn't valid on its own, as an atom
 * to wrap — or as a reason a person is needed.
 * @param {string} source A source file's text.
 * @param {string} [fileName] For the parser's dialect (.ts/.tsx/.mjs).
 * @returns {{atoms: object[], needsPerson: object[]}} Atoms ready to name, and statements that can't be lifted mechanically.
 */
export function planAtoms(source, fileName = 'x.tsx') {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, /x$/.test(fileName) ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const atoms = [];
  const needsPerson = [];
  for (const fn of functionsIn(sf)) {
    if (isMarked(fn, sf)) continue; // a marked function reads by its marker; its internals are not ours to parse
    const fnName = fn.name && ts.isIdentifier(fn.name) ? fn.name.text : ts.isVariableDeclaration(fn.parent) && ts.isIdentifier(fn.parent.name) ? fn.parent.name.text : 'anonymous';
    const inScope = new Set();
    for (const p of fn.parameters) declaredNames(p.name, inScope);
    for (const stmt of fn.body.statements) {
      const english = safeDescribe(stmt);
      const why = whyNotEnglish(english);
      if (why && !isInsideOtherFunction(stmt, fn)) {
        const line = sf.getLineAndCharacterOfPosition(stmt.getStart(sf)).line + 1;
        const flow = escapesControl(stmt);
        const declared = namesDeclaredBy(stmt);
        const reads = identifiersRead(stmt);
        const inputs = [...inScope].filter((n) => reads.has(n) && !declared.has(n));
        const assigned = [...outerAssignments(stmt, inScope)];
        const base = { function: fnName, line, english, why, raw: stmt.getText(sf) };
        let problem = null;
        if (flow.escapes) problem = 'it leaves the function from the middle (return, break or continue)';
        else if (flow.usesThis) problem = 'it depends on `this`';
        else if (assigned.length > 1) problem = `it changes ${assigned.length} outside values at once`;
        else if (declared.size > 1) problem = `it declares ${declared.size} values at once`;
        const small = minimalAtoms(stmt, sf, declaredIn(fn));
        if (small.length) atoms.push(...small.map((piece) => ({ ...base, ...piece, insertAt: topLevelEnd(fn, sf) })));
        else if (problem) needsPerson.push({ ...base, problem });
        else {
          const output = declared.size ? [...declared][0] : assigned[0] ?? null;
          const kind = ts.isReturnStatement(stmt) ? 'return' : declared.size ? 'declare' : assigned.length ? 'assign' : 'do';
          atoms.push({ ...base, start: stmt.getStart(sf), end: stmt.getEnd(), inputs: kind === 'assign' ? [...new Set([...inputs, output])] : inputs, output, kind, async: flow.awaits, insertAt: topLevelEnd(fn, sf) });
        }
      }
      for (const n of namesDeclaredBy(stmt)) inScope.add(n);
    }
  }
  return { atoms, needsPerson };
}

function isMarked(fn, sf) {
  let top = fn;
  while (top.parent && top.parent !== sf) top = top.parent;
  return top.parent === sf && Boolean(doesMarker(top));
}

// ---- expression atoms: the smallest executable piece that doesn't read --------

/** Every name declared anywhere inside a function: parameters, locals, callback parameters. */
function declaredIn(fn) {
  const names = new Set();
  const visit = (n) => {
    if (ts.isParameter(n) || ts.isVariableDeclaration(n) || ts.isBindingElement(n)) declaredNames(n.name, names);
    ts.forEachChild(n, visit);
  };
  visit(fn);
  return names;
}

const TRIVIAL = (n) => ts.isIdentifier(n) || ts.isLiteralExpression(n) || ts.isPropertyAccessExpression(n) || n.kind === ts.SyntaxKind.TrueKeyword || n.kind === ts.SyntaxKind.FalseKeyword || n.kind === ts.SyntaxKind.NullKeyword;

function safeExpr(n) {
  try {
    return describeExpr(n);
  } catch {
    return 'Runs a step';
  }
}

function phraseFails(n) {
  const english = safeExpr(n);
  return englishWords(english) > MAX_PHRASE_WORDS || Boolean(whyNotEnglish(english)?.match(/reads badly|no grammar/));
}

/** Whether a node can be lifted out as is: no `this`, `await`, `yield`, `super`, or assignment to an outer name. */
function liftable(node) {
  let ok = true;
  const visit = (n) => {
    if (n.kind === ts.SyntaxKind.ThisKeyword || n.kind === ts.SyntaxKind.SuperKeyword || ts.isAwaitExpression(n) || ts.isYieldExpression(n)) ok = false;
    if (ts.isBinaryExpression(n) && n.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && n.operatorToken.kind <= ts.SyntaxKind.LastAssignment) ok = false;
    if ((ts.isPostfixUnaryExpression(n) || ts.isPrefixUnaryExpression(n)) && (n.operator === ts.SyntaxKind.PlusPlusToken || n.operator === ts.SyntaxKind.MinusMinusToken)) ok = false;
    if (ok && (!ts.isFunctionLike(n) || n === node)) ts.forEachChild(n, visit);
  };
  visit(node);
  return ok;
}

/**
 * Every minimal executable expression inside `stmt` that doesn't read as a
 * short, clean phrase while every part of it does — one bottom-up pass over
 * the tree, each node judged after its children, and a node whose subtree
 * already holds a chosen piece is skipped, so the pieces never overlap and can
 * all be lifted at once. A callback that captures nothing is lifted whole and
 * passed by name (it then reads as its gerund).
 */
function minimalAtoms(stmt, sf, fnNames) {
  const chosen = [];
  /** @returns {boolean} whether this subtree holds a chosen piece */
  const visit = (n) => {
    if (ts.isFunctionLike(n) && !ts.isArrowFunction(n) && !ts.isFunctionExpression(n)) return false;
    let below = false;
    ts.forEachChild(n, (c) => {
      if (visit(c)) below = true;
    });
    if (below || !ts.isExpression(n) || TRIVIAL(n) || ts.isParenthesizedExpression(n) || !liftable(n)) return below;
    if (ts.isArrowFunction(n) || ts.isFunctionExpression(n)) {
      const own = new Set(n.parameters.flatMap((p) => [...declaredNames(p.name)]));
      const captured = [...identifiersRead(n)].filter((x) => fnNames.has(x) && !own.has(x));
      if (!captured.length && !ts.isBlock(n.body) && phraseFails(n.body)) {
        chosen.push({ kind: 'callback', start: n.getStart(sf), end: n.getEnd(), params: n.parameters.map((p) => p.getText(sf)), raw: n.body.getText(sf), english: safeExpr(n), inputs: [], output: null, async: false });
        return true;
      }
      return false;
    }
    if (!phraseFails(n)) return false;
    const reads = identifiersRead(n);
    const inputs = [];
    const inOrder = (m) => {
      if (ts.isIdentifier(m) && reads.has(m.text) && fnNames.has(m.text) && !inputs.includes(m.text)) inputs.push(m.text);
      ts.forEachChild(m, inOrder);
    };
    inOrder(n);
    chosen.push({ kind: 'expr', start: n.getStart(sf), end: n.getEnd(), raw: n.getText(sf), english: safeExpr(n), inputs, output: null, async: false });
    return true;
  };
  visit(stmt);
  return chosen;
}

function safeDescribe(stmt) {
  try {
    return describeStatement(stmt);
  } catch (err) {
    return `Runs a step that could not be described (${err.message}).`;
  }
}

function isInsideOtherFunction(stmt, fn) {
  for (let p = stmt.parent; p; p = p.parent) {
    if (p === fn) return false;
    if (ts.isFunctionLike(p)) return true;
  }
  return false;
}

function topLevelEnd(fn, sf) {
  let top = fn;
  while (top.parent && top.parent !== sf) top = top.parent;
  return top.getEnd();
}

// ---- naming -----------------------------------------------------------------

/**
 * The plain-English naming question for an atom: what this part does, as a
 * short action. No code.
 * @param {{function: string, english: string}} atom The atom.
 * @returns {string} The question.
 */
export function atomQuestion(atom) {
  return (
    `Part of the step “${splitIdentifier(atom.function).join(' ')}” does this: ${plainWords(atom.english)} ` +
    'What would you call this part, as a short action in plain words? Start with an action word, like “check the order is complete” or “build the welcome message”.'
  );
}

/**
 * Turns a naming answer into the atom's function name and its correction
 * (third-person English for corrections.mjs).
 * @param {string} answer The answer: "check the order is complete".
 * @returns {{name: string, does: string} | {error: string}} The name and the English it reads as, or why the answer can't be used.
 */
export function nameFromAnswer(answer) {
  const words = answer
    .trim()
    .split('\n')[0]
    .replace(/^["“'`]+|["”'`.!]+$/g, '')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return { error: 'The answer was empty.' };
  if (words.length > 8) return { error: 'Please use a few words.' };
  if (!words.every((w) => /^[a-z]+$/.test(w))) return { error: 'Please answer in plain words only.' };
  const [first, ...rest] = words;
  if (/(s|ing|ed)$/.test(first) && !/ss$/.test(first)) return { error: `Please start with the plain action word, like “check” rather than “${first}”.` };
  const nameWords = [first, ...rest.filter((w) => !['the', 'a', 'an'].includes(w))];
  const name = nameWords.map((w, i) => (i ? w[0].toUpperCase() + w.slice(1) : w)).join('');
  return { name, does: [verb(first).thirdPerson, ...rest].join(' ') };
}

// ---- extraction -----------------------------------------------------------------

/**
 * Wraps one planned atom into its own function, named `name`, and replaces the
 * statement with a call. Returns the new source; the caller re-plans for the next atom.
 * @param {string} source The source the atom was planned on.
 * @param {any} atom One entry of planAtoms().atoms.
 * @param {string} name The atom's function name.
 * @param {string} does The atom's English, written on it as its `@does` marker: "works out the order total".
 * @returns {string} The rewritten source.
 */
export function applyAtom(source, atom, name, does) {
  return applyAtoms(source, [{ atom, name, does }]);
}

/** The edits one atom makes: its new function, inserted after the enclosing
 * top-level declaration, and the replacement of its code by a call. */
function atomEdits(atom, name, does) {
  const marker = `/** @does ${does.replace(/\*\//g, '')} */\n`;
  if (atom.kind === 'expr' || atom.kind === 'callback') {
    const params = atom.kind === 'callback' ? atom.params.join(', ') : atom.inputs.join(', ');
    const fn = `\n\n${marker}function ${name}(${params}) {\n  return ${atom.raw};\n}`;
    const use = atom.kind === 'callback' ? name : `${name}(${params})`;
    return [{ at: atom.insertAt, end: atom.insertAt, text: fn }, { at: atom.start, end: atom.end, text: use }];
  }
  const params = atom.inputs.join(', ');
  const call = `${atom.async ? 'await ' : ''}${name}(${params})`;
  const body = atom.raw.split('\n').map((l) => `  ${l.replace(/^\s{0,4}/, '')}`).join('\n');
  let fnBody;
  let callSite;
  if (atom.kind === 'return') {
    fnBody = body;
    callSite = `return ${call};`;
  } else if (atom.kind === 'declare') {
    fnBody = `${body}\n  return ${atom.output};`;
    const keyword = /^\s*(const|let|var)\b/.exec(atom.raw)?.[1] ?? 'const';
    callSite = `${keyword} ${atom.output} = ${call};`;
  } else if (atom.kind === 'assign') {
    fnBody = `${body}\n  return ${atom.output};`;
    callSite = `${atom.output} = ${call};`;
  } else {
    fnBody = body;
    callSite = `${call};`;
  }
  const fn = `\n\n${marker}${atom.async ? 'async ' : ''}function ${name}(${params}) {\n${fnBody}\n}`;
  return [{ at: atom.insertAt, end: atom.insertAt, text: fn }, { at: atom.start, end: atom.end, text: callSite }];
}

/**
 * Wraps several non-overlapping atoms (one planAtoms pass) at once: every
 * edit is applied from the end of the file backwards, so earlier offsets stay
 * valid without re-parsing between atoms.
 * @param {string} source The source the atoms were planned on.
 * @param {{atom: any, name: string, does: string}[]} named Each atom with its name and English.
 * @returns {string} The rewritten source.
 */
export function applyAtoms(source, named) {
  const edits = named.flatMap(({ atom, name, does }, order) => atomEdits(atom, name, does).map((e) => ({ ...e, order })));
  // Later positions first; at one insertion point, keep the atoms in plan order.
  edits.sort((x, y) => y.at - x.at || y.order - x.order);
  let out = source;
  for (const e of edits) out = out.slice(0, e.at) + e.text + out.slice(e.end);
  return out;
}

/**
 * planAtoms over a set of files, with the project's markers handed in as
 * plain `{name: English}` data (corrections.mjs markersIn).
 * @param {string[]} files The files.
 * @param {{markers?: Record<string, string>}} [context] The project's markers.
 * @returns {object[]} Every atom and needs-a-person entry, each with its `file`.
 */
export function planAtomsInFiles(files, context = {}) {
  const map = new Map();
  for (const [name, does] of Object.entries(context?.markers ?? {})) {
    const parsed = parseAnswer(name, does);
    if ('type' in parsed) map.set(name, parsed.type);
  }
  setMarkedFunctions(map);
  return files.flatMap((file) => {
    const plan = planAtoms(readFileSync(file, 'utf8'), file);
    return [...plan.atoms.map((x) => ({ ...x, file })), ...plan.needsPerson.map((x) => ({ ...x, file, needsPerson: true }))];
  });
}
