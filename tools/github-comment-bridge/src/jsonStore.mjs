import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * A tiny durable JSON file store, used for both the poll cursor/state file
 * and the per-issue { issueNumber: sessionId } session map. Writes are
 * atomic (write to a temp file, then rename) so a crash mid-write can't
 * corrupt the file.
 *
 * @param {string} filePath
 * @param {object} defaultValue
 */
export function createJsonStore(filePath, defaultValue) {
  async function load() {
    try {
      const raw = await readFile(filePath, 'utf8');
      return JSON.parse(raw);
    } catch (err) {
      if (err.code === 'ENOENT') return structuredClone(defaultValue);
      throw err;
    }
  }

  async function save(value) {
    await mkdir(path.dirname(filePath), { recursive: true });
    const tmpPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.tmp-${process.pid}`);
    await writeFile(tmpPath, JSON.stringify(value, null, 2));
    await rename(tmpPath, filePath);
  }

  return { load, save };
}
