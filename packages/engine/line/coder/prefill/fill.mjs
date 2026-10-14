// fill (#948): one function per request, as a block every product call site shares. The unit's functions are read
// with the TypeScript parser (function declarations, `const x = () => {}`, and the function argument of a top-level
// factory call such as `defineService('n', (p) => {...})`); each request prefills one function's exact signature
// through its `{` and stops at its closing brace; the body is spliced back and checked before anything is kept.
//
//   functionsIn(source)                 the fillable functions: {name, signature, bodyStart, bodyEnd, line, endLine}
//   functionAt(fns, {name, line})       the one function a name or a line points at
//   spliceBody(source, fn, body)        the source with that function's body replaced
//   checkFill(...)                      a refusal {code, sentence} ending in a concrete example, or null
//   tscGate(source, file, fn)           tsc's first error inside the function (imports unresolved on purpose), or null
//   fillOne({...}) / fillEach({...})    the request, the check, one retry carrying only the first error
import { createRequire } from 'node:module';
import { STOP, takeBody, FILL_EXAMPLE } from './prefill.mjs';

const ts = createRequire(import.meta.url)('typescript');
const kindOf = (file) => (/\.tsx$/.test(file) ? ts.ScriptKind.TSX : /\.jsx$/.test(file) ? ts.ScriptKind.JSX : /\.m?js$/.test(file) ? ts.ScriptKind.JS : ts.ScriptKind.TS);
const parse = (text, file = 'x.tsx') => ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kindOf(file));
const isFn = (n) => n && (ts.isArrowFunction(n) || ts.isFunctionExpression(n)) && n.body && ts.isBlock(n.body);

/**
 * The fillable functions of a source file, in source order.
 * @param {string} source
 * @param {string} [file]
 * @returns {{name: string, signature: string, start: number, bodyStart: number, bodyEnd: number, line: number, endLine: number}[]}
 */
export function functionsIn(source, file = 'x.tsx') {
  const sf = parse(source, file);
  const out = [];
  const lineOf = (pos) => sf.getLineAndCharacterOfPosition(pos).line + 1;
  const add = (name, startNode, fn) => {
    const start = startNode.getStart(sf);
    const bodyStart = fn.body.getStart(sf);
    out.push({ name, signature: source.slice(start, bodyStart + 1), start, bodyStart, bodyEnd: fn.body.getEnd(), line: lineOf(start), endLine: lineOf(fn.body.getEnd()) });
  };
  const fromCall = (name, st, call) => {
    if (!call || !ts.isCallExpression(call)) return;
    const fn = call.arguments.find(isFn);
    const label = call.arguments.find((a) => ts.isStringLiteral(a));
    if (fn) add(name ?? label?.text ?? call.expression.getText(sf), st, fn);
  };
  for (const st of sf.statements) {
    if (ts.isFunctionDeclaration(st) && st.body) add(st.name?.text ?? 'default', st, st);
    else if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) {
        const name = ts.isIdentifier(d.name) ? d.name.text : d.name.getText(sf);
        if (isFn(d.initializer)) add(name, st, d.initializer);
        else fromCall(name, st, d.initializer);
      }
    } else if (ts.isExportAssignment(st)) {
      if (isFn(st.expression)) add('default', st, st.expression); else fromCall('default', st, st.expression);
    } else if (ts.isExpressionStatement(st)) fromCall(null, st, st.expression);
  }
  return out;
}

/**
 * The function a name or a line points at (the innermost span holding the line), or null.
 * @param {ReturnType<typeof functionsIn>} fns
 * @param {{name?: string|null, line?: number|null}} target
 */
export function functionAt(fns, { name = null, line = null } = {}) {
  if (name) return fns.find((f) => f.name === name) ?? null;
  if (line) return fns.filter((f) => f.line <= line && line <= f.endLine).sort((a, b) => (a.endLine - a.line) - (b.endLine - b.line))[0] ?? null;
  return fns[0] ?? null;
}

