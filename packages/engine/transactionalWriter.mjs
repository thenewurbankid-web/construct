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
import { write } from '../core/fs.mjs';
import { assertNotFrozen } from '../core/frozen.mjs';
import { aggregateValidation } from '../core/registry.mjs';
import { DEFAULT_ENFORCERS } from './defaultEnforcers.mjs';
import { affectedSet } from './scopeGate.mjs';

// Mirrors packages/core/fs.mjs's walk(): these never belong in a shadow copy used for
// validation (and copying node_modules in particular would be slow/pointless).
const SKIP_DIRS = new Set(['node_modules', '.next', '.git']);

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
    filter: (src) => !SKIP_DIRS.has(path.basename(src)),
  });
}

/**
 * Create a new transaction against `root`. Nothing under `root` is touched
 * until (and unless) `commit()` succeeds.
 */
export function createTransaction(root) {
  const buffer = new Map(); // posix-relative path -> content

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

    /** Read back a staged write, or fall through to the real file on disk
     * if nothing has been staged for that path yet. Returns undefined if
     * neither exists. */
    readFile(relPath) {
      const rel = toPosixRel(path.isAbsolute(relPath) ? path.relative(root, relPath) : relPath);
      if (buffer.has(rel)) return buffer.get(rel);
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
     *   `validate` defaults to `aggregateValidation(DEFAULT_ENFORCERS, {files})` scoped to the AFFECTED
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
          fs.mkdirSync(path.dirname(dest), { recursive: true });
          fs.writeFileSync(dest, content);
        }

        // Blast radius runs against the shadow copy, so the import graph it walks already reflects
        // what is about to land, not the tree as it was before this transaction.
        const blastRadius = affectedSet(shadowDir, staged);
        const runValidate = validate || ((root2, { files }) => aggregateValidation(root2, DEFAULT_ENFORCERS, { files }));
        const { violations, ok } = runValidate(shadowDir, { files: blastRadius.files, blastRadius });
        if (!ok) return { committed: false, violations, blastRadius };

        for (const [relPath, content] of buffer) {
          write(path.join(root, relPath), content);
        }
        buffer.clear();
        return { committed: true, violations, blastRadius };
      } finally {
        fs.rmSync(shadowDir, { recursive: true, force: true });
      }
    },
  };
}
