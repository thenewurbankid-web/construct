// #632 (part of #616) -- type-check and build as read-only plan steps whose result is CLASSIFIED, never a raw log. This file is the pure half:
// it reads what `tsc` and the project's build printed and says what KIND of failure it is; packages/engine/verifyRunner.mjs runs the
// processes (bounded: timeout, output cap) and calls it. No model: a fixed table of TypeScript codes and a few output patterns.
//   typeErrorKind(code)              a TypeScript code -> missing-import | unknown-name | type-mismatch | other
//   classifyTypeErrors(errors, opts) type errors -> { status, counts, files (grouped, the first N errors), statement }
//   classifyBuildOutput(run, opts)   a build run -> { status: pass | compile-error | timeout | failed, errors, statement }
//   verifyOffer(root, answer)        the closed question `q-verify` of a shaped plan: types | types-build | none
//   verifyTouches()                  the empty scope of both read-only steps
import fs from 'node:fs';
import path from 'node:path';

/** How many errors a classified result lists; the rest is a count. */
export const VERIFY_LIMITS = Object.freeze({ errors: 10, message: 200, excerptLines: 12, excerpt: 1500, output: 200_000 });

/** How long a check may run before it is stopped, and the most output the runner keeps. */
export const VERIFY_TIMEOUTS = Object.freeze({ typesMs: 120_000, buildMs: 300_000 });

/** The id of the closed question about how far a shaped plan verifies itself, and its options (stable ids; `types` first: the rules-only default). */
export const VERIFY_QUESTION_ID = 'q-verify';
export const VERIFY_OPTIONS = Object.freeze(['types', 'types-build', 'none']);

/** The TypeScript codes of each kind of type error a person can act on. Anything else is `other`. */
export const TYPE_ERROR_KINDS = Object.freeze({
  'missing-import': Object.freeze(['TS2307', 'TS2305', 'TS2724', 'TS2614', 'TS2792', 'TS1192', 'TS2497']),
  'unknown-name': Object.freeze(['TS2304', 'TS2552', 'TS2551', 'TS2339', 'TS2503', 'TS2693', 'TS2708', 'TS2694', 'TS2686']),
  'type-mismatch': Object.freeze(['TS2322', 'TS2345', 'TS2740', 'TS2741', 'TS2739', 'TS2769', 'TS2352', 'TS2367', 'TS2416', 'TS2554', 'TS2555', 'TS2559', 'TS2375', 'TS2379', 'TS2344', 'TS2353', 'TS2532', 'TS2531', 'TS18047', 'TS18048', 'TS2564']),
});

/** What each kind says, in plain words: `[singular, plural, what it means]`. */
const KIND_WORDS = Object.freeze({
  'missing-import': ['missing import', 'missing imports', 'a module or an export that is not there'],
  'unknown-name': ['unknown name', 'unknown names', 'a name used but never declared or imported'],
  'type-mismatch': ['type mismatch', 'type mismatches', 'a value of one type where another is expected'],
  other: ['other type error', 'other type errors', 'not one of the three kinds above'],
});

/**
 * The kind of one TypeScript error, from its code.
 *
 * @param {string} code A code such as `TS2304`.
 * @returns {'missing-import'|'unknown-name'|'type-mismatch'|'other'} The kind.
 *
 * @example
 * typeErrorKind('TS2307'); // => 'missing-import'
 */
export function typeErrorKind(code) {
  for (const [kind, codes] of Object.entries(TYPE_ERROR_KINDS)) if (codes.includes(code)) return kind;
  return 'other';
}

const clip = (text, max) => {
  const one = String(text ?? '').replace(/\s+/g, ' ').trim();
  return one.length > max ? `${one.slice(0, max - 1)}…` : one;
};
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/**
 * Classify the errors of a type-check: grouped by file, only the first `limit` errors kept (each as `{ line, code, kind, message }`), with
 * the counts of every kind and a plain statement. No error at all is a `pass`.
 *
 * @param {{ file: string, line: number, code: string, message: string }[]} errors Every error, in the order `tsc` printed them.
 * @param {{ limit?: number }} [opts] `limit` errors are listed (default `VERIFY_LIMITS.errors`).
 * @returns {{ status: 'pass'|'type-errors', counts: { errors: number, files: number, shown: number, omitted: number, byKind: Record<string, number> }, files: { file: string, count: number, errors: { line: number, code: string, kind: string, message: string }[] }[], statement: string }} The classified result.
 *
 * @example
 * classifyTypeErrors([{ file: 'a.ts', line: 3, code: 'TS2304', message: "Cannot find name 'x'." }]).statement; // => '1 type error in 1 file: 1 unknown name (unknown name: a name used but never declared or imported).'
 */
