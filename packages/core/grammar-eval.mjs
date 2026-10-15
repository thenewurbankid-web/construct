// The grammar eval loop: proves the controlled English is closed — every
// sentence our lexicons can produce is grammatical and compiles back to the
// JS it came from — instead of trusting a reader to spot "Logs the in".
//
// Two sweeps, both deterministic:
//   evaluateLexicon()  every sentence type x every argument shape it can be
//                      handed (none, refs, text, numbers; with and without a
//                      receiver), every form (statement, gerund, negation).
//                      Each sentence is linted, read back from its own
//                      English, and the JS it reads back to is compiled.
//   evaluateSource()   every exported declaration in a set of files, run
//                      through the translator. A sentence that lints dirty is
//                      a failure; one that falls back to a generic phrase is a
//                      gap — code our English has no grammar for yet, which
//                      corrections.mjs turns into a plain-English question.
import { readFileSync } from 'node:fs';
import { ts } from '../../packages/ast/index.mjs';
import { JS_LEXICON } from './js-lexicon.mjs';
import { Action, Predicate } from './grammar.mjs';
import { describeImplementation } from './prose.mjs';
import { mapUserCall, splitIdentifier, setMarkedFunctions } from './user-lexicon.mjs';
import { markerTypes, withLeadingDoc } from './corrections.mjs';

// ---- lint ---------------------------------------------------------------

// The lint rules live with the grammar (grammar.mjs); re-exported here for the eval loop.
export { LINT_RULES, lintSentence, maskSpans } from './grammar.mjs';
import { lintSentence, maskSpans } from './grammar.mjs';

/** Phrases the translator falls back to when no grammar fits: each is a gap. */
export const GAP_PATTERNS = Object.freeze([
  /\bRuns an expression\b/,
  /\bRuns a step\b/,
  /\bcalling `/,
  /\bcalls `/,
  /\binvolving `/,
  /\bwith no named parts\b/,
  /\bDefines behavior\b/,
]);

// ---- compile: JS read back from English must parse ------------------------

/**
 * Whether a JS expression parses cleanly.
 * @param {string} js The expression.
 * @returns {boolean} True when TypeScript reports no syntax errors.
 */
export function compiles(js) {
  const file = ts.createSourceFile('x.ts', `(${js});`, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  return (/** @type {any} */ (file).parseDiagnostics || []).length === 0;
}

// ---- sweep 1: every lexicon sentence ---------------------------------------

const SHAPES = {
  ref: (i) => ({ english: `\`v${i}\``, js: `v${i}`, bare: null }),
  text: (i) => ({ english: `the text 's${i}'`, js: `'s${i}'`, bare: `'s${i}'` }),
  number: (i) => ({ english: `the number ${i + 2}`, js: `${i + 2}`, bare: `${i + 2}` }),
};

function* bindingsFor(type) {
  const needsReceiver = type.call.startsWith('.') || type.call.includes('.');
  const receivers = needsReceiver ? [{ english: '`obj`', js: 'obj' }, null] : [null];
  for (const receiver of receivers) {
    for (let arity = 0; arity <= 3; arity++) {
      for (const shape of Object.keys(SHAPES)) {
        yield { args: Array.from({ length: arity }, (_, i) => SHAPES[shape](i)), target: receiver };
      }
    }
  }
}

/**
 * Renders every lexicon sentence type against every argument shape and checks
 * each result: lint-clean, reads back from its own English, and compiles.
 * @param {ReadonlyArray<any>} [lexicon] The sentence types (default: ours).
 * @returns {{checked: number, failures: {call: string, form: string, english: string, js: string, problem: string}[]}} Every failure, with the sentence that failed.
 */
export function evaluateLexicon(lexicon = JS_LEXICON) {
  const failures = [];
  let checked = 0;
  for (const type of lexicon) {
    let fitted = 0;
    for (const binding of bindingsFor(type)) {
      const sentence = new type(binding);
      const english = sentence.toEnglish();
      if (english == null) continue; // this binding doesn't fit the type
      fitted++;
      const js = sentence.toJs();
      const forms = [['statement', english]];
      if (sentence instanceof Action) forms.push(['gerund', sentence.toGerund()]);
      if (sentence instanceof Predicate) forms.push(['negated', sentence.toNegatedEnglish()]);
      for (const [form, text] of forms) {
        checked++;
        const fail = (problem) => failures.push({ call: type.call, form, english: text, js, problem });
        for (const rule of lintSentence(text)) fail(rule);
      }
      if (!compiles(js)) failures.push({ call: type.call, form: 'js', english, js, problem: 'JS does not compile' });
      const back = type.fromEnglish(english);
      if (!back) failures.push({ call: type.call, form: 'read back', english, js, problem: 'English does not read back' });
      else if (back.toJs() !== js) failures.push({ call: type.call, form: 'read back', english, js, problem: `reads back as ${back.toJs()}` });
    }
    if (!fitted) failures.push({ call: type.call, form: '-', english: '', js: '', problem: 'no argument shape fits this type' });
  }
  return { checked, failures };
}

