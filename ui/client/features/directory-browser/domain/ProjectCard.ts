// Pure (DOMAIN-001): a project as a card on the Open-a-project screen. One friendly status word (Ready for a Line or
// Construct project, Needs setup otherwise) and a framework tag only when it helps (React). Plain words only.
import type { DirEntryView, ProjectCardView } from '../types.ts';

export function toProjectCard(entry: DirEntryView): ProjectCardView {
  const react = entry.badges.some((b) => b.key === 'react');
  return {
    name: entry.name,
    path: entry.path,
    status: entry.isConstructProject ? { tone: 'fit', label: 'Ready' } : { tone: 'wait', label: 'Needs setup' },
    tag: react ? 'React' : null,
  };
}
