// cs2 -- reviewed fix-ranking rules from the static rule factory (fix-ranking.json): for findings of one rule, a fix of
// family `prefer` ranks above a fix of family `over`. A family is the fix id up to its first ':' ("LINE-LAYOUT/
// stray-to-feature:orders:components" -> "LINE-LAYOUT/stray-to-feature"). Rules are added only by a person through
// `construct line rules apply`, after the accuracy gate passed them; the gate's worker measures a proposal through
// STATIC_OVERLAY. Pure apart from reading the shipped file once.
import fs from 'node:fs';
import { STATIC_OVERLAY } from './staticOverlay.mjs';

const FILE = new URL('./fix-ranking.json', import.meta.url);

/** @typedef {{rule: string, prefer: string, over: string}} FixRankRule */

/**
 * A fix id's family: the id up to its first ':'.
 * @param {string} id
 * @returns {string}
 */
export function fixFamily(id) {
  return String(id).split(':')[0];
}

/**
 * Throws unless every rule names a LINE-* rule and two different fix families of it.
 * @param {any} rules
 * @returns {FixRankRule[]}
 */
export function assertFixRanking(rules) {
  if (!Array.isArray(rules)) throw new TypeError('fix ranking: rules is a list');
  for (const r of rules) {
    if (!r || !/^LINE-[A-Z]+$/.test(r.rule)) throw new TypeError(`fix ranking: "${r?.rule}" is not a Line rule`);
    if (typeof r.prefer !== 'string' || typeof r.over !== 'string' || !r.prefer.startsWith(`${r.rule}/`) || !r.over.startsWith(`${r.rule}/`) || r.prefer === r.over) {
      throw new TypeError(`fix ranking: a ${r.rule} rule prefers one fix family of ${r.rule} over another`);
    }
  }
  return rules;
}

const SHIPPED = assertFixRanking(JSON.parse(fs.readFileSync(FILE, 'utf8')).rules);
/** The rules in force: the shipped ones, then the gate's overlay (worker only). */
export const FIX_RANKING = Object.freeze([...SHIPPED, ...assertFixRanking(STATIC_OVERLAY?.fixRanking ?? [])]);

/**
 * The fixes re-ranked by the rules for `rule`: a preferred family moves just before the first fix of the family it is
 * preferred over, and ranks are renumbered 1..n. Fixes with no step and lists the rules do not touch come back as given.
 * @template {{id: string, rank?: number}} F
 * @param {string} rule The finding's rule.
 * @param {F[]} fixes Ranked, recommended first.
 * @param {readonly FixRankRule[]} [rules]
 * @returns {F[]}
 */
export function rerankFixes(rule, fixes, rules = FIX_RANKING) {
  let list = [...fixes];
  let moved = false;
  for (const r of rules) {
    if (r.rule !== rule) continue;
    const over = list.findIndex((f) => fixFamily(f.id) === r.over);
    const prefer = list.findIndex((f) => fixFamily(f.id) === r.prefer);
    if (over < 0 || prefer < 0 || prefer < over) continue;
    const [p] = list.splice(prefer, 1);
    list.splice(over, 0, p);
    moved = true;
  }
  if (!moved) return fixes;
  list = list.map((f, i) => ({ ...f, rank: i + 1 }));
  return list;
}
