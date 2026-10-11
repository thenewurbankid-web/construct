import { createPortal } from 'react-dom';

/** Auto's simulated cursor: a pointer that glides to the control Auto is about to use. Decorative (the caption says
 * the same in words), so screen readers skip it. Drawn on the page body so no panel clips it. */
export function SimCursor({ at, speed }: { at: { x: number; y: number } | null; speed: number }) {
  if (!at) return null;
  const style = {
    transform: `translate(${at.x}px, ${at.y}px)`,
    transitionDuration: `${Math.round(700 / speed)}ms`,
  };
  return createPortal(
    <div className="ltr-cursor" style={style} aria-hidden="true" data-testid="auto-cursor">
      <svg viewBox="0 0 16 16" width="22" height="22">
        <path d="M1 1 L1 13 L4.5 9.5 L7 15 L9 14 L6.5 8.5 L11.5 8.5 Z" />
      </svg>
    </div>,
    document.body,
  );
}
