// #387 (design docs/design/ia-five-screens.md 9.6, "Preferred: AI proposes the parse pattern once") -- turns a
// proposed `{url, parse}` (from a model call over `storySkeleton.mjs`'s skeleton or `storyStrippedText.mjs`'s
// stripped text) into a reviewable diff of `story.md`'s front matter, and NOTHING ELSE: user text and the
// tool-owned snapshot block are untouched. Once approved and saved, `StoryApi.fetch` (storyFetchService.mjs, #384)
// picks up the new `sources[].parse` and every later fetch runs mode a (0 model calls) -- this module is exactly
// the one-time seam between "the model proposed selectors" and "refreshes are mechanical from here on".
//
// Every selector is validated the SAME way a hand-written or picker-proposed selector is (storySelectors.mjs,
// #384/9.6b) before anything is merged: an invalid selector refuses the WHOLE proposal (nothing written), so a
// model can never smuggle an unsafe selector past validation just because it arrived from an AI call instead of a
// human. The front-matter merge itself intentionally mirrors `ui/server/src/storyFrontMatter.mjs`'s
// `mergeStorySource` (small, deterministic, cheaper to keep in sync by eye than to couple the engine to a UI
// package for, same precedent `storyBridgeApi.mjs` states for its own selector-validation duplication).
import yaml from 'js-yaml';
import { validateParseSpec, SelectorError } from './storySelectors.mjs';

/** A model-proposed `{url, parse}` pattern was refused: an invalid selector, or a malformed proposal shape. */
export class PatternProposalError extends Error {
  /**
   * @param {string} code - a short machine-readable reason.
   * @param {string} message - a human-readable description of the failure.
   */
  constructor(code, message) {
    super(message);
    this.name = 'PatternProposalError';
    this.code = code;
  }
}

const FRONT_MATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

function readFrontMatter(text) {
  const m = FRONT_MATTER.exec(text ?? '');
  if (!m) return { frontMatter: {}, body: text ?? '' };
  let frontMatter;
  try {
    frontMatter = yaml.load(m[1]) || {};
  } catch (e) {
    throw new PatternProposalError('BAD_FRONT_MATTER', `story.md front matter is not valid YAML: ${e.message}`);
  }
  if (typeof frontMatter !== 'object' || Array.isArray(frontMatter)) {
    throw new PatternProposalError('BAD_FRONT_MATTER', 'story.md front matter must be a mapping.');
  }
  return { frontMatter, body: text.slice(m[0].length) };
}

/**
 * Validate a proposed `parse` map, then produce the diff of merging `{url, parse}` into `existingText`'s
 * `sources` list: updates the `parse` of an existing entry with the same `url`, or appends a new entry. Never
 * touches the tool-owned block or user text below the front matter -- refuses (throws, nothing computed) rather
 * than merge a proposal with even one invalid selector.
 *
 * @param {string} existingText The story.md file's current full text (`''` for a brand-new file).
 * @param {{ url?: string, parse?: Record<string, unknown> }} [proposal] What the model proposed; missing/invalid
 *   fields throw rather than default silently (`url` is required at runtime).
 * @returns {{ before: string, after: string, changed: boolean, selectors: Record<string, {kind:'css'|'xpath', value:string}> }}
 * @throws {PatternProposalError} An invalid `url`, an invalid `parse` shape, or any selector that fails
 *   `storySelectors.validateParseSpec` (design 9.6b): length cap, safe syntax, no banned construct.
 *
 * @example
 * proposePattern('---\nsources: []\n---\n', { url: 'https://x/y', parse: { title: 'h1' } }).changed; // => true
 */
export function proposePattern(existingText, { url, parse } = {}) {
  if (typeof url !== 'string' || url === '') throw new PatternProposalError('BAD_URL', 'A url is required.');
  let selectors;
  try {
    selectors = validateParseSpec(parse);
  } catch (e) {
    if (e instanceof SelectorError) throw new PatternProposalError(e.code, e.message);
    throw e;
  }
  if (Object.keys(selectors).length === 0) throw new PatternProposalError('EMPTY_PROPOSAL', 'The proposal has no fields.');

  const before = existingText ?? '';
  const { frontMatter, body } = readFrontMatter(before);
  const sources = Array.isArray(frontMatter.sources) ? frontMatter.sources.slice() : [];
  const idx = sources.findIndex((s) => s && s.url === url);
  const nextEntry = { url, parse };
  const nextSources = idx === -1 ? [...sources, nextEntry] : sources.map((s, i) => (i === idx ? { ...s, parse } : s));
  const nextFrontMatter = { ...frontMatter, sources: nextSources };
  const after = `---\n${yaml.dump(nextFrontMatter, { lineWidth: -1 }).trimEnd()}\n---\n${body}`;
  return { before, after, changed: before !== after, selectors };
}
