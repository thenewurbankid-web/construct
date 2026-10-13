// The 4 logic tasks for K1/K2/K5 (#942), from bench/lending/SPEC.md (never acceptance/). Each has the Trace stub
// (signature locked, placeholder body), a hand-written correct solution, 2 mutants and a hand-written test plan in
// Smith's templates (atomic-codemod to-english: "return X", "let N be X", "if C: S", "X's p", "subject verb args").
// The plan was written from the templates before Smith was run on the solutions. Each task's check() is the
// deterministic unit check (run on transpiled JS).
import { placeholderBody } from '../../../../packages/engine/line/path/stubs.mjs';

const stub = (sig, name) => `${sig} ${placeholderBody(name)}\n`;

export const TASKS = Object.freeze([
  {
    id: 'availability',
    spec: 'A book is "On loan" when the fixture says so or when it is part of one of the member\'s loans; otherwise it is "Available". (SPEC.md, intro; BRW-1, BK-3)',
    functions: ['formatAvailability'],
    stub: stub('export function formatAvailability(available: boolean): string', 'formatAvailability'),
    reference: `export function formatAvailability(available: boolean): string {
  if (available) {
    return 'Available';
  }
  return 'On loan';
}
`,
    mutants: [
      `export function formatAvailability(available: boolean): string {
  if (available) {
    return 'On loan';
  }
  return 'Available';
}
`,
      `export function formatAvailability(available: boolean): string {
  if (!available) {
    return 'Available';
  }
  return 'On loan';
}
`,
    ],
    plan: { formatAvailability: ["if available: return 'Available'", "return 'On loan'"] },
    check: (m) => m.formatAvailability(true) === 'Available' && m.formatAvailability(false) === 'On loan',
  },
  {
    id: 'picks-store',
    spec: 'PCK-2: each picked book has a button "Remove <title>" that takes it off the list. PCK-3: a member can pick at most 4 books; with 4 picked, adding another leaves the picks as they were. BK-3: a book already picked cannot be picked again. The picks are a list of book ids.',
    functions: ['addPick', 'removePick', 'listPicks'],
    stub: [
      stub('export function addPick(picks: string[], id: string): string[]', 'addPick'),
      stub('export function removePick(picks: string[], id: string): string[]', 'removePick'),
      stub('export function listPicks(picks: string[]): string[]', 'listPicks'),
    ].join('\n'),
    reference: `export function addPick(picks: string[], id: string): string[] {
  if (picks.includes(id)) {
    return picks;
  }
  if (picks.length >= 4) {
    return picks;
  }
  return picks.concat(id);
}

export function removePick(picks: string[], id: string): string[] {
  return picks.filter((pick) => pick !== id);
}

export function listPicks(picks: string[]): string[] {
  return picks.slice();
}
`,
    mutants: [
      `export function addPick(picks: string[], id: string): string[] {
  if (picks.includes(id)) {
    return picks;
  }
  return picks.concat(id);
}

export function removePick(picks: string[], id: string): string[] {
  return picks.filter((pick) => pick !== id);
}

export function listPicks(picks: string[]): string[] {
  return picks.slice();
}
`,
      `export function addPick(picks: string[], id: string): string[] {
  if (picks.includes(id)) {
    return picks;
  }
  if (picks.length >= 4) {
    return picks;
  }
  return picks.concat(id);
}

export function removePick(picks: string[], id: string): string[] {
  return picks.filter((pick) => pick === id);
}

export function listPicks(picks: string[]): string[] {
  return picks.slice();
}
`,
    ],
    plan: {
      addPick: ['if picks includes id: return picks', "if picks's length >= 4: return picks", 'return picks concat id'],
      removePick: ['return picks filter pick !== id'],
      listPicks: ['return picks slice'],
    },
    check: (m) => {
      const a = m.addPick(m.addPick([], 'x'), 'x');
      const four = ['a', 'b', 'c', 'd'];
      return a.length === 1 && m.addPick(four, 'e').length === 4 && m.removePick(['a', 'b'], 'a').join() === 'b' && m.listPicks(['a']).join() === 'a';
    },
  },
  {
    id: 'paging',
    spec: 'BRW-1: the catalogue shows the books six at a time. BRW-2: a line like "Page 1 of 3" and Previous/Next buttons move through the pages. Pages are numbered from 0 in code.',
    functions: ['pageOf', 'pageCount'],
    stub: [
      stub('export function pageOf<T>(items: T[], page: number): T[]', 'pageOf'),
      stub('export function pageCount(total: number): number', 'pageCount'),
    ].join('\n'),
    reference: `export function pageOf<T>(items: T[], page: number): T[] {
  const start = page * 6;
  return items.slice(start, start + 6);
}

export function pageCount(total: number): number {
  return Math.ceil(total / 6);
}
`,
    mutants: [
      `export function pageOf<T>(items: T[], page: number): T[] {
  const start = page * 6;
  return items.slice(start, 6);
}

export function pageCount(total: number): number {
  return Math.ceil(total / 6);
}
`,
      `export function pageOf<T>(items: T[], page: number): T[] {
  const start = page * 5;
  return items.slice(start, start + 5);
}

export function pageCount(total: number): number {
  return Math.floor(total / 6);
}
`,
    ],
    plan: {
      pageOf: ['let start be page * 6', 'return items slice start and start + 6'],
      pageCount: ['return Math ceil total / 6'],
    },
    check: (m) => {
      const xs = Array.from({ length: 15 }, (_, i) => i);
      return m.pageOf(xs, 0).join() === '0,1,2,3,4,5' && m.pageOf(xs, 2).join() === '12,13,14' && m.pageCount(15) === 3 && m.pageCount(12) === 2;
    },
  },
  {
    id: 'sort-title',
    spec: 'BRW-3: a control labelled "Sort by" orders the books by "Title A-Z" (the default). The input list is not changed.',
    functions: ['sortByTitle'],
    prelude: 'type Book = { id: string; title: string; author: string; genre: string; year: number };\n\n',
    stub: stub('export function sortByTitle(books: Book[]): Book[]', 'sortByTitle'),
    reference: `export function sortByTitle(books: Book[]): Book[] {
  return books.slice().sort((a, b) => a.title.localeCompare(b.title));
}
`,
    mutants: [
      `export function sortByTitle(books: Book[]): Book[] {
  return books.slice().sort((a, b) => b.title.localeCompare(a.title));
}
`,
      `export function sortByTitle(books: Book[]): Book[] {
  return books.sort((a, b) => a.author.localeCompare(b.author));
}
`,
    ],
    plan: { sortByTitle: ["return books slice sort a's title locale compare b's title"] },
    check: (m) => {
      const bs = [{ title: 'b', author: 'a' }, { title: 'a', author: 'b' }];
      const out = m.sortByTitle(bs);
      return out.map((b) => b.title).join() === 'a,b' && bs[0].title === 'b';
    },
  },
]);

/** Smith's own two template examples handed to the plan writer (K2): not one of the 4 tasks. */
export const PLAN_EXAMPLES = Object.freeze([
  { signature: 'function formatPages(pages: number): string', plan: ["return pages + ' pages'"] },
  { signature: 'function dueLabel(loan: Loan): string', plan: ["if loan's renewed: return 'Renewed'", "return 'Renew'"] },
  { signature: 'function cheapest(items: Item[]): Item[]', plan: ["let sorted be items slice sort a's price - b's price", 'return sorted slice 0 and 3'] },
]);

export const TEMPLATES = Object.freeze([
  'return X',
  'let NAME be X',
  'if CONDITION: STEP',
  'if CONDITION: STEP, otherwise STEP',
  "OBJECT's FIELD",
  'SUBJECT VERB ARG and ARG   (a method call: words of the method name, split at capitals)',
  'FUNCTION of ARG            (a plain call)',
  'not (X)',
  'A OP B                     (OP is one of + - * / === !== < <= > >=)',
  "'TEXT'                     (a string)",
]);
