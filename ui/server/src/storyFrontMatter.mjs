// A minimal, targeted reader/writer for ONLY the `sources: [{url, parse}]` front matter shape documented in
// docs/design/ia-five-screens.md section 9.2. This is NOT the story.md engine (tool-owned snapshot block,
// fetchedAt/sourceHash/blockHash, acceptance ids) -- that is #383, unbuilt. This module exists so the Picker
// (#386) can propose selectors as a diff without inventing or blocking on that format: it only ever touches
// the `sources` list, and it round-trips everything else in the file (front matter keys it does not know
// about, their comments and order, and all user text below the closing `---`) byte-for-byte. The split and the
// in-place edit are the shared ones in packages/core/yaml-edit.mjs.
import yaml from 'js-yaml';
import { editFrontMatter, splitFrontMatter, YamlEditError } from '../../../packages/core/yaml-edit.mjs';

/** {frontMatter: object, body: string, hadFrontMatter: boolean} -- frontMatter is {} when the file has none. */
export function readStoryFile(text) {
  const { frontMatter: raw, body } = splitFrontMatter(text);
  if (raw === null) return { frontMatter: {}, body, hadFrontMatter: false };
  let frontMatter;
  try {
    frontMatter = yaml.load(raw) || {};
  } catch (e) {
    throw new StoryFrontMatterError(`story.md front matter is not valid YAML: ${e.message}`);
  }
  if (typeof frontMatter !== 'object' || Array.isArray(frontMatter)) throw new StoryFrontMatterError('story.md front matter must be a mapping.');
  return { frontMatter, body, hadFrontMatter: true };
}

export class StoryFrontMatterError extends Error {}

/** Apply `edits` (a function of the current `sources` list) to the front matter in place, as a diff. */
function editSources(text, edits) {
  const before = text;
  readStoryFile(text); // refuses invalid or non-mapping front matter with the usual StoryFrontMatterError
  let after;
  try {
    after = editFrontMatter(text, (data) => edits(Array.isArray(data?.sources) ? data.sources : null), { label: 'story.md front matter' });
  } catch (e) {
    if (e instanceof YamlEditError) throw new StoryFrontMatterError(e.message);
    throw e;
  }
  return { before, after, changed: before !== after };
}

/** Merges one proposed `{url, parse}` into `sources`: updates the `parse` of an existing entry with the same
 * url, or appends a new entry. Never touches `body` (user text) or any other front-matter key. Returns
 * {before, after, changed} so the caller can show a diff; `after` is the full file text. */
export function mergeStorySource(text, { url, parse }) {
  if (typeof url !== 'string' || !url) throw new StoryFrontMatterError('url is required.');
  if (!parse || typeof parse !== 'object' || Array.isArray(parse)) throw new StoryFrontMatterError('parse must be a mapping of field name to selector.');
  return editSources(text, (sources) => {
    const idx = sources ? sources.findIndex((s) => s && s.url === url) : -1;
    if (idx === -1) return [{ op: 'push', path: ['sources'], value: { url, parse } }];
    return [{ op: 'set', path: ['sources', idx, 'parse'], value: parse }];
  });
}

/** #387 -- the same merge as `mergeStorySource`, but for one AI-extracted "values" result (design 9.6,
 * "extraction on every use") instead of a proposed `parse`. Stored alongside `parse` on the matching `sources`
 * entry as `values`, so a reviewer can see both the selector pattern (if any) and the last verified extraction
 * for the same url. Never touches `body` or any other front-matter key; refuses to merge onto a url with no
 * existing `sources` entry (there is nothing to attach the values to). */
export function mergeStoryValues(text, { url, values }) {
  if (typeof url !== 'string' || !url) throw new StoryFrontMatterError('url is required.');
  if (!values || typeof values !== 'object' || Array.isArray(values)) throw new StoryFrontMatterError('values must be a mapping of field name to value.');
  return editSources(text, (sources) => {
    const idx = sources ? sources.findIndex((s) => s && s.url === url) : -1;
    if (idx === -1) throw new StoryFrontMatterError(`No source entry for "${url}" yet -- propose a pattern or add it first.`);
    return [{ op: 'set', path: ['sources', idx, 'values'], value: values }];
  });
}
