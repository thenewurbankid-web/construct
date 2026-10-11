// The one place Construct edits a user's YAML (architecture.yml, story.md front matter) in place.
//
// Rewriting such a file with a dump of its parsed value deletes every comment and reorders keys, so a
// one-rule severity toggle in Cockpit used to throw away the notes a person kept next to their rules.
// Every edit here goes through the `yaml` package's Document model instead (parseDocument, then
// setIn/deleteIn on the nodes, then toString with the file's own indentation): comments, blank lines,
// key order and quoting of every untouched node survive, and only the edited value changes.
//
// This module only computes text. Writing it to disk stays with Construct's writer
// (packages/engine/transactionalWriter.mjs), as every other project write does.
import { isMap, isScalar, isSeq, LineCounter, parseDocument, visit } from 'yaml';

/**
 * One edit to a YAML document. `path` is the list of keys (map keys as strings, sequence indexes as numbers).
 * - `set`: put `value` at `path`, creating missing parents. A scalar replacing a scalar keeps the node, so a
 *   comment on that line (`PAGE-001: error # why`) stays.
 * - `delete`: remove the key or sequence item at `path` (nothing happens when it is missing).
 * - `push`: append `value` to the sequence at `path`; when there is no sequence there yet, `path` becomes `[value]`.
 * `inlineLists: true` writes every list of plain values inside `value` in flow style (`rules: [A, B]`).
 * @typedef {{op: 'set' | 'push', path: (string|number)[], value: unknown, inlineLists?: boolean} | {op: 'delete', path: (string|number)[]}} YamlEdit
 */

/** A YAML text that cannot be parsed or edited, with the 1-based line and column of the problem when known. */
export class YamlEditError extends Error {
  /**
   * @param {string} message What is wrong, in plain English.
   * @param {{code?: string, line?: number|null, col?: number|null}} [where] `code` is 'PARSE' or 'BAD_EDIT'.
   */
  constructor(message, { code = 'PARSE', line = null, col = null } = {}) {
    super(message);
    this.name = 'YamlEditError';
    this.code = code;
    this.line = line;
    this.col = col;
  }
}

/**
 * Parse YAML text into an editable Document, refusing any text with a syntax error. The error names the line and
 * column (via `LineCounter`), so a person can find the problem in their file.
 *
 * @param {string} text The YAML text ('' is an empty document).
 * @param {string} [label] What the text is, for the error sentence (default 'The YAML').
 * @returns {import('yaml').Document} The parsed document, comments and order kept.
 * @throws {YamlEditError} With `code` 'PARSE' and the position of the first error.
 *
 * @example
 * parseYamlDocument('a: 1 # one\n').toString(); // => 'a: 1 # one\n'
 */
export function parseYamlDocument(text, label = 'The YAML') {
  const lineCounter = new LineCounter();
  const doc = parseDocument(text ?? '', { lineCounter, prettyErrors: false, keepSourceTokens: false });
  const first = doc.errors[0];
  if (first) {
    const { line, col } = lineCounter.linePos(first.pos[0]);
    const reason = String(first.message).split('\n')[0].replace(/\s*at line \d+, column \d+:?$/, '');
    throw new YamlEditError(`${label} is not valid YAML at line ${line}, column ${col}: ${reason}`, { code: 'PARSE', line, col });
  }
  return doc;
}

