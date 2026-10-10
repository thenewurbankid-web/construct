// Re-run when the things a run depends on change: the OpenAPI contract, the designed page, the saved answers.
import fs from "node:fs";
import path from "node:path";
import { CONTRACT_FILES } from "./contract.mjs";

/**
 * Watch one example directory and call `onChange` (debounced) when a file the run depends on changes: the
 * feature spec, the saved answers, the designed page, or the OpenAPI contract.
 *
 * @param {string} dir Example directory.
 * @param {() => void} onChange Called once, after `debounce` ms of quiet, on a relevant change.
 * @param {{debounce?: number}} [options] `debounce` in ms (default 400; editors write in bursts and a save can
 *   briefly leave half-written JSON, so changes are coalesced).
 * @returns {() => void} Stops watching and clears any pending timer.
 */
export function watchExample(dir, onChange, { debounce = 400 } = {}) {
  let page = "page.jsx";
  try { page = JSON.parse(fs.readFileSync(path.join(dir, "feature.json"), "utf8")).page ?? page; } catch {}
  const names = new Set(["feature.json", "answers.json", page, ...CONTRACT_FILES]); // the contract is the openapi file
  let timer;
  const w = fs.watch(dir, (_event, file) => {
    if (file && !names.has(String(file))) return;
    clearTimeout(timer);
    timer = setTimeout(onChange, debounce); // editors write in bursts (and a save can be half-written JSON)
  });
  return () => { clearTimeout(timer); w.close(); };
}
