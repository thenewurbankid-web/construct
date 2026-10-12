// @line-level atom
'use client';
import { Tooltip as RadixTooltip } from 'radix-ui';
import type { ReactNode } from 'react';

export type TooltipProps = {
  /** The description (plain text; never interactive content). */
  content: string;
  /** The described control; it must be focusable. */
  children: ReactNode;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Never shows (the control renders alone). */
  disabled?: boolean;
  side?: 'top' | 'right' | 'bottom' | 'left';
  delayDuration?: number;
};

/** A short description of a control, shown on hover or focus (Radix Tooltip: role="tooltip", aria-describedby). */
export function Tooltip({ content, children, open, defaultOpen, onOpenChange, disabled = false, side = 'top', delayDuration = 300 }: TooltipProps) {
  if (disabled) return <>{children}</>;
  return (
    <RadixTooltip.Provider delayDuration={delayDuration}>
      <RadixTooltip.Root open={open} defaultOpen={defaultOpen} onOpenChange={onOpenChange}>
        <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
        <RadixTooltip.Portal>
          <RadixTooltip.Content side={side} sideOffset={4} data-side={side} className="z-50 rounded bg-slate-900 px-2 py-1 text-xs text-white shadow">
            {content}
            <RadixTooltip.Arrow className="fill-slate-900" />
          </RadixTooltip.Content>
        </RadixTooltip.Portal>
      </RadixTooltip.Root>
    </RadixTooltip.Provider>
  );
}
