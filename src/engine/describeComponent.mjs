// `describeComponent(root, relPath)`: a deterministic block that documents ONE component file (#434, serves #431).
// What props does it take, of what type, required or not, with what default and description, read from the
// source text with react-docgen (behind our own small interface, ./describeDocgen.mjs). No LLM, no evaluation of
// project code, same text in -> same JSON out.
//
//   describeComponent(root, relPath, opts?) -> Promise<Result>
//   Result = { ok: true,  path, components: [{ name, description, props: [{ name, type, required, default, description }] }] }
//          | { ok: false, path, code, error }
//   `components: []` is the graceful "no docs found" answer (the file parsed but has no component in it).
//   code: OUTSIDE_ROOT | NOT_SOURCE | NOT_FOUND | TOO_LARGE | TIMEOUT | PARSE_ERROR | ENGINE_ERROR | DISABLED
//
// Bounded: the file must be a regular source file inside `root` (real path, symlinks that leave it refused), at
// most `maxBytes`, and the parse runs in a worker thread that is terminated after `timeoutMs`. It never throws.
// Options: { maxBytes = 256 KiB, timeoutMs = 2000, engine = 'react-docgen' | 'none', describe? (sync
// `(source, filename) => DescribeResult`, run in-process instead of the worker: tests and alternative engines) }.
import fs from 'node:fs';
import path from 'node:path';
import { Worker } from 'node:worker_threads';

export const DESCRIBE_DEFAULTS = Object.freeze({ maxBytes: 256 * 1024, timeoutMs: 2000 });
export const DESCRIBE_EXTENSIONS = Object.freeze(['.tsx', '.jsx', '.ts', '.js', '.mjs']);

const WORKER_URL = new URL('./describeComponentWorker.mjs', import.meta.url);
const fail = (rel, code, error) => ({ ok: false, path: rel, code, error });

/** Root-relative `relPath` -> real absolute path of a regular source file inside `root`, or a failure result. */
function resolveFile(root, relPath) {
  if (typeof relPath !== 'string' || !relPath || relPath.includes('\0') || path.isAbsolute(relPath) || /^[a-zA-Z]:/.test(relPath) || relPath.split(/[\\/]/).includes('..')) {
    return { fail: fail(String(relPath ?? ''), 'OUTSIDE_ROOT', 'That path is not a file inside the project.') };
  }
  if (!DESCRIBE_EXTENSIONS.includes(path.extname(relPath))) return { fail: fail(relPath, 'NOT_SOURCE', 'Only .tsx, .jsx, .ts, .js and .mjs files can be documented.') };
  try {
    const realRoot = fs.realpathSync(root);
    const real = fs.realpathSync(path.resolve(realRoot, relPath));
    const inside = real === realRoot || real.startsWith(realRoot.endsWith(path.sep) ? realRoot : realRoot + path.sep);
    if (!inside || real.split(path.sep).includes('node_modules')) return { fail: fail(relPath, 'OUTSIDE_ROOT', 'That path is not a file inside the project.') };
    if (!fs.statSync(real).isFile()) return { fail: fail(relPath, 'NOT_FOUND', 'No such file.') };
    return { real };
  } catch {
    return { fail: fail(relPath, 'NOT_FOUND', 'No such file.') };
  }
}

function runInWorker(source, filename, timeoutMs) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (r) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      worker.terminate().catch(() => {});
      resolve(r);
    };
    let worker;
    const timer = setTimeout(() => finish({ ok: false, code: 'TIMEOUT', error: 'Reading this file took too long, so no props are shown.' }), timeoutMs);
    try {
      worker = new Worker(WORKER_URL, { workerData: { source, filename }, resourceLimits: { maxOldGenerationSizeMb: 256 } });
    } catch {
      clearTimeout(timer);
      return resolve({ ok: false, code: 'ENGINE_ERROR', error: 'The documentation reader could not start.' });
    }
    worker.once('message', finish);
    worker.once('error', () => finish({ ok: false, code: 'ENGINE_ERROR', error: 'The documentation reader could not read this file.' }));
    worker.once('exit', () => finish({ ok: false, code: 'ENGINE_ERROR', error: 'The documentation reader stopped without an answer.' }));
  });
}

export async function describeComponent(root, relPath, opts = {}) {
  try {
    const { maxBytes = DESCRIBE_DEFAULTS.maxBytes, timeoutMs = DESCRIBE_DEFAULTS.timeoutMs, engine = 'react-docgen', describe } = opts;
    const at = resolveFile(root, relPath);
    if (at.fail) return at.fail;
    if (engine === 'none') return fail(relPath, 'DISABLED', 'Prop documentation is switched off for this project.');
    if (fs.statSync(at.real).size > maxBytes) return fail(relPath, 'TOO_LARGE', 'This file is too large to document.');
    const source = fs.readFileSync(at.real, 'utf8');
    const filename = path.basename(at.real);
    const result = typeof describe === 'function' ? describe(source, filename) : await runInWorker(source, filename, timeoutMs);
    return { ...result, path: relPath };
  } catch {
    return fail(String(relPath ?? ''), 'ENGINE_ERROR', 'The documentation reader could not read this file.');
  }
}
