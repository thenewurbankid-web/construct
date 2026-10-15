// Corrections: closing the controlled English where it can't decide alone.
//
// When the user-domain mapper (user-lexicon.mjs) can only guess what a
// function does from its name, the guess becomes a question — in plain,
// non-technical English, never code — for the user or a small local model.
// The answer is plain English too ("turns it into a syntax tree"), and it is
// parsed by our grammar, not trusted: it must start with an action word (or
// "the"/"a" for a value), "it" marks where the function's inputs go, and the
// sentence it builds must lint clean. An accepted answer is stored and from
// then on overrides the name-based guess; a rejected one is asked again with
// the reason, in English.
//
// Every answer is a mapping, not a separate entry: it maps a name onto the
// same grammar primitives every other sentence is built from.
import { ts } from '../../packages/ast/index.mjs';
import { action, value, verb, args, opt, target, BE, HAVE, lintSentence } from './grammar.mjs';
import { splitIdentifier } from './user-lexicon.mjs';

/** The small local model that answers by default. */
export const DEFAULT_GRAMMAR_MODEL = 'qwen3:1.7b';

/** The JSDoc tag that marks a top-level function with its English. */
export const DOES_TAG = 'does';

// ---- questions --------------------------------------------------------------

/**
 * Code spans become plain quoted words: "`form.user`" -> "“form user”".
 * @param {string} english Our English.
 * @returns {string} The same, with no code in it.
 */
