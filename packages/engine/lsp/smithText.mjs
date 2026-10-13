// #945 -- Smith's code helpers and its placeholder rule, in the open engine so the Line LSP (smith.mjs, gate.mjs) never
// imports packages/tools: TS/TSX -> JS with JSX kept (toJs), a file's top-level functions as standalone code
// (functionsOf), what Smith reads (smithInput: JSX as React.createElement), and when a Smith output is empty
// (smithEmptyReason, PLACEHOLDER_EMPTY_RATIO). packages/tools/smith-system1/sources.mjs re-exports them.
import { ts } from './host.mjs';

/**
 * TS/TSX/JS -> JS with JSX kept (types removed).
 * @param {string} code
 * @param {string} [fileName]
 * @returns {string}
 */
export function toJs(code, fileName = 'x.tsx') {
  const jsx = /\.(tsx|jsx)$/.test(fileName) || /\.m?js$/.test(fileName);
  return ts.transpileModule(code, {
    fileName: jsx ? fileName.replace(/\.(m?js)$/, '.jsx') : fileName,
    compilerOptions: { jsx: ts.JsxEmit.Preserve, target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext, removeComments: false },
    reportDiagnostics: false,
  }).outputText;
}

const stripExport = (s) => s.replace(/^export\s+(default\s+)?/, '');

/**
 * The top-level functions of a JS (JSX kept) file, as standalone code: function declarations as written, a
 * `const f = (..) => ..` / `const f = function (..) {..}` rewritten as `function f(..) {..}`, class methods as the method.
 * @param {string} js
 * @returns {{name: string, kind: 'function'|'method', code: string, fromArrow?: boolean}[]}
 */
export function functionsOf(js) {
  const sf = ts.createSourceFile('x.jsx', js, ts.ScriptTarget.ES2020, true, ts.ScriptKind.JSX);
  /** @type {{name: string, kind: 'function'|'method', code: string, fromArrow?: boolean}[]} */
  const out = [];
  for (const st of sf.statements) {
    if (ts.isFunctionDeclaration(st) && st.body) {
      out.push({ name: st.name?.text ?? 'default', kind: 'function', code: stripExport(st.getText(sf)) });
    } else if (ts.isVariableStatement(st) && st.declarationList.declarations.length === 1) {
      const d = st.declarationList.declarations[0];
      const init = d.initializer;
      if (!ts.isIdentifier(d.name) || !init || !(ts.isArrowFunction(init) || ts.isFunctionExpression(init))) continue;
      const isAsync = init.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword);
      const params = init.parameters.map((p) => p.getText(sf)).join(', ');
      const body = ts.isBlock(init.body) ? init.body.getText(sf) : `{\n  return ${init.body.getText(sf)};\n}`;
      out.push({ name: d.name.text, kind: 'function', code: `${isAsync ? 'async ' : ''}function ${d.name.text}(${params}) ${body}`, fromArrow: true });
    } else if (ts.isClassDeclaration(st)) {
      for (const m of st.members) {
        if (ts.isMethodDeclaration(m) && m.body && ts.isIdentifier(m.name)) out.push({ name: `${st.name?.text ?? 'Class'}.${m.name.text}`, kind: 'method', code: m.getText(sf) });
      }
    }
  }
  return out;
}

/**
 * What Smith reads: the same function with JSX turned into React.createElement (Smith's parser has no JSX).
 * @param {{kind: string, code: string}} fn One of functionsOf's functions.
 * @returns {string}
 */
export function smithInput(fn) {
  const wrap = fn.kind === 'method' ? `class __W__ {\n${fn.code}\n}` : fn.code;
  const out = ts.transpileModule(wrap, { fileName: 'x.jsx', compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext }, reportDiagnostics: false }).outputText.trim();
  if (fn.kind !== 'method') return out;
  const sf = ts.createSourceFile('x.js', out, ts.ScriptTarget.ES2020, true, ts.ScriptKind.JS);
  const cls = sf.statements.find(ts.isClassDeclaration);
  return cls?.members[0]?.getText(sf) ?? out;
}

/** Smith's two gap markers: "(...)" (pinned atomic-codemod) and "(a step that does not translate cleanly)" (hardened). */
const PLACEHOLDER_RE = /\(\.\.\.\)|\(a step that does not translate cleanly\)/g;

/**
 * Words left once Smith's placeholders ("(...)", "(a step that does not translate cleanly)", "?") and punctuation are
 * removed.
 * @param {string} english
 * @returns {string[]}
 */
export const contentWords = (english) => english.replace(PLACEHOLDER_RE, ' ').replace(/\?/g, ' ').replace(/[^\w'\s]/g, ' ').split(/\s+/).filter(Boolean);

/** Smith's stock words: they say how the code is laid out, not what it does. */
const STOCK = new Set('it returns return and react create element nothing let be if not then the a of is works in step steps using'.split(' '));
/** An output is placeholder-dominated (empty) when it has at least this many "(...)" per meaningful word. */
export const PLACEHOLDER_EMPTY_RATIO = 0.5;

/**
 * Why a Smith output counts as empty, or null when it carries meaning: `blank` (fewer than 3 words once the
 * placeholders go) or `placeholder` (after the title sentence, at least one gap marker -- "(...)" or "(a step that does
 * not translate cleanly)" -- per two meaningful words: e.g.
 * "Next using state works in 1 step. It returns (...)", or a React page whose every prop and child is "(...)").
 * @param {string} english
 * @returns {null|'blank'|'placeholder'}
 */
export function smithEmptyReason(english) {
  if (contentWords(english).length < 3) return 'blank';
  const body = english.split(/(?<=\.)\s+/).slice(1).join(' ');
  const placeholders = (body.match(PLACEHOLDER_RE) ?? []).length;
  const meaningful = contentWords(body).map((w) => w.replace(/\W/g, '').toLowerCase()).filter((w) => w && !STOCK.has(w)).length;
  return placeholders > 0 && placeholders >= PLACEHOLDER_EMPTY_RATIO * Math.max(1, meaningful) ? 'placeholder' : null;
}
