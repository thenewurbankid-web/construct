// Pure (DOMAIN-001): the narrow (< 900px) layout shows ONE pane at a time,
// switched from a bottom tab bar (Design #250, docs/design/cockpit-layout.md).

/** Below this width the frame collapses to one pane (>= 900 keeps the 3-pane layout). */
export const NARROW_BREAKPOINT = 900;

export const NARROW_MEDIA_QUERY = `(max-width: ${NARROW_BREAKPOINT - 1}px)`;

export function isNarrowWidth(width: number): boolean {
  return width < NARROW_BREAKPOINT;
}