export function plainWords(english) {
  return english.replace(/`([^`]*)`/g, (_, code) => `“${splitIdentifier(code.replace(/\W+/g, ' ')).join(' ')}”`);
}

/**
 * The plain-English questions for one uncertain name: what it does, and what a
 * clearer name would be. No code, no technical terms.
 * @param {{name: string, inputs: string[]}} gap The function's name and, as plain words, what it is given.
 * @returns {{name: string, does: string, rename: string}} The two questions.
 */
export function questionsFor({ name, inputs }) {
  const called = splitIdentifier(name).join(' ');
  const given = inputs.length ? `, and it is given ${inputs.map((i) => `“${i}”`).join(' and ')}` : '';
  return {
    name,
    does:
      `A step in this program is called “${called}”${given}. ` +
      'In a few plain words, what does it do? Start with an action word, and say “it” for what it is given — ' +
      'for example “turns it into a list” or “checks that it is filled in”. If it produces something instead, start with “the”, like “the total of it”.',
    rename: `What would be a clearer name for the step called “${called}”? Answer with two to four plain words.`,
  };
}

// ---- answers ----------------------------------------------------------------

const IRREGULAR = { has: 'have', is: 'be', does: 'do', goes: 'go' };

/**
 * "turns" -> "turn", "copies" -> "copy", "fetches" -> "fetch".
 * @param {string} word A word.
 * @returns {string | null} The verb's bare form, or null when the word isn't a third-person verb.
 */
export function lemmaOf(word) {
  if (IRREGULAR[word]) return IRREGULAR[word];
  if (/[^aeiou]ies$/.test(word)) return word.slice(0, -3) + 'y';
  if (/(ch|sh|ss|x|z|o)es$/.test(word)) return word.slice(0, -2);
  if (/[^s]s$/.test(word) && word.length > 2) return word.slice(0, -1);
  return null;
}

/** "it"/"them" mark where the inputs go; the rest is fixed words. */
function toParts(words, method) {
  const parts = [];
  let usedInputs = false;
  let buffer = [];
  const flush = () => buffer.length && (parts.push(buffer.join(' ')), (buffer = []));
  for (const w of words) {
    if (w === 'it' || w === 'them') {
      flush();
      parts.push(method ? target() : args());
      usedInputs = true;
    } else buffer.push(w);
  }
  flush();
  return { parts, usedInputs };
}

/**
 * Parses a plain-English answer into a sentence type for `name`, through our
 * grammar. Rejects — with a reason, in English — anything that doesn't fit.
 * @param {string} name The function's name.
 * @param {string} answer The answer: "turns it into a syntax tree".
 * @param {{method?: boolean}} [opts] Whether the name is called on a receiver.
 * @returns {{type: any, english: string} | {error: string}} The sentence type and a sample sentence, or why it was rejected.
 */
export function parseAnswer(name, answer, { method = false } = {}) {
  const cleaned = answer
    .trim()
    .split('\n')[0]
    .replace(/^["“'`]+|["”'`.!]+$/g, '')
    .replace(/^(it|this step|the step)\s+/i, '')
    .trim();
  const words = cleaned.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return { error: 'The answer was empty.' };
  if (words.length > 12) return { error: 'The answer was too long; please use a few words.' };
  if (!words.every((w) => /^[a-z][a-z'-]*$/.test(w))) return { error: 'Please answer in plain words only, without symbols or code.' };
  const call = method ? `.${name}` : name;

  let type;
  if (['the', 'a', 'an', 'whether'].includes(words[0])) {
    const { parts, usedInputs } = toParts(words, method);
    type = value(call, ...parts, ...(usedInputs ? [] : [opt('of', method ? target() : args())]));
  } else {
    const lemma = lemmaOf(words[0]);
    if (!lemma) return { error: `“${words[0]}” is not an action word in the form “turns” or “checks”; please start with one.` };
    const v = lemma === 'be' ? BE : lemma === 'have' ? HAVE : verb(lemma);
    const { parts, usedInputs } = toParts(words.slice(1), method);
    type = action(call, v, ...parts, ...(usedInputs ? [] : [opt('using', method ? target() : args())]));
  }

  const sample = new type({ args: [{ english: '`input`', js: 'input', bare: null }], target: method ? { english: '`input`', js: 'input' } : null });
  const english = sample.toEnglish();
  if (english == null) return { error: 'The answer could not be turned into a sentence.' };
  const broken = lintSentence(english);
  if (broken.length) return { error: `The answer reads badly in a sentence (${broken.join(', ')}): “${plainWords(english)}”.` };
  return { type, english };
}

/**
 * "turn into syntax tree" -> "turnIntoSyntaxTree".
 * @param {string} plain Plain words.
 * @returns {string} An identifier.
 */
export function toIdentifier(plain) {
  const words = plain.toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(Boolean).slice(0, 5);
  return words.map((w, i) => (i ? w[0].toUpperCase() + w.slice(1) : w)).join('');
}

// ---- markers: the answer lives on the function ---------------------------

function topLevelFunctions(sf) {
  const out = [];
  for (const stmt of sf.statements) {
    if (ts.isFunctionDeclaration(stmt) && stmt.name) out.push({ name: stmt.name.text, node: stmt });
    if (ts.isVariableStatement(stmt)) {
      for (const d of stmt.declarationList.declarations) {
        if (ts.isIdentifier(d.name) && d.initializer && (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer))) out.push({ name: d.name.text, node: stmt });
      }
    }
  }
  return out;
}

function parse(source, fileName) {
  return ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, /x$/.test(fileName) ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
}

/**
 * The `@does` marker on a top-level declaration, if any.
 * @param {any} node A top-level statement.
 * @returns {string | null} The marker's English.
 */
export function doesMarker(node) {
  const tag = ts.getJSDocTags(node).find((t) => t.tagName.text === DOES_TAG);
  const comment = tag && (typeof tag.comment === 'string' ? tag.comment : ts.getTextOfJSDocComment(tag.comment));
  return comment ? comment.trim() : null;
}

/**
 * A top-level statement's text with its directly-preceding doc comment, so a
 * marker travels with the declaration it marks.
 * @param {any} stmt The statement.
 * @param {any} sf Its source file.
 * @returns {string} The doc comment (if any) and the statement.
 */
export function withLeadingDoc(stmt, sf) {
  const docs = ts.getJSDocCommentsAndTags(stmt).filter((d) => ts.isJSDoc(d));
  const start = docs.length ? docs[0].getStart(sf) : stmt.getStart(sf);
  return sf.text.slice(start, stmt.getEnd());
}

/**
 * The `@does` markers in a set of sources, as plain data: function name -> English.
 * @param {{file: string, source: string}[]} sources Source texts with their file names.
 * @returns {Record<string, string>} The markers.
 */
export function markersIn(sources) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const { file, source } of sources) {
    for (const { name, node } of topLevelFunctions(parse(source, file))) {
      const does = doesMarker(node);
      if (does) out[name] = does;
    }
  }
  return out;
}

/**
 * The marked top-level functions in a set of sources.
 * @param {{file: string, source: string}[]} sources Source texts with their file names.
 * @returns {Map<string, any>} Sentence types keyed by function name (markers that no longer parse are skipped).
 */
