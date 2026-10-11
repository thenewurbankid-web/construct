// Pure (DOMAIN-001): the library's components as cards grouped Atoms / Molecules / Organisms. The level itself
// comes from the server's static rule (packages/engine/line/model.mjs): an @line-level comment wins, else no
// library imports = atom, atoms only = molecule, anything else = organism.
import type { LibraryCard, LibraryGroup, Level, LineProject } from '../types.ts';

const LEVEL_ORDER: Level[] = ['atom', 'molecule', 'organism'];

const GROUP_TEXT: Record<Level, { title: string; hint: string; label: string }> = {
  atom: { title: 'Atoms', hint: 'Built from plain elements only, nothing from the library.', label: 'Atom' },
  molecule: { title: 'Molecules', hint: 'Built from atoms only.', label: 'Molecule' },
  organism: { title: 'Organisms', hint: 'Built from anything in the library.', label: 'Organism' },
};

/** "Used by 1 feature component" / "Used by 3 feature components" / "Not used by any feature yet". */
export function usedByText(count: number): string {
  if (count === 0) return 'Not used by any feature yet';
  return `Used by ${count} feature ${count === 1 ? 'component' : 'components'}`;
}

/** The library's components as cards, grouped by level in Atoms, Molecules, Organisms order; empty groups dropped. */
export function libraryGroups(project: LineProject): LibraryGroup[] {
  const cards: LibraryCard[] = project.library
    .filter((l) => l.kind === 'components')
    .map((l) => {
      const level: Level = l.level ?? 'atom';
      return { id: l.id, name: l.name, level, levelLabel: GROUP_TEXT[level].label, file: l.file, usedByCount: l.usedBy.length, usedByText: usedByText(l.usedBy.length) };
    });
  return LEVEL_ORDER.map((level) => ({
    level,
    title: GROUP_TEXT[level].title,
    hint: GROUP_TEXT[level].hint,
    cards: cards.filter((c) => c.level === level).sort((a, b) => a.name.localeCompare(b.name)),
  })).filter((g) => g.cards.length > 0);
}
