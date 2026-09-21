// Pure (DOMAIN-001): keyboard model of a Browser-pane list (an ARIA listbox with one tab stop). Up/Down move one row
// and stop at the ends; Home/End jump. Enter and Space select the focused row (the caller's job, not decided here).

/** Index the key moves focus to from `index`, or null when the key is not a list-navigation key. */
export function listNextIndex(key: string, index: number, count: number): number | null {
  if (count <= 0) return null;
  switch (key) {
    case 'ArrowDown':
      return Math.min(count - 1, index + 1);
    case 'ArrowUp':
      return Math.max(0, index - 1);
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return null;
  }
}

/** Which row is in the tab order: the selected one when it is showing, else the first. */
export function tabStopIndex(ids: string[], selectedId: string | null): number {
  const at = selectedId === null ? -1 : ids.indexOf(selectedId);
  return at === -1 ? 0 : at;
}

export function isSelectKey(key: string): boolean {
  return key === 'Enter' || key === ' ';
}
