// Naming in batch: atoms are extracted first under placeholder names, so the
// code compiles and runs while nothing waits on a name; then every placeholder
// is named in one batch — the person sees each one's code, our English for it,
// and suggested names to pick from or replace.
//
//   extractWithPlaceholders()  lifts every atom of one planning pass at once,
//                              as `pendingName1`, `pendingName2`, ... marked
//                              `@pending <our English>`.
//   namingSheet()              one entry per placeholder: snippet, English,
//                              options. Options come from the snippet's own
//                              shape (deterministic) and, if asked, a small
//                              model — which is given the English only.
//   applyNames()               renames each placeholder everywhere in the file
//                              (identifiers only, never inside strings) and
//                              turns `@pending` into `@does`.
import { ts } from '../../packages/ast/index.mjs';
import { planAtoms, applyAtoms, nameFromAnswer } from './atoms.mjs';
import { splitIdentifier } from './user-lexicon.mjs';
import { plainWords } from './corrections.mjs';

export const PLACEHOLDER_PREFIX = 'pendingName';
export const PENDING_TAG = 'pending';

function parse(source, fileName) {
  return ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, /x$/.test(fileName) ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
}

/**
 * Lifts every atom of one planning pass into a top-level function named by a
 * placeholder, marked `@pending` with our English for it.
 * @param {string} source A source file's text.
 * @param {string} [fileName] For the parser's dialect.
 * @returns {{source: string, placeholders: string[], needsPerson: object[]}} The rewritten source and the placeholders it introduced.
 */
export function extractWithPlaceholders(source, fileName = 'x.ts') {
  const { atoms, needsPerson } = planAtoms(source, fileName);
  let next = 1;
  while (source.includes(`${PLACEHOLDER_PREFIX}${next}`)) next++;
  const named = atoms.map((atom, i) => ({ atom, name: `${PLACEHOLDER_PREFIX}${next + i}`, does: '' }));
  const out = applyAtoms(source, named).replace(/\/\*\* @does {2}\*\/\n(function|async function) (pendingName\d+)/g, (m, kw, name) => {
    const entry = named.find((n) => n.name === name);
    return `/** @${PENDING_TAG} ${plainWords(entry.atom.english).replace(/\*\//g, '')} */\n${kw} ${name}`;
  });
  return { source: out, placeholders: named.map((n) => n.name), needsPerson };
}

// ---- suggestions from the snippet's own shape ---------------------------------

const METHOD_VERBS = { reduce: 'add up', map: 'turn', filter: 'pick', find: 'find', some: 'check any', every: 'check all', sort: 'sort', join: 'join', split: 'split', includes: 'check', slice: 'take part of', flatMap: 'collect', trim: 'clean', replace: 'rewrite', toLowerCase: 'normalize' };

const GENERIC = new Set(['i', 'j', 'k', 'x', 'n', 'a', 'b', 'el', 'item', 'value', 'sum', 'acc', 'length', 'Math', 'min', 'max', 'result', 'data', 'e', 'it']);

/** The things a snippet touches, as plain phrases from whole property chains
 * ("user region" for `user.region`), outermost first, generic words dropped. */
