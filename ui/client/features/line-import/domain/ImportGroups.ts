// Pure (DOMAIN-001): the scan's items grouped by where they go, and the questions' options in order.
import type { FoundGroup, ImportAnswers, ImportQuestion, ImportScan } from '../types.ts';

/** The found items grouped: the library first, then each feature by name. */
export function foundGroups(scan: ImportScan): FoundGroup[] {
  const library = scan.found.filter((f) => f.proposal.target === 'library');
  const features = [...new Set(scan.found.filter((f) => f.proposal.target === 'feature').map((f) => f.proposal.feature ?? ''))].sort();
  const groups: FoundGroup[] = [];
  if (library.length) groups.push({ key: 'library', title: 'To the library', items: library });
  for (const name of features) groups.push({ key: `feature:${name}`, title: `To feature ${name}`, items: scan.found.filter((f) => f.proposal.target === 'feature' && f.proposal.feature === name) });
  return groups;
}

/** A question's options with the recommended one first. */
export function orderedOptions(q: ImportQuestion): ImportQuestion['options'] {
  return [...q.options].sort((a, b) => Number(b.id === q.recommended) - Number(a.id === q.recommended));
}

/** The option currently picked for a question: the answer given, else the recommended one. */
export function pickedOption(q: ImportQuestion, answers: ImportAnswers): string {
  return answers[q.id] ?? q.recommended;
}
