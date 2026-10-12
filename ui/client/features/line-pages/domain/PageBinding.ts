// cu5: the chosen page's two bindings as the screen shows them, side by side per part. Pure: no React, no fetch.
import type { BindingFix, BindPartRequest, LinePageBinding, PageInteraction, PlanStepRequest } from '../types';

/** One row of the side-by-side table: the part, its library side (Morpheus) and its data side (Trace). */
export type BindingRow = {
  partId: string;
  tag: string;
  depth: number;
  library: { sentence: string; bound: boolean; libraryId: string | null };
  data: { sentence: string; states: string[]; actions: { id: string; sentence: string; resolution: PageInteraction['resolution']; pill: string }[] };
  /** Library components this part can be bound to (none for a part already bound, or a piece of another part). */
  targets: { id: string; name: string }[];
};

const PILL: Record<PageInteraction['resolution'], string> = { api: 'Calls the API', controller: 'On the page', stub: 'Stub to write', unresolved: 'Needs a home' };

/** The short pill for how an action resolves. */
export function resolutionPill(r: PageInteraction['resolution']): string {
  return PILL[r];
}

/** The parts of the page, depth first, each with both of its bindings. */
export function bindingRows(b: LinePageBinding): BindingRow[] {
  const byId = new Map(b.interactions.map((i) => [i.id, i]));
  return b.parts.map((p) => {
    const bound = p.base.kind === 'library';
    const actions = p.interactions.map((id) => byId.get(id)).filter((i): i is PageInteraction => !!i).map((i) => ({ id: i.id, sentence: i.sentence, resolution: i.resolution, pill: PILL[i.resolution] }));
    return {
      partId: p.id,
      tag: p.tag,
      depth: p.depth,
      library: { sentence: p.base.sentence, bound, libraryId: p.base.libraryId },
      data: { sentence: p.data.sentence, states: p.states.map((s) => s.sentence), actions },
      targets: bound || p.tag.includes('.') || p.tag === 'Fragment' ? [] : b.components,
    };
  });
}

/** How many actions have a home, in words. */
export function coverageSentence(b: LinePageBinding): string {
  const c = b.coverage;
  if (b.via === 'static') return 'Actions are not read while Trace is unavailable.';
  if (!c.total) return 'This page has no actions to bind.';
  const homed = c.total - c.unresolved;
  return `${homed} of ${c.total} action${c.total === 1 ? '' : 's'} ${c.total === 1 ? 'has' : 'have'} a home (${c.api} call${c.api === 1 ? 's' : ''} the API, ${c.controller} on the page, ${c.stub} stub${c.stub === 1 ? '' : 's'} to write).`;
}

/** The plan step a fix adds, carrying the page hash it was read from (a stale page is then refused, not misapplied). */
export function fixStep(fix: BindingFix, contentHash: string): PlanStepRequest {
  return { tool: fix.step.tool, args: { ...fix.step.args, contentHash } };
}

/** The line.bindPart request for one part and one library component. */
export function bindPartRequest(b: LinePageBinding, partId: string, libraryId: string): BindPartRequest {
  return { file: b.file, partId, libraryId, contentHash: b.contentHash };
}
