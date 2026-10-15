// T4.3a: C3 gate results as LSP diagnostics, and its word fixes as quick-fix code actions.
// Plain LSP-shaped objects (Diagnostic, CodeAction, WorkspaceEdit, TextEdit); no LSP library.
// Contract: docs/line/FLUENT-PLAN-2026-10-15.md, "Wave 2 leaves" (t4-3a-diagnostics), C3 and the Fix shape.
import { parse } from '../../../line-smith/scripts/lib-sentence.mjs';

/** Checks in the order the gate runs them; the refusal belongs to the first failed one. */
const CHECK_ORDER = ['schema', 'grammar', 'equivalence', 'types'];
const SEVERITY_ERROR = 1;
const SOURCE = 'line-fluent';

/** Offsets where each line of `text` starts. */
function lineStarts(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1);
  return starts;
}

function offsetAt(starts, text, { line, character }) {
  if (line >= starts.length) return text.length;
  return Math.min(starts[line] + character, line + 1 < starts.length ? starts[line + 1] - 1 : text.length);
}

function positionAt(starts, offset) {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return { line: lo, character: offset - starts[lo] };
}

/** Index just past the `)` that closes the `(` at `open`, skipping strings and nested brackets. */
function closeParen(text, open) {
  let depth = 0;
  let quote = null;
  for (let i = open; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') quote = ch;
    else if ('([{'.includes(ch)) depth++;
    else if (')]}'.includes(ch) && --depth === 0) return i + 1;
  }
  return text.length;
}

/**
 * The calls of `sentence` with their offsets inside it: `word` is the name span, `call` the whole `word(args)`.
 * Words come from lib-sentence `parse`; the offsets are found by walking the text in the same order.
 */
export function wordSpans(sentence) {
  const spans = [];
  let cursor = 0;
  for (const { word } of parse(sentence)) {
    const start = sentence.indexOf(`${word}(`, cursor);
    if (start < 0) break;
    const end = closeParen(sentence, start + word.length);
    spans.push({ word, start, wordEnd: start + word.length, end });
    cursor = end;
  }
  return spans;
}

/** The word a fix names, if any. */
const fixWord = (fix) => (fix.kind === 'replace-word' ? fix.from : fix.kind === 'remove-word' ? fix.word : null);

/** The sentence's text and location inside the document. */
function locate(text, sentenceRange) {
  const starts = lineStarts(text);
  const base = offsetAt(starts, text, sentenceRange.start);
  const sentence = text.slice(base, offsetAt(starts, text, sentenceRange.end));
  const range = (from, to) => ({ start: positionAt(starts, base + from), end: positionAt(starts, base + to) });
  return { sentence, spans: wordSpans(sentence), range };
}

/**
 * One error Diagnostic per failed check of a C3 result. The first failed check carries the refusal as its
 * message; later ones carry their check name. When `text` (the document) is given and a fix names a word,
 * the first failed check's range is that word's span instead of the whole sentence.
 */
export function toDiagnostics(c3, { sentenceRange, text } = {}) {
  const failed = CHECK_ORDER.filter((name) => c3?.checks?.[name] === 'fail');
  let wordRange = null;
  if (text != null) {
    const named = (c3.fixes ?? []).map(fixWord).find(Boolean);
    if (named) {
      const { spans, range } = locate(text, sentenceRange);
      const span = spans.find((s) => s.word === named);
      if (span) wordRange = range(span.start, span.wordEnd);
    }
  }
  return failed.map((check, i) => ({
    range: i === 0 && wordRange ? wordRange : sentenceRange,
    severity: SEVERITY_ERROR,
    source: SOURCE,
    code: check,
    message: i === 0 && c3.refusal ? c3.refusal : check,
  }));
}

/**
 * Quick fixes for the C3 result's `replace-word` and `remove-word` fixes. Each is a CodeAction whose
 * WorkspaceEdit changes `uri` so the sentence reads as fixed. Removing a word also removes the dot that joins
 * it (the one before it, or after it when it is the first word). Other fix kinds have no text edit here.
 */
export function codeActions(c3, { uri, text, sentenceRange }) {
  const { spans, range } = locate(text, sentenceRange);
  const diagnostics = toDiagnostics(c3, { sentenceRange, text });
  const actions = [];
  for (const fix of c3?.fixes ?? []) {
    const word = fixWord(fix);
    const index = spans.findIndex((s) => s.word === word);
    if (index < 0) continue;
    const span = spans[index];
    let title;
    let edit;
    if (fix.kind === 'replace-word') {
      title = `Replace the word "${fix.from}" with "${fix.to}"`;
      edit = { range: range(span.start, span.wordEnd), newText: fix.to };
    } else {
      title = `Remove the word "${fix.word}"`;
      const [from, to] = index > 0 ? [spans[index - 1].end, span.end] : [span.start, spans[1] ? spans[1].start : span.end];
      edit = { range: range(from, to), newText: '' };
    }
    actions.push({
      title,
      kind: 'quickfix',
      diagnostics: diagnostics.slice(0, 1),
      isPreferred: actions.length === 0,
      edit: { changes: { [uri]: [edit] } },
    });
  }
  return actions;
}
