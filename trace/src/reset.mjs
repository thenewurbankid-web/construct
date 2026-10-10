// Put an example back to a clean start.
//   state   answers.json, decisions.json, ai-cache.json and answers.history.jsonl are deleted (saved answers, AI provenance, AI cache and the inspector's undo history)
//   inputs  feature.json, the openapi contract, the page, story.md and ui.md are restored from <example>/.original/ if it exists;
//           an openapi file that was uploaded later (and is not in .original/) is removed, so an example that started with no contract has none again
// Generated code (demo-app/src/features/<feature>) is left alone.
import fs from "node:fs";
import path from "node:path";
import { CONTRACT_FILES } from "./contract.mjs";

export const STATE_FILES = ["answers.json", "decisions.json", "ai-cache.json", "answers.history.jsonl"];
const INPUTS = ["feature.json", ...CONTRACT_FILES, "story.md", "ui.md", "viewmodel.json"];

/**
 * Put an example back to a clean start. State files (saved answers, AI provenance/cache, undo history) are
 * deleted; the inputs (`feature.json`, the contract, the page, `story.md`, `ui.md`, `viewmodel.json`) are
 * restored from `<example>/.original/` when it exists, and an openapi file uploaded later (not in `.original/`)
 * is removed so an example that started with none has none again. Generated code
 * (`demo-app/src/features/<feature>`) is left alone.
 *
 * @param {string} dir The example's directory.
 * @returns {{removed: string[], restored: string[], hasOriginal: boolean}} The files removed, the files
 *   restored (only ones that actually differed), and whether a `.original/` snapshot exists.
 */
export function resetExample(dir) {
  const removed = [], restored = [];
  for (const f of STATE_FILES) {
    const p = path.join(dir, f);
    if (fs.existsSync(p)) { fs.unlinkSync(p); removed.push(f); }
  }
  const orig = path.join(dir, ".original");
  if (fs.existsSync(orig)) {
    const kept = new Set(fs.readdirSync(orig));
    for (const f of CONTRACT_FILES) {
      if (!kept.has(f) && fs.existsSync(path.join(dir, f))) { fs.unlinkSync(path.join(dir, f)); removed.push(f); }
    }
    for (const f of fs.readdirSync(orig)) {
      const from = path.join(orig, f), to = path.join(dir, f);
      if (!fs.existsSync(to) || fs.readFileSync(from, "utf8") !== fs.readFileSync(to, "utf8")) { fs.copyFileSync(from, to); restored.push(f); }
    }
  }
  return { removed, restored, hasOriginal: fs.existsSync(orig) };
}

// Keep a pristine copy of the inputs so a later reset can restore them. Never overwrites an existing copy.
/**
 * Snapshot an example's current inputs into `.original/`, so a later {@link resetExample} can restore them.
 *
 * @param {string} dir The example's directory.
 * @returns {boolean} `true` when a snapshot was taken; `false` when `.original/` already exists (never
 *   overwritten).
 */
export function snapshotExample(dir) {
  const orig = path.join(dir, ".original");
  if (fs.existsSync(orig)) return false;
  let page = "page.jsx";
  try { page = JSON.parse(fs.readFileSync(path.join(dir, "feature.json"), "utf8")).page ?? page; } catch {}
  fs.mkdirSync(orig);
  for (const f of [...INPUTS, page]) if (fs.existsSync(path.join(dir, f))) fs.copyFileSync(path.join(dir, f), path.join(orig, f));
  return true;
}