export function markerTypes(sources) {
  const map = new Map();
  for (const { file, source } of sources) {
    for (const { name, node } of topLevelFunctions(parse(source, file))) {
      const does = doesMarker(node);
      if (!does) continue;
      const parsed = parseAnswer(name, does);
      if ('type' in parsed) map.set(name, parsed.type);
    }
  }
  return map;
}

/**
 * Writes an accepted answer onto the function it describes, as a `@does`
 * marker in its doc comment (added, or replacing an older marker).
 * @param {string} source The source that defines the function.
 * @param {string} name The function's name.
 * @param {string} does The English: "turns it into a syntax tree".
 * @param {string} [fileName] For the parser's dialect.
 * @returns {string | null} The new source, or null when `name` isn't a top-level function there.
 */
export function markFunction(source, name, does, fileName = 'x.ts') {
  const sf = parse(source, fileName);
  const found = topLevelFunctions(sf).find((f) => f.name === name);
  if (!found) return null;
  const line = `@${DOES_TAG} ${does.replace(/\*\//g, '').replace(/[.\s]+$/, '')}`;
  const docs = ts.getJSDocCommentsAndTags(found.node).filter((d) => ts.isJSDoc(d));
  if (!docs.length) {
    const start = found.node.getStart(sf);
    const indent = /[ \t]*$/.exec(source.slice(0, start))[0];
    return `${source.slice(0, start)}/** ${line} */\n${indent}${source.slice(start)}`;
  }
  const doc = docs[docs.length - 1];
  const text = doc.getText(sf);
  const next = new RegExp(`@${DOES_TAG}\\b[^\\n*]*`).test(text)
    ? text.replace(new RegExp(`@${DOES_TAG}\\b[^\\n*]*`), line)
    : text.includes('\n')
      ? text.replace(/\s*\*\/$/, `\n * ${line}\n */`)
      : text.replace(/\s*\*\/$/, ` ${line} */`);
  return source.slice(0, doc.getStart(sf)) + next + source.slice(doc.getEnd());
}

// ---- the loop -----------------------------------------------------------------

/**
 * Asks about every gap, parses each answer through the grammar, re-asks once
 * with the reason when an answer doesn't fit, and returns what to store.
 * `ask` is whoever answers — the user, or a small model — and only ever sees
 * plain English.
 * @param {{name: string, inputs: string[], method?: boolean}[]} gaps Uncertain names.
 * @param {(question: string) => Promise<string>} ask Answers one question.
 * @param {{retries?: number, concurrency?: number}} [opts] How many times to re-ask a rejected answer, and how many names to ask about at once (a model answers in parallel; a person, one at a time).
 * @returns {Promise<{accepted: {name: string, does: string, english: string, rename?: string}[], rejected: {name: string, answer: string, error: string}[]}>} The outcome per name.
 */
export async function correctGaps(gaps, ask, { retries = 1, concurrency = 1 } = {}) {
  const accepted = [];
  const rejected = [];
  const queue = [...gaps];
  const worker = async () => {
    for (let gap = queue.shift(); gap; gap = queue.shift()) await settle(gap);
  };
  const settle = async (gap) => {
    const q = questionsFor(gap);
    let question = q.does;
    let answer = '';
    let outcome = null;
    for (let attempt = 0; attempt <= retries; attempt++) {
      answer = (await ask(question)).trim();
      outcome = parseAnswer(gap.name, answer, { method: gap.method });
      if ('type' in outcome) break;
      question = `${q.does}\n\nYour last answer was “${answer}”. ${'error' in outcome ? outcome.error : ''}`;
    }
    if (outcome && 'type' in outcome) {
      const rename = toIdentifier((await ask(q.rename)).trim());
      accepted.push({ name: gap.name, does: answer.split('\n')[0].trim(), english: outcome.english, ...(rename ? { rename } : {}) });
    } else {
      rejected.push({ name: gap.name, answer, error: outcome && 'error' in outcome ? outcome.error : 'no answer' });
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));
  const order = new Map(gaps.map((g, i) => [g.name, i]));
  const byOrder = (x, y) => order.get(x.name) - order.get(y.name);
  return { accepted: accepted.sort(byOrder), rejected: rejected.sort(byOrder) };
}
