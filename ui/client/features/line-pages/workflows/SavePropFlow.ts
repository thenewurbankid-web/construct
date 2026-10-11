import { coerceValue } from '../domain/PageParts.ts';
import { saveOutcome, setPropRequest } from '../domain/SaveOutcome.ts';
import type { LinePagesApi, PagePart, PartProp, SaveOutcome } from '../types';

/** One Save: the typed value as the prop's kind (a bad number is refused here, nothing sent), then
 * POST /api/line/page-prop, then the sentence to show. Never throws: a silent server is a refusal too. */
export async function savePageProp(api: LinePagesApi, file: string, part: PagePart, prop: PartProp, raw: string | boolean): Promise<SaveOutcome> {
  const value = coerceValue(prop.kind, raw);
  if (value === null) return { ok: false, sentence: `Nothing was saved: "${String(raw)}" is not a number, so type digits only.`, findings: [] };
  try {
    return saveOutcome(await api.setPageProp(setPropRequest(file, part, prop, value)));
  } catch {
    return saveOutcome(null);
  }
}
