// Pure (DOMAIN-001): the rows of the Pages screen's list of all pages. A page is named by its feature and its file inside
// that feature's pages/ folder; the row id is only a key for this list (the server re-checks the pair on every read).
export type PageRef = { feature: string; file: string };

const keyOf = (p: PageRef) => `${p.feature}\u0000${p.file}`;

export function allPageItems(pages: PageRef[]): { id: string; label: string; detail: string }[] {
  return pages.map((p) => ({ id: keyOf(p), label: p.file, detail: p.feature }));
}

/** The page for a row id, or null when it is not in the list. */
export function pageOfItem(pages: PageRef[], id: string): PageRef | null {
  return pages.find((p) => keyOf(p) === id) ?? null;
}
