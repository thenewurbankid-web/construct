// Pure (DOMAIN-001): everything the Import screen shows, computed from its state.
import type { FoundRow, ImportAnswers, ImportFound, ImportQuestion, ImportState, ImportViewModel, QuestionView } from '../types.ts';
import { asks, kindWord, scanSummary } from './ImportText.ts';
import { foundGroups, orderedOptions, pickedOption } from './ImportGroups.ts';

/** One found item as a row: the sentence, and its file, base, rules and users for Details. */
export function foundRow(it: ImportFound): FoundRow {
  const base = it.proposal.base ? [`base: ${it.proposal.base}`] : [];
  return {
    file: it.file, name: it.name, kindLabel: kindWord(it.kind), sentence: it.proposal.sentence, asks: asks(it),
    details: [it.file, ...base, `rules: ${it.rules.join(', ')}`, ...it.usedBy.map((u) => `used by ${u}`)],
  };
}

/** A question as shown: options in order, the picked one marked. */
export function questionView(q: ImportQuestion, answers: ImportAnswers): QuestionView {
  const picked = pickedOption(q, answers);
  return { id: q.id, sentence: q.sentence, options: orderedOptions(q).map((o) => ({ id: o.id, sentence: o.sentence, recommended: o.id === q.recommended, picked: o.id === picked })) };
}

/** Everything the Import screen shows, from its state. */
export function importView(state: ImportState): ImportViewModel {
  const busy = state.phase === 'scanning' || state.phase === 'planning' || state.phase === 'applying';
  const scan = state.scan;
  if (!scan) return { busy, summary: null, groups: [], unchanged: [], routes: [], questions: [], canPlan: false };
  return {
    busy,
    summary: scanSummary(scan),
    groups: foundGroups(scan).map((g) => ({ key: g.key, title: g.title, rows: g.items.map(foundRow) })),
    unchanged: scan.unchanged.map((u) => u.sentence),
    routes: scan.routes,
    questions: scan.questions.map((q) => questionView(q, state.answers)),
    canPlan: !state.plan && scan.found.length > 0,
  };
}