export function classifyTypeErrors(errors, { limit = VERIFY_LIMITS.errors } = {}) {
  const list = Array.isArray(errors) ? errors : [];
  const byKind = {};
  const perFile = new Map();
  for (const e of list) {
    const kind = typeErrorKind(e.code);
    byKind[kind] = (byKind[kind] ?? 0) + 1;
    perFile.set(e.file, (perFile.get(e.file) ?? 0) + 1);
  }
  const files = [];
  let shown = 0;
  for (const e of list) {
    if (shown >= limit) break;
    let group = files.find((f) => f.file === e.file);
    if (!group) files.push((group = { file: e.file, count: perFile.get(e.file), errors: [] }));
    group.errors.push({ line: e.line, code: e.code, kind: typeErrorKind(e.code), message: clip(e.message, VERIFY_LIMITS.message) });
    shown += 1;
  }
  const counts = { errors: list.length, files: perFile.size, shown, omitted: list.length - shown, byKind };
  if (!list.length) return { status: 'pass', counts, files, statement: 'No type errors: the project type-checks.' };
  const present = Object.keys(KIND_WORDS).filter((kind) => byKind[kind]);
  const kinds = present.map((kind) => plural(byKind[kind], KIND_WORDS[kind][0], KIND_WORDS[kind][1]));
  const meaning = present.map((kind) => `${KIND_WORDS[kind][0]}: ${KIND_WORDS[kind][2]}`).join('; ');
  const statement = `${plural(list.length, 'type error', 'type errors')} in ${plural(perFile.size, 'file', 'files')}: ${kinds.join(', ')} (${meaning}).${counts.omitted ? ` The first ${shown} are listed.` : ''}`;
  return { status: 'type-errors', counts, files, statement };
}

const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;
const cleanOutput = (text) => String(text ?? '').replace(ANSI, '').replace(/\r/g, '');
/** A few lines of output as one kept excerpt: colour codes gone, cut at the first code frame or stack line (what is left is the sentence a person needs), capped. */
const excerptOf = (text) => {
  const lines = cleanOutput(text).split('\n');
  const at = lines.findIndex((l) => /^\s*(?:>\s*)?\d+ \|/.test(l) || /^\s+at\s+\S/.test(l));
  return (at < 0 ? lines : lines.slice(0, at)).join('\n').trim().slice(0, VERIFY_LIMITS.excerpt);
};

// One pattern per toolchain a build prints its diagnostics in. The first group of each is the file, then the line.
const TSC_LINE = /^(.+?)\((\d+),\d+\): error (TS\d+): (.*)$/;
const TSC_COLON = /^(?:\.\/)?([^\s:()]+\.[cm]?[jt]sx?):(\d+):\d+ - error (TS\d+): (.*)$/;
const NEXT_LOCATION = /^\.\/(\S+\.[cm]?[jt]sx?):(\d+):\d+$/;
const NEXT_MESSAGE = /^(Type error|Syntax error|Module not found|Error): (.*)$/;
const VITE_ERROR = /^(?:\[vite[^\]]*\]\s*)?(?:error during build:|✘ \[ERROR\]|\[ERROR\]) ?(.*)$/i;
const FILE_LINE = /^(?:file: )?(?:\/\S+\/|\.\/)?([^\s:]+\.[cm]?[jt]sx?):(\d+)(?::\d+)?\b/;
const COMPILE_HINTS = /(Failed to compile|error TS\d+|Type error:|Syntax error|SyntaxError|Module not found|Could not resolve|Cannot find module|Build failed|Transform failed|error during build|\[ERROR\]|Rollup failed|Unexpected token)/;

/**
 * The diagnostics a build printed, as `{ file, line, message }` (the first `limit`): tsc lines, Next.js `./file:line:col` blocks with a `Type error:` line,
 * and Vite/esbuild/Rollup errors. A file location is `null` when the line names none.
 *
 * @param {string} output What the build printed.
 * @param {number} [limit] How many to keep.
 * @returns {{ file: string | null, line: number | null, message: string }[]} The diagnostics, in order.
 *
 * @example
 * readBuildErrors("src/a.ts(3,5): error TS2304: Cannot find name 'x'.")[0].message; // => "TS2304: Cannot find name 'x'."
 */
export function readBuildErrors(output, limit = VERIFY_LIMITS.errors) {
  const lines = cleanOutput(output).split('\n').map((l) => l.trimEnd());
  const out = [];
  const push = (file, line, message) => { if (out.length < limit) out.push({ file, line, message: clip(message, VERIFY_LIMITS.message) }); };
  for (let i = 0; i < lines.length && out.length < limit; i += 1) {
    const l = lines[i].trim();
    let m = TSC_LINE.exec(l) ?? TSC_COLON.exec(l);
    if (m) { push(m[1], Number(m[2]), `${m[3]}: ${m[4]}`); continue; }
    m = NEXT_LOCATION.exec(l);
    if (m) {
      const next = lines.slice(i + 1, i + 4).map((x) => NEXT_MESSAGE.exec(x.trim())).find(Boolean);
      push(m[1], Number(m[2]), next ? `${next[1]}: ${next[2]}` : 'The build reported an error here.');
      continue;
    }
    m = VITE_ERROR.exec(l);
    if (m) {
      const at = lines.slice(i, i + 6).map((x) => FILE_LINE.exec(x.trim())).find(Boolean);
      push(at?.[1] ?? null, at ? Number(at[2]) : null, m[1] || lines[i + 1]?.trim() || 'The build failed.');
      continue;
    }
    if (/^Module not found: /.test(l) || /^(?:\S+ )?Could not resolve /.test(l)) push(null, null, l);
  }
  return out;
}

