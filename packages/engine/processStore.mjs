// #287 — where a process lives between one Cockpit session and the next.
//
// The decision recorded on the issue: process state is kept **outside the
// project**, in a per-user state directory, keyed by the absolute project
// root. `$CONSTRUCT_STATE_DIR` if set, else `$XDG_STATE_HOME/construct`, else
// `~/.local/state/construct`.
//
// Why not in-memory: #292 requires a running process to survive the drawer
// being closed and the page being reloaded, and in-memory state also dies
// with every `ui/server` restart — which is exactly the "reopen the Cockpit
// and see your running plan" case the epic exists for.
//
// Why not a file inside the project: runtime state would become a citizen of
// the user's repository. It would show up in `git status`, get committed by
// accident, need a `.gitignore` line in a repo Construct does not own, be
// walked by src/fs.mjs's walker and by the frozen/validate enforcers, and be
// copied into every shadow tree `transactionalWriter.commit()` builds to
// validate against. Process state is machine-local, like shell history.
// Source is not.
//
// Layout:
//   <stateDir>/processes/<basename>-<sha1(root)[0..12]>/<processId>.json
//
// The directory listing IS the index. There is no separate index file,
// because an index file is a second source of truth that drifts from the
// files it indexes the first time a write is interrupted.
//
// Writes are atomic: a temp file in the same directory, then `rename()`, so a
// process killed mid-save leaves either the old record or the new one, never
// a half-written JSON file a server then refuses to boot on.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { validateProcess, migrateProcess, processSummary, appendLog, formatProcessErrors } from './processModel.mjs';
import { topLevelState } from './processMachine.mjs';

/**
 * The base state directory, resolved from the environment. Pass `env` to
 * test the resolution without touching `process.env`.
 *
 * `CONSTRUCT_STATE_DIR` wins so a test, a sandbox or a second Cockpit can be
 * pointed somewhere harmless in one variable.
 *
 * @param {Record<string, string|undefined>} [env] Environment to read; defaults to `process.env`.
 * @returns {string} Absolute path of the base state directory: `CONSTRUCT_STATE_DIR`, else `$XDG_STATE_HOME/construct`, else `~/.local/state/construct`.
 *
 * @example
 * resolveStateDir({ CONSTRUCT_STATE_DIR: '/tmp/state' }); // => '/tmp/state'
 */
export function resolveStateDir(env = process.env) {
  if (env.CONSTRUCT_STATE_DIR) return path.resolve(env.CONSTRUCT_STATE_DIR);
  if (env.XDG_STATE_HOME) return path.join(path.resolve(env.XDG_STATE_HOME), 'construct');
  return path.join(env.HOME || os.homedir(), '.local', 'state', 'construct');
}

/**
 * The per-project directory name: readable prefix plus a hash, so two
 * projects called `web` in different checkouts never collide and a human
 * looking in the state directory can still tell which is which.
 *
 * @param {string} projectRoot Path of the project (resolved to absolute first).
 * @returns {string} `<basename>-<12 hex chars of a SHA-1 of the absolute path>`, safe to use as a directory name.
 *
 * @example
 * projectKey('/work/web'); // => 'web-3f2a9c1b7d40'
 */
export function projectKey(projectRoot) {
  const resolved = path.resolve(projectRoot);
  const hash = crypto.createHash('sha1').update(resolved).digest('hex').slice(0, 12);
  const base = path.basename(resolved).replace(/[^A-Za-z0-9._-]/g, '_') || 'project';
  return `${base}-${hash}`;
}

/**
 * Absolute directory holding one project's process records.
 *
 * @param {string} projectRoot Project the processes belong to.
 * @param {object} [options]
 * @param {string} [options.stateDir] Base state directory (defaults to `resolveStateDir()`).
 * @returns {string} Absolute path of `<stateDir>/processes/<projectKey>`.
 */
export function processDir(projectRoot, { stateDir = resolveStateDir() } = {}) {
  return path.join(stateDir, 'processes', projectKey(projectRoot));
}

/** A disk-full error, said plainly. Anything else is returned as it came. */
function describeWriteError(e, file) {
  if (e?.code !== 'ENOSPC' && e?.code !== 'EDQUOT') return e;
  const err = /** @type {NodeJS.ErrnoException} */ (new Error(`No space left on device while saving ${path.basename(file)} (${e.code}): the state directory ${path.dirname(file)} is full. Free some space and try again; the previous version of the record is intact.`));
  err.code = e.code;
  err.cause = e;
  return err;
}

/**
 * Write `value` as JSON to `file` atomically: a temp file in the same directory, flushed to disk (`fsync`), then
 * `rename()`. On ANY failure the temp file is removed and the old file is untouched; a disk-full error (`ENOSPC`,
 * `EDQUOT`) is rethrown with a message that says so (#423). `fsImpl` is a test seam.
 */
export function atomicWriteJson(file, value, { fsImpl = fs } = {}) {
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  let fd = null;
  try {
    fsImpl.mkdirSync(path.dirname(file), { recursive: true });
    fd = fsImpl.openSync(tmp, 'w');
    fsImpl.writeSync(fd, `${JSON.stringify(value, null, 2)}\n`);
    fsImpl.fsyncSync(fd);
    fsImpl.closeSync(fd);
    fd = null;
    fsImpl.renameSync(tmp, file);
  } catch (e) {
    if (fd !== null) { try { fsImpl.closeSync(fd); } catch { /* already closed */ } }
    try { fsImpl.rmSync(tmp, { force: true }); } catch { /* never created, or gone */ }
    throw describeWriteError(e, file);
  }
}

/** A process record that could not be used, with the reason — returned rather
 * than thrown so one corrupt file cannot stop a Cockpit listing the rest. */
function unreadable(file, reason) {
  return { file, id: path.basename(file, '.json'), reason };
}

