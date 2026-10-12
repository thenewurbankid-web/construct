// @line-level atom
'use client';
import { Slot } from 'radix-ui';
import type { ButtonHTMLAttributes, MouseEvent, ReactNode } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

/** Variant hook-points: theming (roadmap item 8) swaps these classes for tokens. */
const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-slate-900 text-white hover:bg-slate-700 active:bg-slate-800 aria-pressed:bg-slate-700',
  secondary: 'border border-slate-300 bg-white text-slate-900 hover:bg-slate-50 active:bg-slate-100 aria-pressed:bg-slate-200',
  ghost: 'text-slate-700 hover:bg-slate-100 active:bg-slate-200 aria-pressed:bg-slate-200',
  danger: 'bg-red-600 text-white hover:bg-red-700 active:bg-red-800',
};
const SIZES: Record<ButtonSize, string> = { sm: 'h-8 px-3 text-xs', md: 'h-10 px-4 text-sm', lg: 'h-12 px-6 text-base' };

export type ButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  /** The visible text; children win when both are given. */
  label?: string;
  children?: ReactNode;
  /** An icon before the label (aria-hidden). */
  icon?: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Its action is running: shows a spinner, sets aria-busy, ignores presses. */
  loading?: boolean;
  /** Makes it a toggle button (aria-pressed). */
  pressed?: boolean;
  /** Render the child element (a router link, say) with the button's look and behaviour (Radix Slot). */
  asChild?: boolean;
};

/** Runs an action when pressed; can stay pressed as a toggle, or show that its action is running. */
export function Button({ label, children, icon, variant = 'primary', size = 'md', loading = false, pressed, asChild = false, disabled, onClick, className = '', type = 'button', ...rest }: ButtonProps) {
  const Comp = asChild ? Slot.Root : 'button';
  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    if (loading) { event.preventDefault(); return; }
    onClick?.(event);
  };
  const content = children ?? label;
  // asChild hands the content straight to Slot, which needs the one child element it styles.
  let inner: ReactNode = content;
  if (!asChild) inner = <ButtonInner content={content} loading={loading} icon={icon} />;
  return (
    <Comp
      type={asChild ? undefined : type}
      disabled={disabled}
      aria-busy={loading || undefined}
      aria-disabled={loading || undefined}
      aria-pressed={pressed}
      data-variant={variant}
      data-size={size}
      data-loading={loading || undefined}
      onClick={handleClick}
      className={`inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 disabled:pointer-events-none disabled:opacity-50 data-[loading]:cursor-progress ${VARIANTS[variant]} ${SIZES[size]} ${className}`}
      {...rest}
    >
      {inner}
    </Comp>
  );
}

function ButtonInner({ content, loading, icon }: { content: ReactNode; loading: boolean; icon?: ReactNode }) {
  return (
    <>
      <ButtonGlyph loading={loading} icon={icon} />
      <span data-part="label">{content}</span>
    </>
  );
}

/** The spinner while loading, else the icon, else nothing. */
function ButtonGlyph({ loading, icon }: { loading: boolean; icon?: ReactNode }) {
  if (loading) return <span aria-hidden="true" data-part="spinner" className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-r-transparent motion-reduce:animate-none" />;
  if (!icon) return null;
  return <span aria-hidden="true" data-part="icon">{icon}</span>;
}
