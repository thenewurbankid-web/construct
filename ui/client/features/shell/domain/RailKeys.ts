// Pure (DOMAIN-001): keyboard model of the screens rail (the IDE-style activity bar). Up/Down move between
// screens on the vertical rail; Left/Right do the same on the horizontal bar the rail becomes on a phone;
// Home/End jump to the ends. Enter (or Space) is the link's own activation, so it is not handled here.

/** Index of the screen that `key` moves focus to from `index`, or null when the key is not a rail key. */
export function railNextIndex(key: string, index: number, count: number): number | null {
  if (count <= 0) return null;
  switch (key) {
    case 'ArrowDown':
    case 'ArrowRight':
      return (index + 1) % count;
    case 'ArrowUp':
    case 'ArrowLeft':
      return (index - 1 + count) % count;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return null;
  }
}
