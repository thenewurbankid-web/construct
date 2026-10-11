// cd1: part of the Features chat (static rules over the read routes' answers, no model). Tested by FeatureChat.spec.mjs.
import type { ChatMessage, LineFeatureDetail, LineFinding } from '../types';

/** A finding Construct can fix: it has a key and at least one typed fix with a plan step. */
export const fixable = (f: LineFinding) => (f.fixes ?? []).some((x) => x.step !== null) && Boolean(f.key);

/** "Fix what is wrong": the typed fixes Construct offers, recommended first. Item id: "<findingKey>::<fixId>". */
export function fixPick(detail: LineFeatureDetail, id: string): ChatMessage {
  const items = detail.findings.filter(fixable).flatMap((f) =>
    (f.fixes ?? []).filter((x) => x.step !== null).map((x) => ({ id: `${f.key}::${x.id}`, name: x.rank === 1 ? 'Recommended fix' : 'Another fix', text: x.sentence })),
  );
  if (!items.length) return { id, from: 'line', text: 'Nothing here has a fix Construct can apply.' };
  return { id, from: 'line', text: 'Pick a fix. It becomes a plan step, and nothing changes until you approve it in the Plan below.', pick: { label: 'Fixes', items } };
}

/** The plan step a picked fix adds (line.fix re-derives the finding by key on the server). */
export function fixStep(itemId: string): { tool: string; args: { findingKey: string; fixId: string } } {
  const [findingKey = '', fixId = ''] = itemId.split('::');
  return { tool: 'line.fix', args: { findingKey, fixId } };
}
