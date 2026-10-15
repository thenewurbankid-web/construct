// Atomic English sentences (ENGLISH-RULES.md): parse a fluent form into its words, read it
// aloud, and derive its plain name (R8). Shared by gen-atoms (for `reads`) and the grammar test.
//
//   parse('checks().if(a).is().greater().than(100)')
//     -> [{ word: 'checks', args: [] }, { word: 'if', args: ['a'] }, ..., { word: 'than', args: ['100'] }]

/** Splits `text` at top-level occurrences of `sep` (outside brackets and strings). */
function splitTop(text, sep) {
  const parts = [];
  let depth = 0;
  let quote = null;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') quote = ch;
    else if ('([{'.includes(ch)) depth++;
    else if (')]}'.includes(ch)) depth--;
    else if (ch === '=' && text[i + 1] === '>') i++;
    else if (depth === 0 && ch === sep) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts;
}

/** The calls of a fluent form, in order: each is a word and the arguments written after it. */
export function parse(sentence) {
  return splitTop(sentence, '.').map((call) => {
    const m = call.match(/^([A-Za-z_$][\w$]*)\(([\s\S]*)\)$/);
    if (!m) throw new Error(`not a call: ${call} (in ${sentence})`);
    const inner = m[2].trim();
    return { word: m[1], args: inner ? splitTop(inner, ',').map((a) => a.trim()) : [] };
  });
}

/** The calls of the action, without the R10 return clause (`.andThe().<name>()`): what reads and names come from. */
export function actionCalls(sentence) {
  const calls = parse(sentence);
  const k = calls.findIndex((c) => c.word === 'andThe');
  return k < 0 ? calls : calls.slice(0, k);
}

/** An argument as it is read: `() => body` and `(e) => recover` read as their result. */
const spoken = (arg) => arg.replace(/^(?:\(\s*[\w$,\s]*\)|[\w$]+)\s*=>\s*/, '');

/** The sentence read aloud: `checks().if(a).is().greater().than(b)` -> "checks if a is greater than b". */
export function reading(sentence) {
  return actionCalls(sentence)
    .map(({ word, args }) => [word, ...args.map(spoken)].join(' '))
    .join(' ');
}

/**
 * R8: the plain name is the words after the subject, in camelCase. A question drops its
 * `checks().if(x)`; a copy keeps `clones` and drops its subject; a subject-led sentence drops
 * the subject. Sentences without a subject (when, chooses, matches, attempts) have no plain name.
 */
export function plainName(sentence, subjects) {
  const calls = actionCalls(sentence);
  let rest;
  if (calls[0].word === 'checks' && calls[1]?.word === 'if') rest = calls.slice(2);
  else if (calls[0].word === 'clones' && subjects.includes(calls[1]?.word)) rest = [calls[0], ...calls.slice(2)];
  else if (subjects.includes(calls[0].word)) rest = calls.slice(1);
  else return null;
  if (!rest.length) return null;
  return rest.map(({ word }, i) => (i ? word[0].toUpperCase() + word.slice(1) : word)).join('');
}