// ---- sweep 2: every exported declaration in real code ----------------------

/**
 * Translates every exported declaration in `files` and sorts the results.
 * @param {string[]} files Source files (.js/.mjs/.ts/.tsx).
 * @returns {{checked: number, failures: {file: string, line: number, english: string, problem: string}[], gaps: {file: string, line: number, raw: string, english: string}[]}} Lint failures and grammar gaps, located.
 */
export function evaluateSource(files) {
  const failures = [];
  const gaps = [];
  let checked = 0;
  // Marked top-level functions (`@does`) read by their marker everywhere they're called.
  setMarkedFunctions(markerTypes(files.map((file) => ({ file, source: readFileSync(file, 'utf8') }))));
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, /x$/.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    for (const stmt of sf.statements) {
      const exported = /** @type {any} */ (stmt).modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
      if (!exported) continue;
      const raw = withLeadingDoc(stmt, sf).replace(/^((?:\/\*\*[\s\S]*?\*\/\s*)*)export\s+(default\s+)?/, '$1');
      const line = sf.getLineAndCharacterOfPosition(stmt.getStart(sf)).line + 1;
      let english;
      try {
        english = describeImplementation(raw);
      } catch (err) {
        failures.push({ file, line, english: '', problem: `translator threw: ${err.message}` });
        continue;
      }
      checked++;
      for (const rule of lintSentence(english)) failures.push({ file, line, english, problem: rule });
      if (GAP_PATTERNS.some((p) => p.test(maskSpans(english).replace(/X/g, '`')))) gaps.push({ file, line, raw: raw.split('\n')[0].slice(0, 120), english });
    }
  }
  return { checked, failures, gaps };
}

// ---- sweep 3: user-domain names our English can only guess at ----------------

const FRAMEWORK_CALLS = new Set(['useState', 'useRouter', 'useMachine', 'useEffect', 'require']);

/** An argument as plain words for a question: `form.user` -> "form user". */
function inputWords(node) {
  while (node && (ts.isParenthesizedExpression(node) || ts.isAwaitExpression(node) || ts.isAsExpression(node) || ts.isNonNullExpression(node))) node = node.expression;
  if (ts.isIdentifier(node) || ts.isPropertyAccessExpression(node)) return splitIdentifier(node.getText().replace(/\W+/g, ' ')).join(' ');
  if (ts.isStringLiteralLike(node) || ts.isTemplateExpression(node)) return 'some text';
  if (ts.isNumericLiteral(node)) return 'a number';
  if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) return 'a step to run';
  if (ts.isObjectLiteralExpression(node)) return 'some settings';
  if (ts.isArrayLiteralExpression(node)) return 'a list';
  return 'a value';
}

/**
 * Every call into a project's own functions whose meaning the mapper can only
 * guess from the name — the questions corrections.mjs asks, in plain English.
 * @param {string[]} files Source files.
 * @returns {{name: string, method: boolean, inputs: string[], reason: string, uses: number, at: string}[]} One gap per name, most-used first.
 */
export function findUserDomainGaps(files) {
  const byName = new Map();
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, /x$/.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const visit = (node) => {
      if (ts.isCallExpression(node) && (ts.isIdentifier(node.expression) || ts.isPropertyAccessExpression(node.expression))) {
        const method = ts.isPropertyAccessExpression(node.expression);
        const name = method ? node.expression.name.text : node.expression.text;
        const callee = node.expression.getText(sf).replace(/\?\./g, '.').replace(/\s+/g, '');
        const ours = JS_LEXICON.some((type) => type.covers(callee) && (!type.call.startsWith('.') || method));
        const mappable = /^[\w$]+(\.[\w$]+)*$/.test(callee) ? callee : `receiver.${name}`;
        if (!ours && !FRAMEWORK_CALLS.has(name) && !/router\.push$/i.test(callee)) {
          const type = /** @type {any} */ (mapUserCall(mappable));
          if (type.uncertain) {
            const gap = byName.get(name) ?? { name, method, inputs: node.arguments.map(inputWords), reason: type.uncertain, uses: 0, at: `${file}:${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1}` };
            gap.uses++;
            byName.set(name, gap);
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return [...byName.values()].sort((a, b) => b.uses - a.uses);
}
