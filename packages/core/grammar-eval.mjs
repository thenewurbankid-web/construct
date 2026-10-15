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

// ---- lint: rules every sentence obeys ------------------------------------

const PARTICLES = 'in|out|up|to|of|with|for|on|from|into|by|at';

/** Grammar rules, as [name, test] pairs; a test returns true on a violation.
 * Text inside `backticks` and 'quotes' is code or data, not English, and is
 * masked before testing.
 * @type {ReadonlyArray<[string, (s: string) => boolean]>} */
export const LINT_RULES = Object.freeze([
  ['empty sentence', (s) => !s.trim()],
  ['double space', (s) => / {2}/.test(s)],
  ['space before punctuation', (s) => / [,.;:]/.test(s)],
  ['repeated word', (s) => /\b(\w+) \1\b/i.test(s)],
  ['article before a particle', (s) => new RegExp(`\\b(the|a|an) (${PARTICLES})\\b`, 'i').test(s)],
  ['"a" before a vowel sound', (s) => /\ba [aeio]\w/i.test(s)],
  ['"an" before a consonant', (s) => /\ban [b-df-hj-np-tv-z]/i.test(s)],
  ['raw code outside backticks', (s) => /=>|[{};]|\w\(/.test(s)],
  ['dangling preposition', (s) => new RegExp(`\\b(${PARTICLES}|the|a|an|and)[.]?$`, 'i').test(s.trim())],
]);

/** Masks code and data spans so lint rules only see the English. */
function maskSpans(sentence) {
  return sentence.replace(/`[^`]*`/g, 'X').replace(/'[^']*'/g, 'X');
}

/**
 * The lint rules a sentence breaks.
 * @param {string} sentence One English sentence or phrase.
 * @returns {string[]} The names of the broken rules; empty when clean.
 */
export function lintSentence(sentence) {
  const masked = maskSpans(sentence);
  return LINT_RULES.filter(([, broken]) => broken(masked)).map(([name]) => name);
}

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
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, /x$/.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    for (const stmt of sf.statements) {
      const exported = /** @type {any} */ (stmt).modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
      if (!exported) continue;
      const raw = stmt.getText(sf).replace(/^export\s+(default\s+)?/, '');
      const line = sf.getLineAndCharacterOfPosition(stmt.getStart(sf)).line + 1;
      let english;
      try {
        english = describeImplementation(raw);
      } catch (err) {
        failures.push({ file, line, english: '', problem: `translator threw: ${err.message}` });
        continue;
      }
      checked++;
      for (const sentence of english.split(/(?<=\.) (?=[A-Z`'])/)) {
        for (const rule of lintSentence(sentence)) failures.push({ file, line, english: sentence, problem: rule });
        if (GAP_PATTERNS.some((p) => p.test(sentence))) gaps.push({ file, line, raw: raw.split('\n')[0].slice(0, 120), english: sentence });
      }
    }
  }
  return { checked, failures, gaps };
}
