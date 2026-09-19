// Pure (DOMAIN-001): keyboard rules of the palette.
import type { ShortcutLike } from '../types.ts';

/** Next active index for ArrowUp/ArrowDown/Home/End, wrapping. Returns the current one for other keys. */
export function moveActive(current: number, count: number, key: string): number {
  if (count <= 0) return 0;
  if (key === 'ArrowDown') return (current + 1) % count;
  if (key === 'ArrowUp') return (current - 1 + count) % count;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  return current;
}

/** Ctrl+K (Cmd+K on macOS) toggles the palette. Shift/Alt variants are left to the browser/editor. */
export function isPaletteShortcut(e: ShortcutLike): boolean {
  return e.key.toLowerCase() === 'k' && (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey;
}
