import type { ApplyResult, CodeFragment, LineRefusal, PagePart, PartProp, SaveOutcome, SetFragmentRequest, SetPropRequest } from '../types';

/** The request POST /api/line/page-prop takes for one prop change. */
export function setPropRequest(file: string, part: PagePart, prop: PartProp, value: string | number | boolean): SetPropRequest {
  return { file, nodeId: part.nodeId, prop: prop.name, kind: prop.kind, value };
}

const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/** What the screen says after a Save: the ApplyResult sentence when it landed, "Nothing was saved: ..." otherwise. */
export function saveOutcome(res: ApplyResult | LineRefusal | null | undefined): SaveOutcome {
  if (!res || typeof res.sentence !== 'string' || !res.sentence) {
    return { ok: false, sentence: 'Nothing was saved: the server did not answer, so try again.', findings: [] };
  }
  const findings = 'findings' in res && Array.isArray(res.findings) ? res.findings : [];
  if (res.ok) return { ok: true, sentence: res.sentence, findings };
  const sentence = /^Nothing was saved\b/.test(res.sentence) || /nothing was saved\.$/.test(res.sentence) ? res.sentence : `Nothing was saved: ${lowerFirst(res.sentence)}`;
  const detail = 'detail' in res && typeof res.detail === 'string' && res.detail ? res.detail : undefined;
  return detail ? { ok: false, sentence, findings, detail } : { ok: false, sentence, findings };
}

/** The request POST /api/line/fragment takes: the fragment's id and the hash of the file it was read from. */
export function setFragmentRequest(fragment: CodeFragment, code: string): SetFragmentRequest {
  return { file: fragment.file, fragmentId: fragment.id, code, contentHash: fragment.contentHash };
}
