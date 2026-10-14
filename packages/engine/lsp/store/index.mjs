// #950 -- the Line LSP's persistent hash index: what the slow layers computed for one file (Smith steps in plain and
// exact style, stable ids, rule results, exported signatures, references), stored by content hash so a cold start
// reuses every unchanged file and recomputes only the misses.
//
//   const store = openStore(root, { pin: { smith: 'cbc25671+raw', rules: 'line@0.9.0#ab12' } })
//   store.get(rel, hash)          -> record | null     a hit only when (content hash, file, Smith pin, rules version) match
//   store.put(rel, hash, data)    -> record            atomic: written to a temp file, then renamed into place
//   store.prune({ live, days })   -> { removed, kept, tmp }   entries matching no live (file, hash) for `days` go
//   readOnly: true                -> reads stored entries, keeps new ones in memory, writes NOTHING to disk;
//   store.setWritable()           -> leaves read-only mode and flushes the in-memory entries (store.flush())
//
// Layout: <root>/line/.index/v1/<hh>/<contentHash>-<fileHash>-<pinKey>.json, one small JSON file per entry, sharded by
// the content hash's first two hex characters. One file per entry means two writers (the foreground LSP and the
// background indexer) never read-modify-write the same file, so neither can lose the other's entries, and a writer
// killed mid-write leaves only a temp file (never a torn entry); temp files of dead writers are swept by prune().
// The folder carries its own `.gitignore` (`*`), so it never shows up in git even where the project's does not list it.
// Key: the content hash (host.mjs hashOf, the sha1 the host versions files by), the file's path (stable ids and rule
// results depend on it), and pinKey = hash of (store version, Smith pin, rules profile version): an upgrade of Smith
// or the rules makes every old entry a miss, and prune() removes them after `days`.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const INDEX_DIR = 'line/.index';
export const STORE_VERSION = 1;
export const PRUNE_DAYS = 30;
const DAY = 86400000;
const sha = (t) => crypto.createHash('sha1').update(t).digest('hex');
const ENTRY = /^([0-9a-f]{16})-([0-9a-f]{8})-([0-9a-f]{8})\.json$/;
const TMP = /^\.(.+)\.(\d+)\.[0-9a-f]+\.tmp$/;

/**
 * The 8-hex key of a (Smith pin, rules version) pair under this store version.
 * @param {{smith?: string, rules?: string}} pin
 * @returns {string}
 */
export const pinKeyOf = (pin) => sha(JSON.stringify([STORE_VERSION, String(pin?.smith ?? ''), String(pin?.rules ?? '')])).slice(0, 8);
const fileKeyOf = (rel) => sha(rel).slice(0, 8);
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return /** @type {any} */ (e)?.code === 'EPERM'; } };

/**
 * Write `text` to `file` atomically: a temp file in the same folder (named after the writer's pid), then a rename.
 * @param {string} file Absolute path.
 * @param {string} text
 */