/** The indentation the file already uses: spaces per level, and whether a list sits one level in under its key. */
function formatOf(text) {
  const lines = String(text ?? '').split(/\r?\n/);
  // Indent: how far a key's first nested key sits in from it (`a:` then `  b:` is 2), list items aside.
  let indent = 2;
  for (let i = 0; i + 1 < lines.length; i += 1) {
    const key = /^((?: *- +)*| *)[^\s#-][^#]*:[ \t]*(#.*)?$/.exec(lines[i]);
    const child = key && /^( *)[^\s#-]/.exec(lines[i + 1]);
    if (child && child[1].length > key[1].length) { indent = child[1].length - key[1].length; break; }
  }
  let indentSeq = true;
  for (let i = 0; i + 1 < lines.length; i += 1) {
    const key = /^( *)[^\s#-][^#]*:[ \t]*(#.*)?$/.exec(lines[i]);
    const item = key && /^( *)- /.exec(lines[i + 1]);
    if (item) { indentSeq = item[1].length > key[1].length; break; }
  }
  return { indent, indentSeq };
}

function toNode(doc, value, inlineLists) {
  const node = doc.createNode(value);
  if (inlineLists) {
    visit(node, { Seq: (_, seq) => { if (seq.items.every((x) => isScalar(x))) seq.flow = true; } });
  }
  return node;
}

/** Put `value` at `where`, reusing the nodes already there: a scalar keeps its node (and its comment), a map or
 * list is updated key by key and item by item, so the parts that do not change stay exactly as written. */
function setValue(doc, where, value, inlineLists) {
  const current = doc.getIn(where, true);
  if (value === null || typeof value !== 'object' || value instanceof Date) {
    if (isScalar(current)) { current.value = value; return; }
  } else if (Array.isArray(value)) {
    if (isSeq(current)) {
      current.items.length = Math.min(current.items.length, value.length);
      value.forEach((v, i) => {
        if (i < current.items.length) setValue(doc, [...where, i], v, inlineLists);
        else current.add(toNode(doc, v, inlineLists));
      });
      return;
    }
  } else if (isMap(current)) {
    const keys = new Set(Object.keys(value));
    for (const pair of [...current.items]) {
      if (!keys.has(String(isScalar(pair.key) ? pair.key.value : pair.key))) current.delete(pair.key);
    }
    for (const [k, v] of Object.entries(value)) {
      if (current.has(k)) setValue(doc, [...where, k], v, inlineLists);
      else current.set(k, toNode(doc, v, inlineLists));
    }
    return;
  }
  doc.setIn(where, toNode(doc, value, inlineLists));
}

function applyEdit(doc, edit) {
  const where = Array.isArray(edit?.path) ? edit.path : null;
  if (!where || where.length === 0) throw new YamlEditError('Every YAML edit needs a non-empty path.', { code: 'BAD_EDIT' });
  if (edit.op === 'delete') {
    if (doc.hasIn(where)) doc.deleteIn(where);
    return;
  }
  // An empty key (`rules:` with nothing under it) holds a null scalar; turn it into the collection the edit needs.
  for (let i = 1; i < where.length; i += 1) {
    const parent = doc.getIn(where.slice(0, i), true);
    if (isScalar(parent) && parent.value == null) doc.setIn(where.slice(0, i), doc.createNode(typeof where[i] === 'number' ? [] : {}));
  }
  if (edit.op === 'set') {
    setValue(doc, where, edit.value, edit.inlineLists);
    return;
  }
  if (edit.op === 'push') {
    const current = doc.getIn(where, true);
    // An empty placeholder list (`sources: []`) becomes a block list once it holds something, unless asked inline.
    // Its trailing comment moves to the top of the list, so it stays next to the key.
    if (isSeq(current) && current.flow && current.items.length === 0 && !edit.inlineLists) {
      current.flow = false;
      if (current.comment) { current.commentBefore = [current.commentBefore, current.comment].filter(Boolean).join('\n'); current.comment = undefined; }
    }
    if (isSeq(current)) current.add(toNode(doc, edit.value, edit.inlineLists));
    else doc.setIn(where, toNode(doc, [edit.value], edit.inlineLists));
    return;
  }
  throw new YamlEditError(`Unknown YAML edit "${String(edit?.op)}"; use set, delete or push.`, { code: 'BAD_EDIT' });
}

/**
 * Apply edits to YAML text and return the new text, keeping every comment, blank line, key order and quoting
 * outside the edited values, and the file's own indentation. `edits` may be a function of the current data (plain
 * JS, as the `yaml` package reads it) when an edit depends on what is there, such as the index of a list entry.
 *
 * @param {string} text The current YAML text ('' for a new file).
 * @param {YamlEdit[] | ((data: any) => YamlEdit[])} edits The edits, applied in order.
 * @param {{label?: string}} [options] `label` names the text in a parse error (default 'The YAML').
 * @returns {string} The edited text, ending in a newline.
 * @throws {YamlEditError} When `text` does not parse (with its line and column) or an edit is malformed.
 *
 * @example
 * editYamlDocument('rules:\n  PAGE-001: error # thin pages\n', [{ op: 'set', path: ['rules', 'PAGE-001'], value: 'off' }]);
 * // => 'rules:\n  PAGE-001: off # thin pages\n'
 */
export function editYamlDocument(text, edits, { label = 'The YAML' } = {}) {
  const doc = parseYamlDocument(text, label);
  const list = typeof edits === 'function' ? edits(doc.toJS()) : edits;
  for (const edit of list ?? []) applyEdit(doc, edit);
  return doc.toString({ ...formatOf(text), lineWidth: 0, flowCollectionPadding: false });
}

const FRONT_MATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

/**
 * Split a Markdown file into its YAML front matter (between the opening and closing `---` lines) and the text
 * after it. The one front-matter pattern Construct uses.
 *
 * @param {string} text The whole file.
 * @returns {{frontMatter: string|null, block: string, body: string}} `frontMatter` is the YAML inside the fences
 *   (null when the file has none), `block` the fences and YAML exactly as written ('' when none), and `body` the rest.
 *
 * @example
 * splitFrontMatter('---\na: 1\n---\n# Hi\n'); // => { frontMatter: 'a: 1', block: '---\na: 1\n---\n', body: '# Hi\n' }
 */
export function splitFrontMatter(text) {
  const all = text ?? '';
  const m = FRONT_MATTER.exec(all);
  if (!m) return { frontMatter: null, block: '', body: all };
  return { frontMatter: m[1], block: m[0], body: all.slice(m[0].length) };
}

/**
 * Put YAML front matter back in front of a Markdown body: the inverse of `splitFrontMatter`.
 *
 * @param {string} frontMatter The YAML text (a trailing newline is trimmed).
 * @param {string} body The text after the front matter, unchanged.
 * @returns {string} `---\n<yaml>\n---\n<body>`.
 *
 * @example
 * joinFrontMatter('a: 1\n', '# Hi\n'); // => '---\na: 1\n---\n# Hi\n'
 */
export function joinFrontMatter(frontMatter, body) {
  return `---\n${String(frontMatter ?? '').trimEnd()}\n---\n${body ?? ''}`;
}

/**
 * Edit a Markdown file's front matter in place with `editYamlDocument`, leaving the body byte for byte. A file
 * with no front matter gets one.
 *
 * @param {string} text The whole file.
 * @param {YamlEdit[] | ((data: any) => YamlEdit[])} edits As for `editYamlDocument`.
 * @param {{label?: string}} [options] `label` names the front matter in a parse error.
 * @returns {string} The whole file with the edited front matter.
 * @throws {YamlEditError} When the front matter does not parse or an edit is malformed.
 *
 * @example
 * editFrontMatter('---\n# kept\ntitle: A\n---\nBody\n', [{ op: 'set', path: ['title'], value: 'B' }]);
 * // => '---\n# kept\ntitle: B\n---\nBody\n'
 */
export function editFrontMatter(text, edits, { label = 'The front matter' } = {}) {
  const { frontMatter, body } = splitFrontMatter(text);
  return joinFrontMatter(editYamlDocument(frontMatter ?? '', edits, { label }), body);
}
