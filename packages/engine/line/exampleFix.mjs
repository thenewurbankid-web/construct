// #932 (c) example fixes for common tsc errors: a TYPE_ERROR refusal shows the offending line corrected, not only
// "fixed where the error points" (an LLM understands an example better than an instruction). lending-qwen-7b-r1 sent
// `JSON.parse(localStorage.getItem('picks'))` 7 times against TS2345 `string | null`; the fix is one `?? '[]'`.
// Deterministic and pure: a small table keyed by TS code + message pattern renders the corrected line from the real
// one. An unknown code, or a line the rule cannot read, gives null (the refusal stays as it was).
//
//   exampleFix(err, o)          {code, message, line} + the offending source line -> {line, code} or null
//   parseTypeDetail(detail)     a TYPE_ERROR refusal's detail -> [{file, line, code, message}]
//   exampleFixLines(detail, o)  the "Example fix for line N: <code>" lines for a refusal (at most `max`)
import path from 'node:path';
import { closestId } from '@line/construct-core/nearest';

/** Calls whose result may be null or undefined, as a line spells them. */
const NULLABLE_CALL = /\b(?:localStorage|sessionStorage)\.getItem\([^()]*\)|\b\w+\.(?:getItem|get|find|match|exec|getElementById|querySelector|getAttribute)\([^()]*(?:\([^()]*\)[^()]*)*\)/g;

/** A default of the parameter's type ("string" inside JSON.parse is '[]', a string to parse). */
function defaultFor(type, inParse) {
  const t = type.trim();
  if (t === 'string') return inParse ? "'[]'" : "''";
  if (t === 'number') return '0';
  if (t === 'boolean') return 'false';
  if (/\[\]$|^Array</.test(t)) return '[]';
  return null;
}

/** The first nullable call in `src` that is not already followed by `??` or `!`, with its index. */
function nullableCall(src) {
  for (const m of src.matchAll(NULLABLE_CALL)) {
    const after = src.slice(/** @type {number} */ (m.index) + m[0].length);
    if (/^\s*(?:\?\?|!|\?\.)/.test(after)) continue;
    return { text: m[0], at: /** @type {number} */ (m.index) };
  }
  return null;
}

const splice = (s, at, len, put) => `${s.slice(0, at)}${put}${s.slice(at + len)}`;

