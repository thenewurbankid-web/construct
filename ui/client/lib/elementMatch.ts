// Two modes, live stage: which element on screen a part (or a chat sentence) refers to, so the stage can outline it.
// Static only (owner, 12 Oct): no model at runtime. The ladder, first unique match wins:
//   1. the exact data-line-* id (data-line-target, or data-item / data-feature the Line screens carry)
//   2. the page tree's node id
//   3. accessible role plus name/text
//   4. the label's text
//   5. the position in the part tree
// When no rung gives exactly one element there is no outline, and one sentence says why.

/** What the ladder knows about an element on screen (read from its data-* attributes, role and text). */
export type ElementDesc = { key: string; lineTarget?: string | null; nodeId?: string | null; role?: string | null; name?: string | null; label?: string | null; position?: string | null };

/** What a part says about itself: any of the same facts. */
export type MatchTarget = { lineTarget?: string | null; nodeId?: string | null; role?: string | null; name?: string | null; label?: string | null; position?: string | null; what: string };

export type MatchRung = 'line-id' | 'node-id' | 'role-name' | 'label' | 'position';
export type ElementMatch = { ok: true; key: string; by: MatchRung } | { ok: false; sentence: string };

const same = (a?: string | null, b?: string | null) => Boolean(a) && Boolean(b) && a!.trim().toLowerCase() === b!.trim().toLowerCase();

const RUNGS: [MatchRung, (t: MatchTarget, e: ElementDesc) => boolean, (t: MatchTarget) => boolean][] = [
  ['line-id', (t, e) => same(t.lineTarget, e.lineTarget), (t) => Boolean(t.lineTarget)],
  ['node-id', (t, e) => Boolean(t.nodeId) && t.nodeId === e.nodeId, (t) => Boolean(t.nodeId)],
  ['role-name', (t, e) => same(t.role, e.role) && same(t.name, e.name), (t) => Boolean(t.role && t.name)],
  ['label', (t, e) => same(t.label ?? t.name, e.label ?? e.name), (t) => Boolean(t.label ?? t.name)],
  ['position', (t, e) => Boolean(t.position) && t.position === e.position, (t) => Boolean(t.position)],
];

/** The one element a target refers to, by the first rung of the ladder that finds exactly one; or why there is none. */
export function matchElement(target: MatchTarget, candidates: ElementDesc[]): ElementMatch {
  let ambiguous = false;
  for (const [by, fits, usable] of RUNGS) {
    if (!usable(target)) continue;
    const hits = candidates.filter((e) => fits(target, e));
    if (hits.length === 1) return { ok: true, key: hits[0].key, by };
    if (hits.length > 1) ambiguous = true;
  }
  return { ok: false, sentence: ambiguous ? `Several things on screen could be ${target.what}, so none is outlined.` : `${target.what} is not on screen, so nothing is outlined.` };
}
