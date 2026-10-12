// cs2 -- the rule factory's overlay seam (LINE_STATIC_OVERLAY, the gate's worker only).

// cs2 -- the static rule factory's overlay seam. The accuracy gate (packages/rule-factory/gate.mjs) measures a proposed
// static rule exactly as it would ship, without writing a rule file: it starts a worker process with LINE_STATIC_OVERLAY
// naming a JSON file {lexicon?, fixRanking?}, and the shipped rules load with the overlay merged on top (lexicon.mjs,
// fixRanking.mjs). Outside that worker the variable is unset and this is null. A named file that cannot be read stops
// the process with one sentence: a gate that silently measured the shipped rules would report a wrong number.
import fs from 'node:fs';

/**
 * @typedef {{lexicon?: {entries?: {word: string, synonyms: string[], role: string, object: string}[], everyday?: {grammar?: string[], verbs?: Record<string, string[]>, handlers?: Record<string, string[]>, phrases?: {say: string[], means: string}[]}}, fixRanking?: {rule: string, prefer: string, over: string}[]}} StaticOverlay
 */

/**
 * The overlay the environment names, or null.
 * @param {Record<string, string|undefined>} [env]
 * @returns {StaticOverlay|null}
 */
export function readStaticOverlay(env = process.env) {
  const file = env.LINE_STATIC_OVERLAY;
  if (!file) return null;
  try {
    const o = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!o || typeof o !== 'object' || Array.isArray(o)) throw new TypeError('it is not a JSON object');
    return o;
  } catch (e) {
    throw new Error(`The static overlay ${file} could not be read (${String(/** @type {any} */ (e)?.message ?? e).split('\n')[0]}), so the rules it proposes cannot be measured.`);
  }
}

/** The overlay of this process (null outside the gate's worker). */
export const STATIC_OVERLAY = readStaticOverlay();
