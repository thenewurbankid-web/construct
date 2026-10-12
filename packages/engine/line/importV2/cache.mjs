// Line Import v2: a content-addressed cache under Line's state folder, so a second start of the same import (or a
// re-check after a step) does not redo work whose inputs did not change.
//
//   contentKey(...parts)                 a stable hash of the parts (file contents, options, a version tag)
//   createStateCache(root, name)         {get(key), set(key, value)} over <root>/line/cache/<name>/<key>.json
//
// Every write goes through Construct's writer (transactionalWriter.mjs writeLineState: Line's own state, atomic, never
// outside the state folder). A missing, unreadable or corrupt entry is a miss, never an error: the work is redone.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { writeLineState } from '../../transactionalWriter.mjs';

/** The cache folder under Line's state folder. */
export const CACHE_DIR = 'line/cache';

/**
 * A stable hash of the parts, in order.
 * @param {...unknown} parts Strings are hashed as they are; anything else as its JSON.
 * @returns {string} 32 hex characters.
 */
export function contentKey(...parts) {
  const h = crypto.createHash('sha256');
  for (const p of parts) { h.update(typeof p === 'string' ? p : JSON.stringify(p) ?? 'undefined'); h.update('\u0000'); }
  return h.digest('hex').slice(0, 32);
}

/**
 * A JSON cache of one kind of work under `<root>/line/cache/<name>/`.
 * @param {string} root The folder Line's state lives in (the import folder).
 * @param {string} name Such as `logic-units` or `characterize`.
 * @returns {{get: (key: string) => any, set: (key: string, value: unknown) => void, name: string}}
 */
export function createStateCache(root, name) {
  if (!/^[a-z][a-z0-9-]*$/.test(name)) throw new Error(`"${name}" is not a cache name; use lower-case words joined by -.`);
  const rel = (key) => {
    if (!/^[0-9a-f]{8,64}$/.test(key)) throw new Error(`"${key}" is not a cache key; make one with contentKey.`);
    return `${CACHE_DIR}/${name}/${key}.json`;
  };
  return {
    name,
    get(key) {
      try { return JSON.parse(fs.readFileSync(path.join(root, rel(key)), 'utf8')); } catch { return undefined; }
    },
    set(key, value) {
      try { writeLineState(root, rel(key), `${JSON.stringify(value)}\n`); } catch { /* a cache that cannot be written only costs time */ }
    },
  };
}
