// Line primitives as a starting library for new Line projects (createLineProject with `library: "primitives"`): the
// files under library/ read from disk, root-relative, ready to stage through Construct's writer. Read-only.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** The library folder shipped with this package. */
export const LIBRARY_DIR = path.join(HERE, 'library');
/** The npm packages a project needs to build on the primitives (Tailwind is the app's own choice of setup). */
export const PRIMITIVE_DEPENDENCIES = Object.freeze({ 'date-fns': '^4.1.0', 'radix-ui': '^1.4.3', react: '^19.0.0', 'react-dom': '^19.0.0' });

/**
 * Every file of the primitive library, keyed by its path in a Line project (`library/...`).
 * @param {string} [dir] The library folder to read.
 * @returns {Record<string, string>} Project-relative path -> file text, sorted by path.
 */
export function primitiveLibraryFiles(dir = LIBRARY_DIR) {
  /** @type {Record<string, string>} */
  const out = {};
  const visit = (abs, rel) => {
    for (const e of fs.readdirSync(abs, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const childRel = `${rel}/${e.name}`;
      if (e.isDirectory()) visit(path.join(abs, e.name), childRel);
      else if (e.isFile()) out[childRel] = fs.readFileSync(path.join(abs, e.name), 'utf8');
    }
  };
  visit(dir, 'library');
  return out;
}
