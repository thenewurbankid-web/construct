// A minimal, targeted reader/writer for ONLY the `sources: [{url, parse}]` front matter shape documented in
// docs/design/ia-five-screens.md section 9.2. This is NOT the story.md engine (tool-owned snapshot block,
// fetchedAt/sourceHash/blockHash, acceptance ids) -- that is #383, unbuilt. This module exists so the Picker
// (#386) can propose selectors as a diff without inventing or blocking on that format: it only ever touches
// the `sources` list, and it round-trips everything else in the file (front matter keys it does not know
// about, and all user text below the closing `---`) byte-for-byte.
import yaml from 'js-yaml';

const FRONT_MATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

/** {frontMatter: object, body: string, hadFrontMatter: boolean} -- frontMatter is {} when the file has none. */
export function readStoryFile(text) {
  const m = FRONT_MATTER.exec(text);
  if (!m) return { frontMatter: {}, body: text, hadFrontMatter: false };
  let frontMatter;
  try {
    frontMatter = yaml.load(m[1]) || {};
  } catch (e) {
    throw new StoryFrontMatterError(`story.md front matter is not valid YAML: ${e.message}`);
  }
  if (typeof frontMatter !== 'object' || Array.isArray(frontMatter)) throw new StoryFrontMatterError('story.md front matter must be a mapping.');
  return { frontMatter, body: text.slice(m[0].length), hadFrontMatter: true };
}

export class StoryFrontMatterError extends Error {}

/** Merges one proposed `{url, parse}` into `sources`: updates the `parse` of an existing entry with the same
 * url, or appends a new entry. Never touches `body` (user text) or any other front-matter key. Returns
 * {before, after, changed} so the caller can show a diff; `after` is the full file text. */
export function mergeStorySource(text, { url, parse }) {
  if (typeof url !== 'string' || !url) throw new StoryFrontMatterError('url is required.');
  if (!parse || typeof parse !== 'object' || Array.isArray(parse)) throw new StoryFrontMatterError('parse must be a mapping of field name to selector.');
  const before = text;
  const { frontMatter, body } = readStoryFile(text);
  const sources = Array.isArray(frontMatter.sources) ? frontMatter.sources.slice() : [];
  const idx = sources.findIndex((s) => s && s.url === url);
  const nextEntry = { url, parse };
  const nextSources = idx === -1 ? [...sources, nextEntry] : sources.map((s, i) => (i === idx ? { ...s, parse } : s));
  const nextFrontMatter = { ...frontMatter, sources: nextSources };
  const after = `---\n${yaml.dump(nextFrontMatter, { lineWidth: -1 }).trimEnd()}\n---\n${body}`;
  return { before, after, changed: before !== after };
}
