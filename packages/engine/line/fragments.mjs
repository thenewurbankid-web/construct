// cx1 of the Line Cockpit (contract.mjs CodeFragment, SetFragmentRequest): spot code editing without the whole file.
// listFragments reads one library or feature code file and returns the small pieces a person may edit in place (a
// prop's value expression, an event handler, a condition, a style value), each with a plain-English label and its
// exact range. planSetFragment stages replacing ONLY that range: it refuses a stale file (STALE), code that is not
// one expression or would not parse in place (BAD_CODE, the parser's message under detail), and code that adds a
// TypeScript error when the project has a tsconfig (TYPE_ERROR). Pure: nothing is written; applyChange (ops.mjs)
// lands the change through Construct's writer and the Line validate gate (so a new cross-feature import is refused).
//
// Built on the Pages editor's JSX reader (packages/ast parseJsxTree via pagesEditor.mjs), so fragment node ids are the
// page-tree ids readPageTree serves, and on diagnostics.mjs's typescriptDiagnostics for the type check.
import fs from 'node:fs';
import path from 'node:path';
import { parsePageTree, hashOf } from '../pagesEditor.mjs';
import { walkAst, jsxParseError } from '@construct/ast';
import { ts } from '@construct/ast/lazy';
import { typescriptDiagnostics } from '../diagnostics.mjs';
import { loadConfig } from '@line/construct-core/config';
import { normalizeLineConfig, CODE_EXTENSIONS } from '@line/construct-core/profiles/line/contract';
import { resolveLayout } from '@line/construct-core/profiles/line/checks';
import { LineOpError } from './contract.mjs';

/** Above this, the type check is too slow to block a save; it still runs and its result rides along (see gap note). */
export const TYPE_CHECK_BUDGET_MS = 3000;
// The same override the type gate reads (typeGate.mjs): a test pins it high so a loaded machine cannot flip a
// refusal into a "too slow to block" warning (#882).
const typeCheckBudgetMs = () => Number(process.env.LINE_TYPE_GATE_BUDGET_MS) || TYPE_CHECK_BUDGET_MS;

const HANDLER_EVENTS = {
  Click: 'is clicked', DoubleClick: 'is double-clicked', Change: 'changes', Submit: 'is submitted', Input: 'gets input',
  Focus: 'gets focus', Blur: 'loses focus', KeyDown: 'gets a key press', KeyUp: 'gets a key press', KeyPress: 'gets a key press',
  MouseEnter: 'is hovered', MouseLeave: 'is no longer hovered', Select: 'is selected', Open: 'is opened', Close: 'is closed',
};
const STYLE_PROPS = new Set(['style', 'className', 'sx', 'css']);
const WHO_PROPS = ['label', 'title', 'name', 'aria-label', 'alt', 'placeholder'];

const words = (camel) => camel.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();

/** Resolve a root-relative code file inside the Line library or features folder, or refuse with UNKNOWN_ITEM. */
function readCodeFile(root, file) {
  const unknown = () => new LineOpError(`There is no code file "${file}" in this project's library or features.`, 'UNKNOWN_ITEM');
  if (typeof file !== 'string' || !file || path.isAbsolute(file) || file.includes('\\') || file.split('/').some((s) => s === '..' || s === '' || s === '.')) throw unknown();
  const { library, features } = resolveLayout(root, normalizeLineConfig(/** @type {any} */ (loadConfig(root)).line));
  if (![library, features].some((dir) => file.startsWith(`${dir}/`))) throw unknown();
  if (!CODE_EXTENSIONS.includes(path.extname(file))) throw unknown();
  let real;
  try { real = fs.realpathSync(path.join(root, file)); } catch { throw unknown(); }
  const realRoot = fs.realpathSync(root);
  if (!real.startsWith(realRoot + path.sep) || !fs.statSync(real).isFile()) throw unknown();
  return { abs: real, source: fs.readFileSync(real, 'utf8') };
}

/** How a person would name an element: its label/title/... text, its own text, else its tag. */
function whoOf(record) {
  if (!record) return 'this part';
  for (const name of WHO_PROPS) {
    const p = record.props.find((x) => x.name === name && x.kind === 'string' && String(x.value).trim());
    if (p) return String(p.value).trim();
  }
  const text = (record.content || []).filter((c) => c.kind === 'text').map((c) => c.value).join(' ').replace(/\s+/g, ' ').trim();
  if (text && text.length <= 40) return text;
  return record.isFragment ? 'this part' : record.tag;
}

function handlerLabel(attr, who) {
  const event = attr.slice(2);
  return HANDLER_EVENTS[event] ? `What happens when ${who} ${HANDLER_EVENTS[event]}` : `What happens when ${who} asks for ${words(event)}`;
}

