// Pure (DOMAIN-001): what "Save as note" stores. The card is kept as plain text a person can read and edit in the Notes screen
// (the sentence, then the read-back the server produced), with the plan beside it, so a note carries what was understood
// and what would be created.
import type { ReadResult } from './RequirementTypes.ts';

const TITLE_CHARS = 60;

export type NoteDraftBody = { title: string; body: string; plan: unknown };

export function noteDraftOf(text: string, result: ReadResult): NoteDraftBody {
  const flat = text.replace(/\s+/g, ' ').trim();
  const title = flat.length > TITLE_CHARS ? `${flat.slice(0, TITLE_CHARS - 3)}...` : flat;
  const sections = [flat, result.summary.readBack.join('\n'), result.summary.blocks.length ? `Placement:\n${result.summary.blocks.join('\n')}` : ''];
  return { title, body: sections.filter(Boolean).join('\n\n'), plan: result.plan };
}
