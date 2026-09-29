// #551 -- the "Mechanical" half of a quick fix: a deterministic transform for a
// handful of rules, run against in-memory source (never touches disk) and
// returned as fixed text for the caller to diff before it lands. Only a
// small, safe subset of rules are covered today (banned-layer imports) --
// every other rule has no callable fix yet, so `applyMechanicalFix` returns
// `null` and the caller falls back to the "AI" option.
import { parseToAst } from '../ast/parse.mjs';

// Same regexes architecture-enforcer.mjs's detectLayerViolations uses to
// flag these rules in the first place (PAGE-002/003/005, COMPONENT-002/003)
// -- kept in lockstep with that source of truth rather than re-derived, so a
// violation this module claims to fix is exactly the one that was flagged.
const BANNED_IMPORT_RULES = {
  'PAGE-002': /workflows?\//,
  'PAGE-003': /services?\//,
  'PAGE-005': /domain\//,
  'COMPONENT-002': /controllers?\//,
  'COMPONENT-003': /(?:workflows?|services?|domain)\//,
};

/** Is a mechanical fix known for this rule id?
 * @param {string} rule - a rule id (e.g. `'PAGE-002'`).
 * @returns {boolean} `true` when `applyMechanicalFix` has a callable transform for this rule.
 */
export function mechanicalFixAvailable(rule) {
  return Object.prototype.hasOwnProperty.call(BANNED_IMPORT_RULES, rule);
}

/** Removes the first top-level import statement whose specifier matches the
 * rule's banned-layer pattern, plus the line it sat on. Returns `null` if
 * the rule has no known fix, or the rule's pattern matches nothing in
 * `source` (already fixed, or the violation moved).
 * @param {string} rule - a rule id (e.g. `'PAGE-002'`).
 * @param {string} source - the file's current, in-memory source text.
 * @returns {string|null} the fixed source text, or `null` if there was nothing this function could fix.
 */
export function applyMechanicalFix(rule, source) {
  const pattern = BANNED_IMPORT_RULES[rule];
  if (!pattern) return null;
  const ast = parseToAst(source);
  const hit = ast.body.find((node) => node.type === 'ImportDeclaration' && pattern.test(node.source.value));
  if (!hit) return null;
  const [start] = hit.range;
  let [, end] = hit.range;
  // Swallow the trailing newline too, so removing the import doesn't leave a blank line.
  if (source[end] === '\n') end += 1;
  else if (source[end] === '\r' && source[end + 1] === '\n') end += 2;
  return source.slice(0, start) + source.slice(end);
}