export function atomicWrite(file, text) {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(file)}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`);
  try {
    fs.writeFileSync(tmp, text);
    fs.renameSync(tmp, file);
  } catch (e) {
    try { fs.rmSync(tmp, { force: true }); } catch { /* gone already */ }
    throw e;
  }
}

/**
 * Open (create on first write) the persistent index of a project.
 * @param {string} root Project root.
 * @param {{pin: {smith?: string, rules?: string}, dir?: string, now?: () => number, readOnly?: boolean}} o `dir`: another
 *   folder (tests). `readOnly`: nothing is written (no entry, no folder, no touch) until setWritable().
 * @returns {any} The store: { dir, pin, pinKey, get, put, has, prune, stats }.
 */
export function openStore(root, { pin, dir, now = Date.now, readOnly = false } = /** @type {any} */ ({})) {
  const base = dir ?? path.join(path.resolve(root), INDEX_DIR);
  const vdir = path.join(base, `v${STORE_VERSION}`);
  const pinKey = pinKeyOf(pin);
  const stats = { hits: 0, misses: 0, writes: 0, errors: 0 };
  let ready = false;
  let ro = !!readOnly;
  const memory = new Map(); // read-only mode: name -> record, written by flush()
  const ensure = () => {
    if (ready) return;
    fs.mkdirSync(vdir, { recursive: true });
    const gi = path.join(base, '.gitignore');
    if (!fs.existsSync(gi)) atomicWrite(gi, '# the Line LSP persistent index (#950): a cache, rebuilt from the code\n*\n');
    ready = true;
  };
  const nameOf = (rel, hash) => `${hash}-${fileKeyOf(rel)}-${pinKey}.json`;
  const pathOf = (rel, hash) => path.join(vdir, hash.slice(0, 2), nameOf(rel, hash));

  const store = {
    dir: base, pin, pinKey, stats,
    /** The entry's absolute path (tests). */
    pathOf,
    /**
     * The stored record of `rel` at content `hash`, or null (a miss: never stored, other pin, unreadable).
     * @param {string} rel @param {string} hash
     */
    get(rel, hash) {
      const p = pathOf(rel, hash);
      const mem = memory.get(nameOf(rel, hash));
      if (mem) { stats.hits++; return mem; }
      let rec = null;
      try { rec = JSON.parse(fs.readFileSync(p, 'utf8')); } catch { rec = null; }
      if (!rec || rec.file !== rel || rec.hash !== hash || rec.pinKey !== pinKey) { stats.misses++; return null; }
      stats.hits++;
      // a hit keeps the entry young for prune(), touched at most once a day so a warm start stays read-only
      if (!ro) try { const t = now(); if (t - fs.statSync(p).mtimeMs > DAY) fs.utimesSync(p, t / 1000, t / 1000); } catch { /* best effort */ }
      return rec;
    },
    /** Whether an entry exists (no parse). */
    has: (rel, hash) => memory.has(nameOf(rel, hash)) || fs.existsSync(pathOf(rel, hash)),
    get readOnly() { return ro; },
    /** Entries held in memory (read-only mode), not yet on disk. */
    get pending() { return memory.size; },
    /** Write every in-memory entry (nothing in read-only mode). -> how many were written. */
    flush() {
      if (ro || !memory.size) return 0;
      ensure();
      let n = 0;
      for (const [name, rec] of memory) {
        try { atomicWrite(path.join(vdir, name.slice(0, 2), name), JSON.stringify(rec)); stats.writes++; n++; } catch { stats.errors++; }
      }
      memory.clear();
      return n;
    },
    /** Leave read-only mode and flush what was computed meanwhile. -> how many entries were written. */
    setWritable() { ro = false; return store.flush(); },
    /**
     * Store what was computed for `rel` at `hash`.
     * @param {string} rel @param {string} hash @param {object} data
     */
    put(rel, hash, data) {
      const rec = { v: STORE_VERSION, file: rel, hash, pinKey, pin, at: now(), ...data };
      if (ro) { memory.set(nameOf(rel, hash), rec); return rec; }
      ensure();
      try { atomicWrite(pathOf(rel, hash), JSON.stringify(rec)); stats.writes++; } catch { stats.errors++; }
      return rec;
    },
    /**
     * Remove entries that match no live (file, hash) under this pin and were not used for `days`, and temp files
     * whose writer is gone.
     * @param {{live?: Map<string, string>|Record<string, string>, days?: number}} [o] `live`: rel -> current content hash.
     * @returns {{removed: number, kept: number, tmp: number}}
     */
    prune({ live = new Map(), days = PRUNE_DAYS } = {}) {
      if (ro) return { removed: 0, kept: 0, tmp: 0 };
      const want = new Set();
      for (const [rel, hash] of live instanceof Map ? live : Object.entries(live)) want.add(nameOf(rel, hash));
      const cutoff = now() - days * DAY;
      let removed = 0; let kept = 0; let tmp = 0;
      let shards = [];
      try { shards = fs.readdirSync(vdir); } catch { return { removed, kept, tmp }; }
      for (const sh of shards) {
        const d = path.join(vdir, sh);
        let names = [];
        try { names = fs.readdirSync(d); } catch { continue; }
        for (const n of names) {
          const p = path.join(d, n);
          const t = TMP.exec(n);
          if (t) {
            if (!alive(Number(t[2]))) { try { fs.rmSync(p, { force: true }); tmp++; } catch { /* raced */ } }
            continue;
          }
          if (!ENTRY.test(n)) continue;
          let mtime = 0;
          try { mtime = fs.statSync(p).mtimeMs; } catch { continue; }
          if (!want.has(n) && mtime < cutoff) { try { fs.rmSync(p, { force: true }); removed++; } catch { /* raced */ } } else kept++;
        }
        try { if (!fs.readdirSync(d).length) fs.rmdirSync(d); } catch { /* not empty, or gone */ }
      }
      return { removed, kept, tmp };
    },
  };
  return store;
}