/**
 * Every fragment of `source`, in source order. Pure.
 * @param {string} source
 * @param {string} file
 * @param {{literals?: boolean}} [opts] literals: also list number and yes/no values (used to re-check an edit).
 * @returns {import('./contract.mjs').CodeFragment[]}
 */
export function fragmentsOf(source, file, { literals = false } = {}) {
  const { byId, ast } = parsePageTree(source);
  const contentHash = hashOf(source);
  const records = [...byId.values()];
  const byStart = new Map(records.map((r) => [r.start, r]));
  /** The innermost element record containing [start, end), preferring a real element over a <>...</>. */
  const enclosing = (start, end) => {
    const inside = records.filter((r) => r.start <= start && end <= r.end);
    const elements = inside.filter((r) => !r.isFragment);
    const pick = (list) => list.reduce((best, r) => (!best || r.end - r.start < best.end - best.start ? r : best), null);
    return pick(elements) || pick(inside);
  };
  /** @type {import('./contract.mjs').CodeFragment[]} */
  const out = [];
  const ids = new Set();
  const push = (kind, record, key, label, node) => {
    let id = `${kind}:${record.id}:${key}`;
    for (let k = 2; ids.has(id); k++) id = `${kind}:${record.id}:${key}~${k}`;
    ids.add(id);
    const [start, end] = node.range;
    out.push({ id, file, kind, label, code: source.slice(start, end), range: { start, end }, contentHash, nodeId: record.id });
  };
  walkAst(ast, {
    /** JSX nodes are not in the ESTree types. @param {any} node @param {any} parent */
    enter(node, parent) {
      if (node.type === 'JSXAttribute' && node.value?.type === 'JSXExpressionContainer' && node.value.expression.type !== 'JSXEmptyExpression') {
        const expr = node.value.expression;
        if (!literals && expr.type === 'Literal' && typeof expr.value !== 'string') return; // numbers and yes/no are no-code props
        const opening = parent; // JSXOpeningElement
        const record = enclosing(opening.range[0], opening.range[1]);
        if (!record) return;
        const name = node.name.type === 'JSXNamespacedName' ? `${node.name.namespace.name}:${node.name.name.name}` : node.name.name;
        const who = whoOf(record);
        if (/^on[A-Z]/.test(name)) push('handler', record, name, handlerLabel(name, who), expr);
        else if (STYLE_PROPS.has(name)) push('style', record, name, `How ${who} looks (${name})`, expr);
        else push('prop-expression', record, name, `The value of ${name} on ${who}`, expr);
        return;
      }
      if (node.type === 'JSXExpressionContainer' && (parent?.type === 'JSXElement' || parent?.type === 'JSXFragment')) {
        const expr = node.expression;
        if (expr.type === 'LogicalExpression' && expr.operator === '&&') {
          const shown = byStart.get(expr.right.range[0]);
          const record = shown || enclosing(node.range[0], node.range[1]);
          if (record) push('condition', record, 'shows', `When ${whoOf(shown || record)} shows`, expr.left);
        } else if (expr.type === 'ConditionalExpression') {
          const yes = byStart.get(expr.consequent.range[0]);
          const no = byStart.get(expr.alternate.range[0]);
          const record = yes || enclosing(node.range[0], node.range[1]);
          if (record) push('condition', record, 'which', `Whether ${whoOf(yes || record)} shows${no ? ` instead of ${whoOf(no)}` : ''}`, expr.test);
        }
      }
    },
  });
  return out.sort((a, b) => a.range.start - b.range.start);
}

/**
 * Every editable fragment of one library or feature code file.
 * @param {string} root Project root.
 * @param {string} file Root-relative path.
 * @returns {import('./contract.mjs').FragmentList}
 * @throws {LineOpError} UNKNOWN_ITEM when there is no such file or it does not parse.
 */
export function listFragments(root, file) {
  const { source } = readCodeFile(root, file);
  let fragments;
  try { fragments = fragmentsOf(source, file); } catch (e) {
    throw new LineOpError(`The file "${file}" does not parse, so its code cannot be edited in pieces until it is fixed.`, 'UNKNOWN_ITEM', /** @type {Error} */ (e).message);
  }
  return { file, contentHash: hashOf(source), fragments };
}

/** The tsconfig.json that governs `abs`, only when it lies inside the project; else null. */
function tsconfigInside(root, abs) {
  const realRoot = fs.realpathSync(root);
  const found = ts.findConfigFile(path.dirname(abs), ts.sys.fileExists, 'tsconfig.json');
  return found && path.resolve(found).startsWith(realRoot + path.sep) ? found : null;
}

