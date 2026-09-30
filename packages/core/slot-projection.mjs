// LIN-174 -- projecting a business-logic slot's body (stored in the map by unit-map.mjs's
// setMemberSlot/getMemberSlot, per the owner's "SLOT STORAGE -- DECIDED" note) into the generated
// file that hosts it. This module is intentionally one-directional: map -> file text only. It
// never reads a generated file's marked region back INTO the map -- that is precisely what makes
// "regeneration is total" safe (LIN-153's acceptance bullet): since the file has no logic the map
// doesn't already have, overwriting the marked region can never destroy hand-written work. A
// developer who wants to keep an edit made directly in the file must copy it into the map
// (setMemberSlot) themselves; construct validate's SLOT-001 check (architecture-enforcer.mjs)
// exists to catch exactly the case where they forgot to.
//
// Deliberately NOT a marker-comment splice mechanism in the sense the issue closes off: a splice
// mechanism parses the file to recover hand-written content and re-insert it elsewhere. This module
// never parses the file for content -- the markers are a pure write target, not a read source.

const MARKER_PREFIX = '@construct:slot';

const PLACEHOLDER_BODY =
  '// TODO: implement this slot (write it into the map via setMemberSlot, then regenerate)';

/**
 * The begin/end marker comment lines for one member's slot region. Keyed by the member's own
 * opaque id (already stable per LIN-155 item 6), so no second id is needed for the region itself.
 *
 * @param {string} memberId
 * @returns {{begin: string, end: string}}
 */
export function slotMarkerLines(memberId) {
  return {
    begin: `// ${MARKER_PREFIX}:${memberId}:begin`,
    end: `// ${MARKER_PREFIX}:${memberId}:end`,
  };
}

/**
 * The exact text a member's slot region should read as, markers included -- both the projection
 * step (below) and the drift check (architecture-enforcer.mjs's SLOT-001) build this same string
 * so they can never disagree about what "in sync" means.
 *
 * @param {string} memberId
 * @param {string} [body] The slot's stored source text; a placeholder TODO when empty/unset.
 * @returns {string}
 */
export function renderSlotRegion(memberId, body) {
  const { begin, end } = slotMarkerLines(memberId);
  const content = body && body.length ? body : PLACEHOLDER_BODY;
  return `${begin}\n${content}\n${end}`;
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function slotRegionPattern(memberId) {
  const { begin, end } = slotMarkerLines(memberId);
  return new RegExp(`${escapeRegExp(begin)}[\\s\\S]*?${escapeRegExp(end)}`, 'm');
}

/**
 * Rewrite (or, if absent, append) one member's marked slot region in a file's source text to match
 * the given body -- total regeneration for that region, never a partial/conditional patch. Pure
 * string transform; the caller (unit-map.mjs's projectUnitSlots) owns reading/writing the file.
 *
 * @param {string} source Full source text of the generated file.
 * @param {string} memberId The slot's member id.
 * @param {string} [body] The slot's stored source text.
 * @returns {string} Updated source text.
 */
export function projectSlotIntoSource(source, memberId, body) {
  const region = renderSlotRegion(memberId, body);
  const pattern = slotRegionPattern(memberId);
  if (pattern.test(source)) return source.replace(pattern, region);
  const sep = source.length === 0 || source.endsWith('\n') ? '' : '\n';
  return `${source}${sep}\n${region}\n`;
}

/**
 * Whether `source` already contains exactly the region `renderSlotRegion(memberId, body)` would
 * produce -- the drift check's single source of truth, shared with the projector above so "does
 * this file match the map" always means the same thing "the projector would write this" means.
 *
 * @param {string} source
 * @param {string} memberId
 * @param {string} [body]
 * @returns {boolean}
 */
export function slotRegionMatches(source, memberId, body) {
  return source.includes(renderSlotRegion(memberId, body));
}

// SLOT-002's detector: a slot body may only import types (LIN-153's "types only, no exceptions"
// rule) -- every value a slot uses must arrive as a typed parameter from the generated wiring
// instead. Regex-based on purpose (a slot body is a snippet, not a standalone parseable module in
// every case), matching single-line `import ... from '...'` statements only; deliberately
// conservative when unsure (an import this can't confidently classify as type-only is treated as a
// value import, since erring toward flagging some safe code is far cheaper than a slot silently
// carrying a real dependency invisible to the map's edges).
const IMPORT_STATEMENT_RE = /^[ \t]*import\s+([^;]+?)\s+from\s+['"]([^'"]+)['"];?[ \t]*$/gm;

/**
 * Every value (non-type-only) import statement in a slot body, each naming what was imported and
 * from where -- the input to SLOT-002's violation message ("declare a dependsOn edge instead").
 *
 * @param {string} body Slot source text.
 * @returns {{specifier: string, source: string}[]}
 */
export function findValueImportsInSlot(body) {
  if (!body) return [];
  const hits = [];
  let match;
  IMPORT_STATEMENT_RE.lastIndex = 0;
  while ((match = IMPORT_STATEMENT_RE.exec(body))) {
    const clause = match[1].trim();
    const source = match[2];
    if (/^type\b/.test(clause)) continue; // `import type X from '...'` / `import type { ... } from '...'`
    if (clause.startsWith('{')) {
      const inner = clause.slice(1, clause.lastIndexOf('}'));
      const specifiers = inner.split(',').map((s) => s.trim()).filter(Boolean);
      const valueSpecifiers = specifiers.filter((s) => !/^type\b/.test(s));
      if (valueSpecifiers.length) hits.push({ specifier: valueSpecifiers.join(', '), source });
      continue;
    }
    // Default import, namespace import (`* as x`), or a default+named combo -- none of these can
    // be type-only without the `import type` form already handled above.
    hits.push({ specifier: clause, source });
  }
  return hits;
}
