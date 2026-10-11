// Ticket 7.1 -- in-memory transactional file compiler.
//
// Buffers generated file content in memory across however many pipeline
// steps a caller runs, then commits it to disk only if the buffered result
// passes `construct validate` -- with zero partial writes on failure. The
// validation itself can't run against the buffer directly (every enforcer
// reads real files off disk, by design, so each stays trivially reusable by
// every other caller in this codebase), so commit() materializes the buffer
// into a throwaway shadow copy of the project, validates *that*, and only on
// success replays the buffered writes onto the real root -- via packages/core/fs.mjs's
// existing `write()` helper, the same primitive every other generator in
// this codebase already writes through.
//
// #546 -- commit()'s default validate used to be validateArchitecture alone, so a bot/engine
// write could pass this gate while violating SOC, readability or public-api-drift -- rules
// `construct validate` itself enforces. Defaults to the same aggregateValidation(DEFAULT_ENFORCERS)
// set pipeline.mjs already used, so a green engine run and a green `construct validate` agree.
//
// #548 -- the default validate now runs on the AFFECTED SET (the staged files plus their blast
// radius, via scopeGate.mjs), not the whole project, and commit() always returns `blastRadius` so a
// caller (the approval UI, a CLI) can show it BEFORE the transaction is committed as much as after.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { write, WALK_SKIP_DIRS, isGitCheckout } from '@line/construct-core/fs';
import { assertNotFrozen } from '@line/construct-core/frozen';
import { aggregateValidation } from '@line/construct-core/registry';
import { enforcersForRoot } from '@line/construct-core/profiles';
import { affectedSet } from './scopeGate.mjs';

// Mirrors packages/core/fs.mjs's walk(): these never belong in a shadow copy used for
// validation (and copying node_modules in particular would be slow/pointless), and neither
// does a nested git checkout below the root (another project, which walk() skips too).
const SKIP_DIRS = WALK_SKIP_DIRS;

/** The buffer value of a staged delete (deleteFile). */
const DELETED = Symbol('deleted');

function toPosixRel(relPath) {
  return relPath.split(path.sep).join('/');
}

/** Recursively copy `root` into `shadowDir`, skipping SKIP_DIRS entries at
 * any depth. fs.cpSync's `filter` receives absolute source paths. */
function copyProjectTree(root, shadowDir) {
  fs.mkdirSync(shadowDir, { recursive: true });
  if (!fs.existsSync(root)) return;
  fs.cpSync(root, shadowDir, {
    recursive: true,
    filter: (src) => !SKIP_DIRS.has(path.basename(src)) && (src === root || !isGitCheckout(src)),
  });
}

/** Remove the shadow copy without ever throwing: a read-only folder copied from the project is made writable first,
 * and a copy that still cannot go is left for heavy.sh's prune (its name carries this pid). A cleanup failure must
 * never replace the commit's own result or error. */
function removeShadow(shadowDir) {
  try {
    fs.rmSync(shadowDir, { recursive: true, force: true });
    return;
  } catch {
    // fall through: make it writable and try once more
  }
  const writable = (dir) => {
    try { fs.chmodSync(dir, 0o755); } catch { return; }
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) if (e.isDirectory()) writable(path.join(dir, e.name));
  };
  writable(shadowDir);
  try { fs.rmSync(shadowDir, { recursive: true, force: true }); } catch { /* left for the prune */ }
}

/**
 * Create a new transaction against `root`. Nothing under `root` is touched
 * until (and unless) `commit()` succeeds.
 */
