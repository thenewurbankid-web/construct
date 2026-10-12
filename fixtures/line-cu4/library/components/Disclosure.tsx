// @line-level atom
import type { ReactNode } from 'react';

const look = { border: '1px solid #c9c0ad', borderRadius: 8, padding: 8 };

/** A part that opens and closes: click the trigger to show or hide the content. */
export function Disclosure({ trigger, children, open, onOpenChange }: { trigger: ReactNode; children?: ReactNode; open?: boolean; onOpenChange?: (open: boolean) => void }) {
  return (
    <div style={look}>
      <button type="button" onClick={() => onOpenChange?.(!open)}>{trigger}</button>
      <div hidden={!open}>{children}</div>
    </div>
  );
}
