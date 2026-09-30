// #385 -- the two small pieces of per-feature Story-tab state that do NOT belong in `story.md` itself:
//   - `reviewed[feature]`: the `summaryDriftHash` (packages/core/story.mjs) the user last dismissed with "Mark
//     reviewed" (design 9.5) -- lets the indicator tell "the same drift as last time" from "something changed"
//     without recomputing the compare.
//   - `kept[feature]`: when "Keep out of git" is on, the story's full text lives HERE instead of the tracked
//     `features/<name>/story.md` (design 9.4/"ia-story-states": "stored in your per-user state folder (with
//     Notes), not in the project. It is not shared with teammates.").
// Same layout convention as `notesStore.mjs` / `storyConsentStore.mjs`: one small JSON file per project, state
// outside the project, keyed by the project's absolute path.
//
// Layout: `<stateDir>/story-ui/<projectKey>.json` -> `{ reviewed: {feature: hash}, kept: {feature: text} }`.
import path from 'node:path';
import fs from 'node:fs';
import { resolveStateDir, projectKey, atomicWriteJson } from './processStore.mjs';

/** Absolute path of the one JSON file holding a project's Story-tab UI state.
 * @param {string} projectRoot Absolute path of the project.
 * @param {{stateDir?: string}} [opts] Override the state directory (defaults to `resolveStateDir()`).
 * @returns {string} The state file's absolute path. */
export function storyUiStateFile(projectRoot, { stateDir = resolveStateDir() } = {}) {
  return path.join(stateDir, 'story-ui', `${projectKey(projectRoot)}.json`);
}

function readState(file) {
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    return { reviewed: raw?.reviewed && typeof raw.reviewed === 'object' ? raw.reviewed : {}, kept: raw?.kept && typeof raw.kept === 'object' ? raw.kept : {} };
  } catch (e) {
    if (e?.code === 'ENOENT') return { reviewed: {}, kept: {} };
    throw e;
  }
}

/** Open the Story-tab UI state store for one project: a small set of functions over the
 * project's one JSON file (reviewed-drift hashes, kept-out-of-git text), backed by
 * `atomicWriteJson` so concurrent callers never corrupt it.
 * @param {string} projectRoot Absolute path of the project.
 * @param {{stateDir?: string}} [opts] Override the state directory (defaults to `resolveStateDir()`).
 * @returns {{getReviewedHash:(feature:string)=>string|null, setReviewedHash:(feature:string,hash:string)=>void, getKept:(feature:string)=>string|null, setKept:(feature:string,text:string|null)=>void, keptFeatures:()=>string[]}} */
export function openStoryUiState(projectRoot, { stateDir = resolveStateDir() } = {}) {
  const file = storyUiStateFile(projectRoot, { stateDir });

  return {
    /** The drift hash last marked reviewed for `feature`, or `null`. */
    getReviewedHash(feature) {
      return readState(file).reviewed[feature] ?? null;
    },
    /** Mark `hash` as reviewed for `feature` ("Mark reviewed", design 9.5). */
    setReviewedHash(feature, hash) {
      const state = readState(file);
      state.reviewed[feature] = hash;
      atomicWriteJson(file, state);
    },
    /** The kept-out-of-git text for `feature`, or `null` if it is tracked normally. */
    getKept(feature) {
      return Object.prototype.hasOwnProperty.call(readState(file).kept, feature) ? readState(file).kept[feature] : null;
    },
    /** Set (or, with `null`, clear) the kept-out-of-git text for `feature`. */
    setKept(feature, text) {
      const state = readState(file);
      if (text === null) delete state.kept[feature];
      else state.kept[feature] = text;
      atomicWriteJson(file, state);
    },
    /** Every feature currently kept out of git, for "No story-dependent UI when no story.md exists" checks. */
    keptFeatures() {
      return Object.keys(readState(file).kept);
    },
  };
}