export function createTransaction(root) {
  const buffer = new Map(); // posix-relative path -> content, or DELETED for a staged delete

  return {
    root,

    /** Stage a file write; `content` replaces any earlier staged write for
     * the same path in this same transaction. `relPath` may be absolute
     * (under root) or already root-relative; either way it's stored
     * root-relative with posix separators. */
    writeFile(relPath, content) {
      const rel = path.isAbsolute(relPath) ? path.relative(root, relPath) : relPath;
      // #23: refuse at staging time so a pipeline aborts before any commit.
      assertNotFrozen(path.join(root, rel));
      buffer.set(toPosixRel(rel), content);
    },

    /** Stage a file delete (Line promote moves a file, #T2): validated like a write, against a shadow
     * copy without the file, and replayed onto `root` only when the commit passes. Deleting a path
     * that does not exist is a no-op at commit. A later writeFile for the same path replaces it. */
    deleteFile(relPath) {
      const rel = path.isAbsolute(relPath) ? path.relative(root, relPath) : relPath;
      assertNotFrozen(path.join(root, rel));
      buffer.set(toPosixRel(rel), DELETED);
    },

    /** Read back a staged write, or fall through to the real file on disk
     * if nothing has been staged for that path yet. Returns undefined if
     * neither exists. */
    readFile(relPath) {
      const rel = toPosixRel(path.isAbsolute(relPath) ? path.relative(root, relPath) : relPath);
      if (buffer.has(rel)) return buffer.get(rel) === DELETED ? undefined : buffer.get(rel);
      const abs = path.join(root, rel);
      return fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : undefined;
    },

    /** Root-relative paths of every file currently staged in this transaction. */
    pendingFiles() {
      return [...buffer.keys()];
    },

    /** Discard every staged write without touching disk. */
    reset() {
      buffer.clear();
    },

    /**
     * Validate the buffered result in an isolated shadow copy of `root`,
     * then either:
     *  - commit: replay every staged write onto the real `root` (via
     *    packages/core/fs.mjs's `write()`) and clear the buffer, or
     *  - abort: leave `root` completely untouched.
     * Either way the shadow copy itself is always cleaned up.
     *
     * @param {{validate?: (shadowRoot: string, ctx: {files: string[], blastRadius: object}) => {violations: object[], ok: boolean}}} [opts]
     *   `validate` defaults to `aggregateValidation(enforcersForRoot(shadow), {files})` (the project's preset: profile) scoped to the AFFECTED
     *   SET (#548: the staged files' blast radius, via `scopeGate.affectedSet`) instead of the whole
     *   project; overridable for tests and for a caller that wants a narrower or different check. Its
     *   second argument is always given, so an override that ignores it still gets the whole-project
     *   behaviour it had before #548.
     * @returns {{committed: boolean, violations: object[], blastRadius: {files: string[], features: string[], impact: object|null}}}
     */
    commit({ validate } = {}) {
      if (buffer.size === 0) return { committed: true, violations: [], blastRadius: { files: [], features: [], impact: null } };

      // The pid in the name is what lets packages/tools/dev/heavy.sh tell a live shadow copy from a dead one (#414).
      const shadowDir = fs.mkdtempSync(path.join(os.tmpdir(), `construct-txn-${process.pid}-`));
      try {
        copyProjectTree(root, shadowDir);
        const staged = [...buffer.keys()];
        for (const [relPath, content] of buffer) {
          const dest = path.join(shadowDir, relPath);
          if (content === DELETED) { fs.rmSync(dest, { force: true }); continue; }
          fs.mkdirSync(path.dirname(dest), { recursive: true });
          fs.writeFileSync(dest, content);
        }

        // Blast radius runs against the shadow copy, so the import graph it walks already reflects
        // what is about to land, not the tree as it was before this transaction.
        const blastRadius = affectedSet(shadowDir, staged);
        const runValidate = validate || ((root2, { files }) => aggregateValidation(root2, enforcersForRoot(root2), { files }));
        const { violations, ok } = runValidate(shadowDir, { files: blastRadius.files, blastRadius });
        if (!ok) return { committed: false, violations, blastRadius };

        // Land every file, or none: when the disk refuses one (permissions, a full disk, a read-only mount), every file
        // this commit already changed is put back as it was before the error is passed on, so nothing partial lands.
        const landed = [];
        try {
          for (const [relPath, content] of buffer) {
            const abs = path.join(root, relPath);
            const before = fs.existsSync(abs) ? fs.readFileSync(abs) : null;
            if (content === DELETED) fs.rmSync(abs, { force: true });
            else write(abs, content);
            landed.push([abs, before]);
          }
        } catch (e) {
          for (const [abs, before] of landed.reverse()) {
            try {
              if (before === null) fs.rmSync(abs, { force: true });
              else fs.writeFileSync(abs, before);
            } catch {
              // best effort: the original error below is what the caller needs to see
            }
          }
          throw e;
        }
        buffer.clear();
        return { committed: true, violations, blastRadius };
      } finally {
        removeShadow(shadowDir);
      }
    },
  };
}

/**
 * cl1 -- the atomic Line-state path: Line's own state (traces, drafted issues; `line/` by default) is not project code,
 * so it skips the shadow validate, but it still goes through this writer and nowhere else. Only paths inside the state
 * folder are accepted; each write is a temp file in the same folder then `rename()`, so a reader never sees half a
 * file. `append: true` adds `content` to what is there (read, append, rename), for append-only JSONL.
 *
 * @param {string} root Project root.
 * @param {string} relPath Root-relative posix path, inside `stateDir`.
 * @param {string} content
 * @param {{append?: boolean, stateDir?: string}} [opts] `stateDir` the project's Line state folder (default `line`).
 * @returns {string} The root-relative path written.
 * @throws {Error} When the path is not inside the state folder.
 */
export function writeLineState(root, relPath, content, { append = false, stateDir = 'line' } = {}) {
  const rel = toPosixRel(String(relPath));
  const dir = toPosixRel(String(stateDir)).replace(/\/+$/, '');
  if (!dir || path.isAbsolute(rel) || rel.split('/').some((s) => s === '..' || s === '' || s === '.') || !rel.startsWith(`${dir}/`)) {
    throw new Error(`Line state is written only inside ${dir || 'the state folder'}/, not ${rel}.`);
  }
  const abs = path.join(root, rel);
  assertNotFrozen(abs);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  let before = '';
  if (append) { try { before = fs.readFileSync(abs, 'utf8'); } catch (e) { if (/** @type {any} */ (e).code !== 'ENOENT') throw e; } }
  const tmp = `${abs}.${process.pid}.${Math.random().toString(16).slice(2, 10)}.tmp`;
  fs.writeFileSync(tmp, before + content, 'utf8');
  fs.renameSync(tmp, abs);
  return rel;
}
