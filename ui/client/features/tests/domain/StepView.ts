// Pure (DOMAIN-001): the rows the step document draws, derived from the draft. Removed rows keep their place (struck
// through, with a text note) until the change is saved; numbering and the GIVEN/AND/WHEN/THEN words skip them.
import type { DraftStep, StepFields, StepRowView } from '../types.ts';
import { changeOf } from './StepDraft.ts';
import { canMove } from './StepMoves.ts';
import { bindingOf, CHANGE_LABEL, codeOf } from './StepCode.ts';
import { keywordOf, sentenceOf } from './StepText.ts';

export function stepRows(draft: DraftStep[], original: StepFields[]): StepRowView[] {
  let n = 0;
  let prev: StepFields | null = null;
  return draft.map((d) => {
    const s = d.step;
    const change = changeOf(d, original);
    const view: StepRowView = {
      key: d.key,
      n: d.removed ? null : ++n,
      keyword: keywordOf(s, d.removed ? null : prev),
      sentence: sentenceOf(s, d.removed ? null : prev),
      binding: bindingOf(s),
      code: codeOf(s),
      note: 'note' in s && s.note ? s.note : '',
      change,
      changeLabel: change ? CHANGE_LABEL[change] : '',
      removed: d.removed,
      step: s,
      canEdit: s.kind !== 'fixme',
      canUp: canMove(draft, d.key, -1),
      canDown: canMove(draft, d.key, 1),
    };
    if (!d.removed) prev = s;
    return view;
  });
}
