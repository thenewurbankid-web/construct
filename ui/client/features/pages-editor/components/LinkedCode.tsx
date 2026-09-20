'use client';

import { useLinkedCode } from '../hooks/useLinkedCode';
import type { NavReference } from '../types';

type LinkedCodeProps = {
  source: string;
  references: NavReference[];
  onFollow: (ref: NavReference) => void;
  label: string;
};

// Read-only code with links (#321). Only references the server RESOLVED are rendered as buttons
// (dotted accent underline, solid on hover or while Ctrl/Cmd is held, pointer cursor, a hover label
// naming the relationship). Every other reference is part of an ordinary text run: no element, no
// underline, no pointer, no label.
export function LinkedCode({ source, references, onFollow, label }: LinkedCodeProps) {
  const { segments, modifierHeld, hover, showTip, hideTip, onLinkClick, onLinkKeyDown } = useLinkedCode(source, references, onFollow);
  return (
    <>
      <pre className={`linked-code${modifierHeld ? ' modifier-held' : ''}`} aria-label={label} data-testid="linked-code" tabIndex={-1}>
        <code>
          {segments.map((seg, i) =>
            seg.ref ? (
              <button
                key={i}
                type="button"
                className="ref-link"
                data-ref={seg.ref.name}
                data-target={seg.ref.target ?? undefined}
                // A press must not move focus: focusing scrolls the page and the click then lands elsewhere.
                onMouseDown={(e) => e.preventDefault()}
                onClick={(e) => onLinkClick(e, seg.ref as NavReference)}
                onKeyDown={(e) => onLinkKeyDown(e, seg.ref as NavReference)}
                onMouseEnter={(e) => showTip(seg.ref as NavReference, e.currentTarget)}
                onMouseLeave={hideTip}
                onFocus={(e) => showTip(seg.ref as NavReference, e.currentTarget)}
                onBlur={hideTip}
              >
                {seg.text}
              </button>
            ) : (
              seg.text
            ),
          )}
        </code>
      </pre>
      {hover && hover.ref.relation && (
        <div className="ref-tip" role="tooltip" data-testid="ref-tip" style={{ left: hover.x, top: hover.y }}>
          <div className="ref-tip-rel">{hover.ref.relation.label}</div>
          <div>
            <strong>{hover.ref.name}</strong> is {hover.ref.relation.description}.
          </div>
          <div className="ref-tip-key">Click or press Enter to open here. Alt+Left comes back.</div>
        </div>
      )}
    </>
  );
}