/**
 * Classify a finished build. `pass` (exit 0), `timeout` (the runner stopped it), `compile-error` (it failed and printed diagnostics or a
 * known compile message: the first `limit` are listed with file and line) or `failed` (it failed for a reason the patterns do not know:
 * the last lines of its output are kept, cleaned, as an excerpt).
 *
 * @param {{ exitCode: number | null, output: string, timedOut?: boolean, timeoutMs?: number }} run What the runner saw.
 * @param {{ limit?: number }} [opts] How many errors to list.
 * @returns {{ status: 'pass'|'compile-error'|'timeout'|'failed', errors: { file: string | null, line: number | null, message: string }[], excerpt: string, statement: string }} The classified result.
 *
 * @example
 * classifyBuildOutput({ exitCode: 1, output: "src/a.ts(3,5): error TS2304: Cannot find name 'x'." }).status; // => 'compile-error'
 */
export function classifyBuildOutput(run, { limit = VERIFY_LIMITS.errors } = {}) {
  const output = cleanOutput(run?.output);
  if (run?.timedOut) return { status: 'timeout', errors: [], excerpt: '', statement: `The build did not finish within ${Math.round((run.timeoutMs ?? VERIFY_TIMEOUTS.buildMs) / 1000)} seconds and was stopped.` };
  if (run?.exitCode === 0) return { status: 'pass', errors: [], excerpt: '', statement: 'The build succeeded.' };
  const errors = readBuildErrors(output, limit);
  if (errors.length || COMPILE_HINTS.test(output)) {
    const total = errors.length;
    return {
      status: 'compile-error',
      errors,
      excerpt: errors.length ? '' : excerptOf(output.split('\n').filter((l) => COMPILE_HINTS.test(l)).slice(0, VERIFY_LIMITS.excerptLines).join('\n')),
      statement: total ? `The build failed to compile: ${plural(total, 'error', 'errors')}${total >= limit ? ' or more' : ''} listed.` : 'The build failed to compile (its own message is kept below).',
    };
  }
  const tail = output.split('\n').filter((l) => l.trim()).slice(-VERIFY_LIMITS.excerptLines).join('\n');
  return { status: 'failed', errors: [], excerpt: excerptOf(tail), statement: `The build exited with code ${run?.exitCode ?? 'unknown'} without a compile error the classifier knows. The end of its output is kept below.` };
}

/**
 * The scope both read-only check steps declare: nothing is written.
 *
 * @returns {{ features: string[], files: object[] }} The empty scope.
 */
export function verifyTouches() {
  return { features: [], files: [] };
}

const answerOf = (answer) => (typeof answer === 'string' ? { option: answer } : answer && typeof answer === 'object' ? answer : null);

/**
 * The closed question about how far a shaped plan verifies itself (chooser summary shape, id `q-verify`): `types` (type-check the project after the units are wired),
 * `types-build` (type-check, then run its build script) or `none`. `types` is first, so it is the rules-only default; `types-build` is
 * offered disabled, with the reason, when package.json has no `build` script. An unanswered question uses its default, so it never
 * holds a plan back. Reads only.
 *
 * @param {string} root Project root.
 * @param {string | { option: string }} [answer] An answer to `q-verify`.
 * @returns {{ question: object, types: boolean, build: boolean }} The question, and whether the plan carries a type-check and a build step.
 *
 * @example
 * verifyOffer(root).types; // => true
 */
export function verifyOffer(root, answer) {
  const script = buildScriptOf(root);
  const options = [
    { id: 'types', label: 'Type-check after the wiring', enabled: true, why: 'Runs tsc over the project and names what is wrong, grouped by file. Writes nothing.' },
    { id: 'types-build', label: 'Type-check, then build', enabled: script !== null, why: script !== null ? `Also runs the project's build script (${script}). Writes nothing of its own.` : 'package.json has no "build" script to run.' },
    { id: 'none', label: 'No verification step', enabled: true, why: 'The plan ends with the proof of the screen, as before.' },
  ];
  const chosen = answerOf(answer)?.option;
  const usable = options.find((o) => o.id === chosen && o.enabled);
  const used = usable ? usable.id : 'types';
  const question = { id: VERIFY_QUESTION_ID, question: 'Should the plan check that the project still type-checks (and builds) once the screen is wired?', options, default: 'types', chosen: usable ? usable.id : null };
  return { question, types: used === 'types' || used === 'types-build', build: used === 'types-build' };
}

/**
 * The project's `build` script text, or `null` when package.json is absent, unreadable or has none.
 *
 * @param {string} root Project root.
 * @returns {string | null} The script, for example `next build`.
 *
 * @example
 * buildScriptOf(root); // => 'vite build'
 */
export function buildScriptOf(root) {
  try {
    const script = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))?.scripts?.build;
    return typeof script === 'string' && script.trim() ? script.trim() : null;
  } catch {
    return null;
  }
}