/**
 * The source with one function's body replaced (the signature and everything outside the function kept byte for byte).
 * @param {string} source
 * @param {{bodyStart: number, bodyEnd: number}} fn
 * @param {string} body The statements between the braces.
 * @returns {string}
 */
export function spliceBody(source, fn, body) {
  const inner = String(body ?? '').replace(/^[ \t]*\n/, '').replace(/\s+$/, '');
  return `${source.slice(0, fn.bodyStart + 1)}\n${inner}\n${source.slice(fn.bodyEnd - 1)}`;
}

// Unresolved modules and JSX/React typings: the gate checks the function alone, so these are expected, not errors.
const TSC_SKIP = new Set([2307, 2792, 7016, 2875, 7026, 17004, 2503, 2686, 1259, 1192]);
const libCache = new Map();
/**
 * tsc's first error inside `fn` (the source alone, imports unresolved on purpose, so an imported name is `any`), or null.
 * @param {string} source
 * @param {string} file
 * @param {{bodyStart: number, bodyEnd: number}} [fn] Only errors inside this body count (default: the whole file).
 * @returns {{line: number, sentence: string}|null}
 */
export function tscGate(source, file = 'x.tsx', fn) {
  const name = `/__fill__/${file.split('/').pop()}`;
  const options = { noEmit: true, noResolve: true, skipLibCheck: true, types: [], jsx: ts.JsxEmit.Preserve, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, strict: false, allowJs: true, lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'] };
  const host = ts.createCompilerHost(options);
  const getSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (f, v) => {
    if (f === name) return ts.createSourceFile(f, source, v, true, kindOf(file));
    if (!libCache.has(f)) libCache.set(f, getSourceFile(f, v));
    return libCache.get(f);
  };
  const program = ts.createProgram([name], options, host);
  const sf = program.getSourceFile(name);
  const diags = [...program.getSyntacticDiagnostics(sf), ...program.getSemanticDiagnostics(sf)]
    .filter((d) => d.category === ts.DiagnosticCategory.Error && !TSC_SKIP.has(d.code) && d.start !== undefined && (!fn || (d.start >= fn.bodyStart && d.start <= fn.bodyEnd)));
  if (!diags.length) return null;
  const d = diags[0];
  const line = sf.getLineAndCharacterOfPosition(/** @type {number} */ (d.start)).line + 1;
  return { line, sentence: `tsc TS${d.code} at line ${line}: ${ts.flattenDiagnosticMessageText(d.messageText, ' ')}` };
}

/**
 * The deterministic check of one fill: a refusal {code, sentence} that ends in a concrete example, or null.
 * @param {{name: string, signature: string}} fn The function asked for.
 * @param {{body: string, trailing: boolean}} reply takeBody's result.
 * @param {string} next The spliced source.
 * @param {{file?: string, gate?: ((source: string, fn: any) => {sentence: string}|null)|false}} [o] `gate` replaces tscGate; false skips it.
 * @returns {{code: string, sentence: string}|null}
 */
export function checkFill(fn, reply, next, { file = 'x.tsx', gate } = {}) {
  const say = (code, why) => ({ code, sentence: `Refused (${code}): ${why}\n${FILL_EXAMPLE}` });
  if (reply.trailing) return say('ONE_FUNCTION', `one function per request: write only the body of ${fn.name} and stop at its closing brace; the reply went on past it.`);
  if (!reply.body.trim()) return say('EMPTY_BODY', `the body of ${fn.name} is empty.`);
  const after = functionsIn(next, file);
  const same = after.find((f) => f.name === fn.name && f.signature.replace(/\s+/g, ' ') === fn.signature.replace(/\s+/g, ' '));
  if (!same) return say('SIGNATURE_CHANGED', `the signature of ${fn.name} is locked; the reply changed it or broke the function.`);
  const syntax = parse(next, file).parseDiagnostics?.[0];
  if (syntax) return say('SYNTAX', `${ts.flattenDiagnosticMessageText(syntax.messageText, ' ')} (line ${parse(next, file).getLineAndCharacterOfPosition(syntax.start).line + 1}).`);
  if (gate === false) return null;
  const bad = gate ? gate(next, same) : tscGate(next, file, same);
  return bad ? say('TSC', bad.sentence) : null;
}

/**
 * One function, filled: the prefilled request, the check, and on a refusal one more request that carries only the
 * first error (never a growing history).
 * @param {{source: string, file?: string, target?: {name?: string|null, line?: number|null},
 *   generate: (q: {system: string, user: string, prefill: string, stop: readonly string[]}) => Promise<string>,
 *   system?: string, user: string, gate?: any, maxAttempts?: number}} o
 * @returns {Promise<{ok: true, source: string, name: string, body: string, attempts: number, refusals: any[]} |
 *   {ok: false, code: string, sentence: string, name: string|null, attempts: number, refusals: any[]}>}
 */
export async function fillOne(o) {
  const file = o.file ?? 'x.tsx';
  const fn = functionAt(functionsIn(o.source, file), o.target ?? {});
  if (!fn) return { ok: false, code: 'NO_FUNCTION', sentence: `There is no function${o.target?.name ? ` ${o.target.name}` : o.target?.line ? ` at line ${o.target.line}` : ''} to fill in ${file}; a model is only asked for one function body.`, name: null, attempts: 0, refusals: [] };
  const refusals = [];
  const max = Math.max(1, o.maxAttempts ?? 2);
  for (let attempts = 1; attempts <= max; attempts++) {
    const last = refusals[refusals.length - 1];
    const user = [o.user, last ? `Your last body for ${fn.name} was refused. ${last.sentence}` : '', `Write only the body of ${fn.name}; its signature is already written and stays as it is. Stop at its closing brace.`].filter(Boolean).join('\n\n');
    const raw = await o.generate({ system: o.system ?? 'You write the body of one TypeScript function. Reply with the body and its closing brace only.', user, prefill: `${fn.signature}\n`, stop: STOP });
    const reply = takeBody(raw, fn.signature);
    const next = spliceBody(o.source, fn, reply.body);
    const bad = checkFill(fn, reply, next, { file, gate: o.gate });
    if (!bad) return { ok: true, source: next, name: fn.name, body: reply.body, attempts, refusals };
    refusals.push(bad);
  }
  const last = refusals[refusals.length - 1];
  return { ok: false, code: last.code, sentence: last.sentence, name: fn.name, attempts: max, refusals };
}

/**
 * Every fillable function of a file (or only those holding `lines`), one request each, in source order.
 * @param {Omit<Parameters<typeof fillOne>[0], 'target'> & {lines?: number[]|null}} o
 * @returns {Promise<{ok: boolean, source: string, filled: string[], failed: {name: string|null, code: string, sentence: string}[], attempts: number}>}
 */
export async function fillEach(o) {
  const file = o.file ?? 'x.tsx';
  let source = o.source;
  const all = functionsIn(source, file);
  const names = (o.lines?.length ? all.filter((f) => o.lines.some((l) => f.line <= l && l <= f.endLine)) : all).map((f) => f.name);
  if (!names.length) return { ok: false, source, filled: [], failed: [{ name: null, code: 'NO_FUNCTION', sentence: `There is no function${o.lines?.length ? ` at line ${o.lines.join(', ')}` : ''} to fill in ${file}; a model is only asked for one function body at a time.` }], attempts: 0 };
  const filled = []; const failed = []; let attempts = 0;
  for (const name of [...new Set(names)]) {
    const r = await fillOne({ ...o, source, file, target: { name } });
    attempts += r.attempts;
    if (r.ok) { source = r.source; filled.push(name); } else failed.push({ name, code: r.code, sentence: r.sentence });
  }
  return { ok: failed.length === 0, source, filled, failed, attempts };
}