function nounsIn(node) {
  const phrases = [];
  const visit = (n) => {
    if (ts.isIdentifier(n) && (ts.isPropertyAssignment(n.parent) || ts.isShorthandPropertyAssignment(n.parent)) && n.parent.name === n && !ts.isShorthandPropertyAssignment(n.parent)) return; // an object key, not a thing touched
    const isChainTop = (ts.isPropertyAccessExpression(n) || ts.isIdentifier(n)) && !(ts.isPropertyAccessExpression(n.parent) && n.parent.expression === n) && !(ts.isPropertyAccessExpression(n.parent) && n.parent.name === n);
    if (isChainTop) {
      const parts = n.getText().split('.').filter((w) => !GENERIC.has(w) && !METHOD_VERBS[w] && /^[A-Za-z_$][\w$]*$/.test(w));
      const phrase = parts.flatMap((w) => splitIdentifier(w)).join(' ');
      if (phrase) phrases.push(phrase);
      if (ts.isIdentifier(n)) return;
    }
    if (ts.isPropertyAccessExpression(n) && METHOD_VERBS[n.name.text]) {
      visit(n.expression); // `order.items.reduce`: the thing is `order.items`
      return;
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return [...new Set(phrases)];
}

function leadVerb(node) {
  while (ts.isParenthesizedExpression(node)) node = node.expression;
  if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && METHOD_VERBS[node.expression.name.text]) return METHOD_VERBS[node.expression.name.text];
  if (ts.isConditionalExpression(node)) return 'choose';
  if (ts.isBinaryExpression(node)) {
    const k = node.operatorToken.kind;
    if ([ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken, ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.GreaterThanToken, ts.SyntaxKind.LessThanToken].includes(k)) return 'check';
    return 'work out';
  }
  if (ts.isObjectLiteralExpression(node)) return 'build';
  if (ts.isArrayLiteralExpression(node)) return 'list';
  if (ts.isTemplateExpression(node)) return 'write';
  return 'work out';
}

/**
 * Up to three names for a snippet, read off its own shape — the verb from what
 * it does at the top (a `reduce` adds up, a conditional chooses), the nouns
 * from what it touches. Deterministic; a starting point, not a decision.
 * @param {string} snippet The extracted expression's code.
 * @returns {string[]} Plain-word options: "add up the items price".
 */
export function suggestNames(snippet) {
  const sf = parse(`(${snippet});`, 's.ts');
  const expr = /** @type {any} */ (sf.statements[0])?.expression;
  if (!expr) return [];
  const v = leadVerb(expr);
  const nouns = nounsIn(expr);
  const options = [];
  if (nouns.length) options.push(`${v} the ${nouns[0]}`);
  if (nouns.length >= 2) options.push(`${v} the ${nouns[1]}`);
  if (nouns.length >= 2) options.push(`${v} the ${nouns[0]} ${nouns[nouns.length - 1].split(' ').pop()}`);
  return [...new Set(options)].filter((o) => !('error' in nameFromAnswer(o))).slice(0, 3);
}

// ---- the sheet ------------------------------------------------------------------

/**
 * One entry per placeholder in `source`: where it is, its code, our English
 * for it, and options to pick from.
 * @param {string} source A source file's text.
 * @param {string} [fileName] Its name.
 * @returns {{file: string, placeholder: string, line: number, snippet: string, english: string, options: string[], choice: string | null}[]} The sheet.
 */
export function namingSheet(source, fileName = 'x.ts') {
  const sf = parse(source, fileName);
  const out = [];
  for (const stmt of sf.statements) {
    if (!ts.isFunctionDeclaration(stmt) || !stmt.name?.text.startsWith(PLACEHOLDER_PREFIX)) continue;
    const tag = ts.getJSDocTags(stmt).find((t) => t.tagName.text === PENDING_TAG);
    const english = tag ? String(typeof tag.comment === 'string' ? tag.comment : ts.getTextOfJSDocComment(tag.comment) ?? '').trim() : '';
    const ret = stmt.body?.statements.find((s) => ts.isReturnStatement(s));
    const snippet = ret && ret.expression ? ret.expression.getText(sf) : stmt.body?.getText(sf) ?? '';
    out.push({ file: fileName, placeholder: stmt.name.text, line: sf.getLineAndCharacterOfPosition(stmt.getStart(sf)).line + 1, snippet, english, options: suggestNames(snippet), choice: null });
  }
  return out;
}

/**
 * The plain-English question a model answers for one sheet entry: English in, names out.
 * @param {{english: string}} entry A sheet entry.
 * @returns {string} The question.
 */
export function optionsQuestion(entry) {
  return (
    `Part of a program does this: ${entry.english} ` +
    'Suggest three short names for it, each starting with a plain action word, like “add up the prices” or “check the order is complete”. ' +
    'One per line, plain words only.'
  );
}

/**
 * A model's reply as options: one per line, numbering and quotes stripped, only those that make valid names.
 * @param {string} reply The model's reply.
 * @returns {string[]} Up to three options.
 */
export function parseOptions(reply) {
  return reply
    .split(/\n| \| /)
    .map((l) => l.replace(/^\s*(\d+[.)]|[-*•])\s*/, '').replace(/^["“'`]+|["”'`.!]+$/g, '').trim().toLowerCase())
    .filter((l) => l && !('error' in nameFromAnswer(l)))
    .slice(0, 3);
}

/**
 * Applies chosen names: each placeholder renamed everywhere in the file
 * (identifier nodes only), its `@pending` marker turned into `@does`.
 * Entries without a valid choice keep their placeholder.
 * @param {string} source A source file's text.
 * @param {{placeholder: string, choice: string | null}[]} entries Sheet entries with `choice` set to plain words.
 * @param {string} [fileName] For the parser's dialect.
 * @returns {{source: string, applied: {placeholder: string, name: string, does: string}[], skipped: {placeholder: string, error: string}[]}} The rewritten source and what happened per entry.
 */
export function applyNames(source, entries, fileName = 'x.ts') {
  const applied = [];
  const skipped = [];
  const renames = new Map();
  for (const e of entries) {
    if (!e.choice) {
      skipped.push({ placeholder: e.placeholder, error: 'no choice made' });
      continue;
    }
    const named = nameFromAnswer(e.choice);
    if ('error' in named) skipped.push({ placeholder: e.placeholder, error: named.error });
    else if ([...renames.values()].some((r) => r.name === named.name) || new RegExp(`\\b${named.name}\\b`).test(source)) skipped.push({ placeholder: e.placeholder, error: `the name ${named.name} is already taken` });
    else renames.set(e.placeholder, named);
  }
  const sf = parse(source, fileName);
  const edits = [];
  const visit = (n) => {
    if (ts.isIdentifier(n) && renames.has(n.text)) edits.push({ at: n.getStart(sf), end: n.getEnd(), text: renames.get(n.text).name });
    ts.forEachChild(n, visit);
  };
  visit(sf);
  for (const stmt of sf.statements) {
    if (ts.isFunctionDeclaration(stmt) && stmt.name && renames.has(stmt.name.text)) {
      for (const doc of ts.getJSDocCommentsAndTags(stmt).filter((d) => ts.isJSDoc(d))) {
        edits.push({ at: doc.getStart(sf), end: doc.getEnd(), text: `/** @does ${renames.get(stmt.name.text).does} */` });
      }
    }
  }
  edits.sort((x, y) => y.at - x.at);
  let out = source;
  for (const e of edits) out = out.slice(0, e.at) + e.text + out.slice(e.end);
  for (const [placeholder, { name, does }] of renames) applied.push({ placeholder, name, does });
  return { source: out, applied, skipped };
}