/** TS2345: Argument of type 'X | null' (or undefined) is not assignable to parameter of type 'T' -> `?? <default>`. */
function nullArgument(message, src) {
  const m = /Argument of type '(.+?)' is not assignable to parameter of type '(.+?)'/.exec(message);
  if (!m || !/\|\s*(?:null|undefined)\b|^(?:null|undefined)\b/.test(m[1])) return null;
  const c = nullableCall(src);
  if (!c) return null;
  const inParse = /JSON\.parse\(\s*$/.test(src.slice(0, c.at));
  const d = defaultFor(m[2], inParse);
  return d ? splice(src, c.at, c.text.length, `${c.text} ?? ${d}`) : null;
}

/** TS18047/TS18048 ('x' is possibly 'null'/'undefined'), TS2531/TS2532 (Object is possibly ...) -> optional chaining. */
function possiblyNullish(message, src) {
  const named = /'([A-Za-z_$][\w$.]*)' is possibly '(?:null|undefined)'/.exec(message)?.[1];
  if (named) {
    const esc = named.replace(/[.$]/g, '\\$&');
    const re = new RegExp(`(^|[^\\w$.?])(${esc})(\\.(?=[A-Za-z_$])|\\[)`);
    const m = re.exec(src);
    if (!m) return null;
    const at = m.index + m[1].length + m[2].length;
    return splice(src, at, m[3].length, m[3] === '.' ? '?.' : '?.[');
  }
  if (!/Object is possibly '(?:null|undefined)'/.test(message)) return null;
  const c = nullableCall(src);
  if (!c) return null;
  const end = c.at + c.text.length;
  const next = src.slice(end);
  if (next.startsWith('.')) return splice(src, end, 1, '?.');
  if (next.startsWith('[')) return splice(src, end, 0, '?.');
  return null;
}

/** TS2322 simple literal mismatches: a quoted number for a number, a number for a string, a near string literal. */
function literalMismatch(message, src) {
  const m = /Type '(.+?)' is not assignable to type '(.+?)'/.exec(message);
  if (!m) return null;
  const [, from, to] = m;
  const lits = [...to.matchAll(/"([^"]*)"/g)].map((x) => x[1]);
  const fromLit = /^"(.*)"$/.exec(from)?.[1];
  // A string literal that is not one of the union's members: the nearest member.
  if (fromLit !== undefined && lits.length && to.split('|').every((p) => /^\s*"[^"]*"\s*$/.test(p))) {
    const near = closestId(fromLit, lits, { maxDistance: Math.max(3, Math.ceil(fromLit.length / 2)) }) ?? lits[0];
    const re = new RegExp(`(['"\`])${fromLit.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\1`);
    const q = re.exec(src);
    return q ? splice(src, q.index, q[0].length, `${q[1]}${near}${q[1]}`) : null;
  }
  if ((from === 'string' || /^"\d+(\.\d+)?"$/.test(from)) && to === 'number') {
    const jsx = /(\w+)=(["'])(\d+(?:\.\d+)?)\2/.exec(src);
    if (jsx) return splice(src, jsx.index, jsx[0].length, `${jsx[1]}={${jsx[3]}}`);
    const q = /(['"])(\d+(?:\.\d+)?)\1/.exec(src);
    if (q) return splice(src, q.index, q[0].length, q[2]);
    return null;
  }
  if ((from === 'number' || /^\d+(\.\d+)?$/.test(from)) && to === 'string') {
    const jsx = /(\w+)=\{(\d+(?:\.\d+)?)\}/.exec(src);
    if (jsx) return splice(src, jsx.index, jsx[0].length, `${jsx[1]}="${jsx[2]}"`);
    const expr = /(\w+)=\{([^{}]+)\}/.exec(src);
    if (expr) return splice(src, expr.index, expr[0].length, `${expr[1]}={String(${expr[2]})}`);
    return null;
  }
  if ((from === 'string' || /^"(true|false)"$/.test(from)) && to === 'boolean') {
    const q = /(['"])(true|false)\1/.exec(src);
    if (q) return splice(src, q.index, q[0].length, q[2]);
  }
  return null;
}

const noExt = (p) => p.replace(/\.(tsx?|jsx?|mjs)$/, '').replace(/\/index$/, '');
/** TS2307 Cannot find module 'x': the nearest existing file's path, relative to the file (same name first). */
function moduleNotFound(message, src, { file, files = [] }) {
  const spec = /Cannot find module '([^']+)'/.exec(message)?.[1];
  if (!spec || !file || !spec.startsWith('.')) return null;
  const want = path.posix.basename(spec).toLowerCase();
  const code = files.filter((f) => /\.(tsx?|jsx?|mjs|json)$/.test(f) && f !== file);
  const byName = new Map(code.map((f) => [path.posix.basename(noExt(f)), f]));
  const exact = code.find((f) => path.posix.basename(noExt(f)).toLowerCase() === want);
  const near = exact ?? byName.get(closestId(path.posix.basename(spec), [...byName.keys()], { maxDistance: 4 }) ?? '');
  if (!near) return null;
  let rel = path.posix.relative(path.posix.dirname(file), noExt(near));
  if (!rel.startsWith('.')) rel = `./${rel}`;
  if (rel === spec) return null;
  const at = src.indexOf(spec);
  return at < 0 ? null : splice(src, at, spec.length, rel);
}

/**
 * The table: per TS code, the rule that renders the corrected line (or null).
 * @type {Readonly<Record<string, (message: string, src: string, o: {file?: string, files?: string[]}) => (string|null)>>}
 */
export const EXAMPLE_FIX_RULES = Object.freeze({
  TS2345: (m, s) => nullArgument(m, s),
  TS2531: (m, s) => possiblyNullish(m, s),
  TS2532: (m, s) => possiblyNullish(m, s),
  TS18047: (m, s) => possiblyNullish(m, s),
  TS18048: (m, s) => possiblyNullish(m, s),
  TS2322: (m, s) => literalMismatch(m, s),
  TS2307: (m, s, o) => moduleNotFound(m, s, o),
});

/**
 * One example fix: the offending line corrected, or null (unknown code, or nothing the rule can read).
 * @param {{code: string, message: string, line: number}} err @param {{src: string, file?: string, files?: string[]}} o
 *   `src`: the offending line's text; `files`: the project's files (TS2307's nearest path).
 * @returns {{line: number, code: string} | null}
 */
export function exampleFix(err, { src, file, files } = /** @type {any} */ ({})) {
  const rule = EXAMPLE_FIX_RULES[String(err?.code)];
  if (!rule || typeof src !== 'string' || !src.trim()) return null;
  let fixed = null;
  try { fixed = rule(String(err.message ?? ''), src, { file, files }); } catch { fixed = null; }
  return fixed && fixed !== src ? { line: err.line, code: fixed.trim() } : null;
}

/**
 * A TYPE_ERROR refusal's detail ("file:line TScode message" lines, continuation lines indented) as errors.
 * @param {string} detail
 * @returns {{file: string, line: number, code: string, message: string}[]}
 */
export function parseTypeDetail(detail) {
  const out = [];
  for (const l of String(detail ?? '').split('\n')) {
    const m = /^(\S+):(\d+) (TS\d+) (.*)$/.exec(l);
    if (m) out.push({ file: m[1], line: Number(m[2]), code: m[3], message: m[4] });
    else if (out.length && /^\s+\S/.test(l)) out[out.length - 1].message += `\n${l.trim()}`;
  }
  return out;
}

/**
 * The example-fix lines of a TYPE_ERROR refusal, one per offending line (at most `max`).
 * @param {string} detail @param {{sourceOf: (file: string) => (string|null), files?: string[], max?: number}} o
 *   `sourceOf`: the code the error points into (the sent code for the request's file, else the file on disk).
 * @returns {{text: string[], fixes: {file: string, line: number, code: string, ts: string}[]}}
 */
export function exampleFixLines(detail, { sourceOf, files = [], max = 2 }) {
  const fixes = [];
  for (const e of parseTypeDetail(detail)) {
    if (fixes.length >= max) break;
    if (fixes.some((f) => f.file === e.file && f.line === e.line)) continue;
    const code = sourceOf(e.file);
    const src = code?.split('\n')[e.line - 1];
    const fx = exampleFix(e, { src: src ?? '', file: e.file, files });
    if (fx) fixes.push({ file: e.file, line: fx.line, code: fx.code, ts: e.code });
  }
  return { text: fixes.map((f) => `Example fix for line ${f.line}${fixes.some((g) => g.file !== f.file) ? ` of ${f.file}` : ''}: ${f.code}`), fixes };
}
