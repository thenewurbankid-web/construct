// #950 -- outside edits into the live Line LSP index: Node's own fs.watch (recursive; FSEvents on macOS, inotify on
// Linux), debounced, so an editor save or a `git checkout` re-indexes only the files whose content hash changed.
// Build and vendor folders and the index itself (line/.index) are ignored. No chokidar: fs.watch's recursive mode is
// reliable on macOS and Linux (Node >= 20); events only name a path, and update() decides by content hash whether
// anything really changed, so a duplicate or spurious event costs one hash.
//
//   const w = watchProject(root, (files) => lsp.update(files), { debounceMs: 150 })
//   w.close()
import fs from 'node:fs';
import path from 'node:path';

export const DEBOUNCE_MS = 150;
const SKIP = /(^|\/)(node_modules|\.git|\.next|dist|build|coverage|\.out)(\/|$)|^line\/\.index(\/|$)/;
const CODE = /\.(ts|tsx|js|jsx|mjs|cts|mts|cjs)$/;

/**
 * Watch a project for outside edits to code files.
 * @param {string} root Project root.
 * @param {(files: string[]) => unknown} onChange Called with root-relative files after a quiet `debounceMs`.
 * @param {{debounceMs?: number}} [o]
 * @returns {{close: () => void, ok: boolean, reason?: string}}
 */
export function watchProject(root, onChange, { debounceMs = DEBOUNCE_MS } = {}) {
  const r = path.resolve(root);
  const pending = new Set();
  let timer = null;
  let watcher = null;
  const flush = () => {
    timer = null;
    const files = [...pending];
    pending.clear();
    if (files.length) Promise.resolve().then(() => onChange(files)).catch(() => { /* the index reports its own failures */ });
  };
  try {
    watcher = fs.watch(r, { recursive: true, persistent: false }, (_event, name) => {
      if (!name) return;
      const rel = String(name).split(path.sep).join('/');
      if (SKIP.test(rel) || !CODE.test(rel) || /\.d\.ts$/.test(rel)) return;
      pending.add(rel);
      if (timer) clearTimeout(timer);
      timer = setTimeout(flush, debounceMs);
      timer.unref?.();
    });
    watcher.on('error', () => { /* a removed root: stop quietly */ try { watcher?.close(); } catch { /* closed */ } });
  } catch (e) {
    return { ok: false, reason: String(/** @type {any} */ (e)?.message ?? e).split('\n')[0], close: () => {} };
  }
  return { ok: true, close: () => { if (timer) clearTimeout(timer); try { watcher?.close(); } catch { /* closed */ } } };
}