/**
 * Type errors the new source adds to the file (errors already there never block). Null when there is no tsconfig.
 * @param {string} root @param {string} abs @param {string} before @param {string} after
 * @returns {{added: {code: string, message: string, line: number}[], ms: number}|null}
 */
export function addedTypeErrors(root, abs, before, after) {
  if (!tsconfigInside(root, abs)) return null;
  const t0 = Date.now();
  const errs = (src) => typescriptDiagnostics(abs, src).filter((d) => d.severity === 'error');
  const old = new Map();
  for (const d of errs(before)) old.set(`${d.code}|${d.message}`, (old.get(`${d.code}|${d.message}`) || 0) + 1);
  const added = [];
  for (const d of errs(after)) {
    const k = `${d.code}|${d.message}`;
    if (old.get(k)) old.set(k, old.get(k) - 1);
    else added.push({ code: d.code, message: d.message, line: d.line });
  }
  return { added, ms: Date.now() - t0 };
}

/**
 * Stage replacing one fragment's code. Only the bytes inside its range change. Pure: nothing is written.
 * @param {string} root Project root.
 * @param {import('./contract.mjs').SetFragmentRequest} req
 * @returns {import('./contract.mjs').StagedChange & {typeCheck?: {ms: number, slow: boolean}, warnings?: import('./contract.mjs').LineFinding[]}}
 * @throws {LineOpError} UNKNOWN_ITEM, STALE, NO_CHANGE, BAD_CODE, TYPE_ERROR.
 */
export function planSetFragment(root, { file, fragmentId, code, contentHash } = /** @type {any} */ ({})) {
  const { abs, source } = readCodeFile(root, file);
  if (typeof contentHash !== 'string' || contentHash !== hashOf(source)) {
    throw new LineOpError('This file changed since you opened the code; reload it and try again.', 'STALE');
  }
  const fragments = fragmentsOf(source, file);
  const frag = fragments.find((f) => f.id === fragmentId);
  if (!frag) throw new LineOpError('That piece of code is no longer there; reload the page and pick it again.', 'UNKNOWN_ITEM');
  if (typeof code !== 'string' || !code.trim()) throw new LineOpError('The code is empty; write the expression to use, or close the editor to keep the old one.', 'BAD_CODE');
  const text = code.trim();
  if (text === frag.code) throw new LineOpError('Nothing changed; this is the code that is already there.', 'NO_CHANGE');
  const alone = jsxParseError(`(${text}\n);`);
  if (alone) throw new LineOpError('This code is not a single valid expression, so nothing was saved.', 'BAD_CODE', alone);

  // Splice it in; if precedence would change what the fragment is (e.g. `a || b` in front of `&& <X/>`), wrap it.
  const splice = (t) => source.slice(0, frag.range.start) + t + source.slice(frag.range.end);
  let content = null;
  let lastError = '';
  for (const t of [text, `(${text})`]) {
    const next = splice(t);
    const err = jsxParseError(next);
    if (err) { lastError = err; continue; }
    // The same fragment must come back holding exactly this code (brackets we added sit just outside its range).
    const again = fragmentsOf(next, file, { literals: true }).find((f) => f.id === fragmentId);
    const at = frag.range.start + (t === text ? 0 : 1);
    if (again && again.range.start === at && again.code === text) { content = next; break; }
    lastError = 'The code changes the shape of the code around it.';
  }
  if (content === null) throw new LineOpError('This code does not fit in that place, so nothing was saved.', 'BAD_CODE', lastError);

  const types = addedTypeErrors(root, abs, source, content);
  const slow = Boolean(types && types.ms > typeCheckBudgetMs());
  if (types && types.added.length && !slow) {
    const detail = types.added.map((d) => `${d.code} at line ${d.line}: ${d.message}`).join('\n');
    throw new LineOpError(`The new code does not match the types this file expects, so nothing was saved.`, 'TYPE_ERROR', detail);
  }
  const name = path.basename(file).replace(/\.[^.]+$/, '');
  // Too slow to block: the type errors ride along as warnings the server adds to the saved result.
  const warnings = slow ? types.added.map((d) => ({
    sentence: `The saved code may not match the types this file expects (${d.message.split('\n')[0].replace(/[.?!]$/, '')}).`,
    rule: d.code, severity: /** @type {'warning'} */ ('warning'), file, line: d.line,
  })) : [];
  return {
    summary: `Changes the code for "${frag.label}" in ${name}.`,
    files: [{ path: file, content }],
    ...(types ? { typeCheck: { ms: types.ms, slow } } : {}),
    ...(warnings.length ? { warnings } : {}),
  };
}
