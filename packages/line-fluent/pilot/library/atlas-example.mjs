// The true example for a reference entry, from the JS Reference Atlas: the reference function that uses the member
// (line-codemod bench/atoms/js-reference/input/ref-*.mjs, via map.json) and what Node really returned for it
// (expected.json). The user stage gives it to the person's side so its answers carry real facts, not guesses.
import { readFileSync } from 'node:fs';

const DIR = new URL('../../../line-codemod/bench/atoms/js-reference/', import.meta.url);
let map = null;
let results = null;
const files = new Map();
function load() {
  if (map) return;
  try {
    map = JSON.parse(readFileSync(new URL('map.json', DIR), 'utf8')).map ?? {};
    results = JSON.parse(readFileSync(new URL('expected.json', DIR), 'utf8')).results ?? {};
  } catch { map = {}; results = {}; }
}

/** {code, result} for an entry key, or null when the Atlas has no example for it. */
export function exampleFor(key) {
  load();
  const at = map[key];
  if (!at) return null;
  let text = files.get(at.file);
  if (text === undefined) {
    try { text = readFileSync(new URL(`input/${at.file}`, DIR), 'utf8'); } catch { text = ''; }
    files.set(at.file, text);
  }
  const start = text.indexOf(`function ${at.fn}(`);
  if (start < 0) return null;
  const end = text.indexOf('\n}', start);
  const code = text.slice(start, end < 0 ? undefined : end + 2);
  const r = results[key];
  const result = !r ? 'unknown' : 'ok' in r ? `returns ${JSON.stringify(r.ok)}` : `throws ${JSON.stringify(r.throws ?? r)}`;
  return { code, result };
}
