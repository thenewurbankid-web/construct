import { isPaletteShortcut } from '../domain/PaletteKeys';

/** Calls `onToggle` on Ctrl/Cmd+K anywhere (capture phase, so editors cannot swallow it). Returns an unsubscribe. */
export function subscribePaletteShortcut(onToggle: () => void): () => void {
  const onKey = (e: KeyboardEvent) => {
    if (!isPaletteShortcut(e)) return;
    e.preventDefault();
    e.stopPropagation();
    onToggle();
  };
  window.addEventListener('keydown', onKey, true);
  return () => window.removeEventListener('keydown', onKey, true);
}

/** Remembers the focused element and returns a function that puts focus back on it. */
export function rememberFocus(): () => void {
  const el = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  return () => el?.focus();
}
