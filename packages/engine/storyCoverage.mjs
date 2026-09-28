// #388 -- the Tests screen's acceptance-criteria coverage (design 9.5: "Tests may carry `@story S2`, so the Tests
// screen shows acceptance coverage"). Read-only, mechanical, no model: reads `features/<feature>/story.md` (if any)
// with packages/core/story.mjs's parseStory, reads every listed test file's `@story` tags with readStoryTags, and
// runs the existing three-list compareStory. Activation rule (design 9.1): every story-dependent piece of UI --
// including this -- exists only when a story.md exists for the feature; `declared: false` is not an error.
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../core/config.mjs';
import { compareStory, parseStory, readStoryTags } from '../core/story.mjs';
import { readRegular } from './testClone.mjs';

const NONE = { declared: false, acceptance: [], compare: null };

/**
 * The feature's story coverage, plus each coverage row's own referenced `@story` ids (added in place as
 * `row.storyIds`). `generated`/`yours`/`coverage` are the arrays `listFeatureTests` already produced -- this
 * function re-reads the listed files' text (readRegular, the same symlink/size-capped reader everything else here
 * uses) rather than trusting anything the caller passed in as text.
 *
 * @param {string} root Project root.
 * @param {string} feature The feature name (already validated by the caller -- this only ever reads inside it).
 * @param {{ genDir: string, testsDir: string }} at `locate(root, feature)`'s result.
 * @param {{ name: string }[]} generated Listed generated test files.
 * @param {{ name: string }[]} yours Listed "yours" test files.
 * @param {{ id: string, file: string|null, cloned: string[], storyIds?: string[] }[]} coverage The scenario coverage rows (mutated: `storyIds` added).
 * @returns {{ declared: boolean, acceptance: {id:string,text:string}[], compare: {missing:string[],undocumented:string[],matched:string[]}|null }}
 */
export function featureStoryCoverage(root, feature, at, generated, yours, coverage) {
  const featuresRoot = loadConfig(root).features?.root || 'features';
  const storyPath = path.join(root, featuresRoot, feature, 'story.md');
  const storyText = readRegular(storyPath);
  if (storyText === null) {
    for (const row of coverage) row.storyIds = [];
    return NONE;
  }

  const { tool } = parseStory(storyText);
  const acceptance = tool?.acceptance ?? [];

  const tagsByFileName = new Map();
  for (const g of generated) tagsByFileName.set(g.name, readStoryTags(readRegular(path.join(at.genDir, g.name)) ?? ''));
  for (const y of yours) tagsByFileName.set(y.name, readStoryTags(readRegular(path.join(at.testsDir, y.name)) ?? ''));

  const referenced = new Set();
  for (const row of coverage) {
    const own = row.file ? tagsByFileName.get(row.file) ?? [] : [];
    const cloneTags = row.cloned.flatMap((name) => tagsByFileName.get(name) ?? []);
    row.storyIds = [...new Set([...own, ...cloneTags])];
    for (const id of row.storyIds) referenced.add(id);
  }
  for (const y of yours) for (const id of tagsByFileName.get(y.name) ?? []) referenced.add(id);

  const compare = compareStory(acceptance, referenced);
  return { declared: true, acceptance, compare };
}