/**
 * Open the store for one project. Returns a small object rather than free
 * functions so a caller passes the project root and the state directory once.
 *
 * JSON in, JSON out: every method takes and returns plain process records —
 * the same objects processModel.mjs produces. Nothing here knows about HTTP,
 * WebSockets or the UI.
 *
 * @param {string} projectRoot The project the processes belong to.
 * @param {object} [options]
 * @param {string} [options.stateDir] Base state directory.
 * @param {() => string} [options.now] Clock (ISO string).
 * @returns {{save:Function, load:Function, all:Function, list:Function, remove:Function, adoptInterrupted:Function}} The store bound to that project.
 */
export function openProcessStore(projectRoot, { stateDir = resolveStateDir(), now = () => new Date().toISOString() } = {}) {
  const dir = processDir(projectRoot, { stateDir });
  const fileFor = (id) => path.join(dir, `${String(id).replace(/[^A-Za-z0-9._-]/g, '_')}.json`);

  const readFile = (file) => {
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (e) {
      return { process: null, problem: unreadable(file, `unreadable: ${e.message}`) };
    }
    parsed = migrateProcess(parsed);
    const { valid, errors } = validateProcess(parsed);
    if (!valid) return { process: null, problem: unreadable(file, `invalid: ${formatProcessErrors(errors)[0]}`) };
    return { process: parsed, problem: null };
  };

  const store = {
    dir,
    projectRoot: path.resolve(projectRoot),

    /** Persist a process. Stamps `owner` with this OS process's pid so a
     * record left `running` by a killed server is recognisable later.
     * Refuses to write an invalid record — a state file is only useful if
     * everything that reads it can trust its shape. */
    save(processRecord) {
      const stamped = {
        ...processRecord,
        owner: topLevelState(processRecord.state) === 'running'
          ? { pid: process.pid, since: processRecord.owner?.pid === process.pid ? processRecord.owner.since : now() }
          : null,
      };
      const { valid, errors } = validateProcess(stamped);
      if (!valid) throw new TypeError(`Refusing to save an invalid process record: ${formatProcessErrors(errors)[0]}`);
      atomicWriteJson(fileFor(stamped.id), stamped);
      return stamped;
    },

    /** Load one process, or null if there is no such record. Throws on a
     * corrupt or invalid file — a caller asking for one specific process
     * wants to know it is broken, unlike `list()`, which must keep going. */
    load(id) {
      const file = fileFor(id);
      if (!fs.existsSync(file)) return null;
      const { process: record, problem } = readFile(file);
      if (problem) throw new Error(`Process ${id} cannot be read — ${problem.reason}`);
      return record;
    },

    /** Every process for this project, newest first, as full records.
     * `problems` lists files that could not be read, so a corrupt record is
     * reported rather than silently missing. */
    all() {
      if (!fs.existsSync(dir)) return { processes: [], problems: [] };
      const processes = [];
      const problems = [];
      for (const name of fs.readdirSync(dir).sort()) {
        if (!name.endsWith('.json')) continue;
        const { process: record, problem } = readFile(path.join(dir, name));
        if (problem) problems.push(problem);
        else processes.push(record);
      }
      processes.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
      return { processes, problems };
    },

    /** What #292's list renders: one summary row per process, newest first,
     * without shipping every plan, log and artifact to a client. */
    list() {
      const { processes, problems } = store.all();
      return { processes: processes.map(processSummary), problems };
    },

    /** Remove a process record. Returns true if there was one. */
    remove(id) {
      const file = fileFor(id);
      if (!fs.existsSync(file)) return false;
      fs.rmSync(file);
      return true;
    },

    /**
     * Recognise processes that a killed server left marked `running`, and
     * move them to `paused`.
     *
     * A record saying `running` whose owning OS process is gone is a lie, and
     * the honest repair is `paused`, not a seventh state and not `failed`:
     * it is genuinely not running, and `paused` offers exactly the right
     * affordance — resume it. The step that was in flight goes back to
     * `pending`, which is safe because `transactionalWriter.mjs` only lands a
     * step's writes on a successful `commit()`, so an interrupted step wrote
     * nothing and rerunning it is not a double-apply.
     *
     * Called once at server start-up, deliberately not from `load()`:
     * adoption mutates state, and a read should not.
     *
     * Known limitation: liveness is `kill(pid, 0)`, so a recycled pid now
     * belonging to an unrelated program reads as "still alive" and the record
     * is left alone until the next restart. For a local, single-user dev tool
     * that is the right trade against a heartbeat file and its own failure
     * modes.
     */
    adoptInterrupted({ pid = process.pid, isAlive = defaultIsAlive } = {}) {
      const { processes } = store.all();
      const adopted = [];
      for (const record of processes) {
        if (topLevelState(record.state) !== 'running') continue;
        const owner = record.owner;
        if (owner && owner.pid === pid) continue; // us; still running
        if (owner && isAlive(owner.pid)) continue; // someone else's, still alive
        let next = { ...record, state: 'paused', pendingControl: null, owner: null };
        if (record.currentStepId) {
          next = {
            ...next,
            steps: next.steps.map((s) => (s.id === record.currentStepId ? { ...s, status: 'pending', error: null } : s)),
            currentStepId: null,
          };
        }
        next = appendLog(next, {
          provenance: 'warn',
          message: `Paused: the Construct server that was running this process (pid ${owner?.pid ?? 'unknown'}) is gone. Nothing was half-written — an interrupted step stages its writes and only lands them on a successful commit. Resume to run it again.`,
          stepId: record.currentStepId ?? null,
          now,
        });
        adopted.push(store.save(next));
      }
      return adopted;
    },
  };

  return store;
}

function defaultIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM'; // exists, owned by someone else
  }
}
