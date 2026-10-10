// T16.10 — buffered, all-or-nothing writes for one generation run.
//
// A run stages every generated file in memory, then flushes them together with one commit() — so a failure
// partway through generation (a bad template, a prettier error on one file) never leaves a half-written
// feature on disk; either every staged file lands, or none does. Picks Construct's own mechanism for this
// (`packages/engine/transactionalWriter.mjs`'s `createTransaction`, loaded through `src/construct.mjs`'s one
// seam) when CONSTRUCT_ROOT is set, else falls back to Trace's own equivalent below with the same tiny
// interface (writeFile/readFile/pendingFiles/reset/commit) and the same all-or-nothing guarantee.
//
// Construct's own commit() defaults to validating the buffered result with its architecture enforcer, which
// needs plural layer folders (`controllers/`, `services/`, ...) and an `architecture.yml` Trace's generated
// features don't have (see docs/CONSTRUCT-REUSE.md — this is also why T16.4 does not reuse
// `core/validate.mjs`'s `aggregateValidation`/`DEFAULT_ENFORCERS` wholesale). So `commit()` here always
// overrides `validate` with one that accepts the buffer unconditionally: only the buffer/commit-or-rollback
// primitive is reused, never Construct's layer rules.
import fs from "node:fs";
import path from "node:path";
import { loadConstructTransactionalWriter } from "./construct.mjs";

const ACCEPT = () => ({ ok: true, violations: [] });
const toPosixRel = (root, p) => (path.isAbsolute(p) ? path.relative(root, p) : p).split(path.sep).join("/");

/**
 * Trace's own transaction, used when Construct is unavailable. Same interface and guarantee as Construct's
 * `createTransaction`: nothing under `root` is touched until (and unless) `commit()` runs.
 *
 * @param {string} root Directory the staged paths are relative to.
 */
function fallbackTransaction(root) {
  const buffer = new Map(); // posix-relative path -> content

  return {
    root,
    /** Stage a file write; replaces any earlier staged write for the same path in this transaction. */
    writeFile(relPath, content) {
      buffer.set(toPosixRel(root, relPath), content);
    },
    /** Read back a staged write, or the real file on disk if nothing is staged for that path yet. */
    readFile(relPath) {
      const rel = toPosixRel(root, relPath);
      if (buffer.has(rel)) return buffer.get(rel);
      const abs = path.join(root, rel);
      return fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : undefined;
    },
    /** Root-relative paths of every file currently staged. */
    pendingFiles() {
      return [...buffer.keys()];
    },
    /** Discard every staged write without touching disk. */
    reset() {
      buffer.clear();
    },
    /** Write every staged file to disk and clear the buffer. Never partial: nothing here can fail mid-way
     * (no validation step), so this always succeeds once called. */
    commit() {
      for (const [relPath, content] of buffer) {
        const dest = path.join(root, relPath);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, content);
      }
      buffer.clear();
      return { committed: true, violations: [] };
    },
  };
}

/**
 * Start a buffered write transaction against `root`: stage files with `writeFile`, then flush them all at once
 * with `commit()`. Nothing under `root` changes until `commit()` is called (and it is not called at all if the
 * caller throws first), so a generation run either lands completely or not at all.
 *
 * @param {string} root Directory the staged relative paths are written under.
 * @returns {{root: string, writeFile: Function, readFile: Function, pendingFiles: Function, reset: Function,
 *   commit: Function}} `commit(opts)` always overrides Construct's default architecture validator with one
 *   that accepts (see the module comment); pass `{validate}` to run a stricter check instead.
 */
export function createWriteTransaction(root) {
  const impl = loadConstructTransactionalWriter();
  const txn = impl ? impl.createTransaction(root) : fallbackTransaction(root);
  return { ...txn, commit: (opts) => txn.commit({ validate: ACCEPT, ...opts }) };
}
