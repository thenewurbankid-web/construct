// Hand-authored type declarations for the plain-.jsx UI primitives (#46).
// Kept deliberately separate from the .jsx implementations rather than
// converting them to .tsx — the components themselves stay exactly as
// they were (untouched, Storybook-documented, already proven in
// production) per #71's "reuse as-is" instruction; this file only gives
// the Next.js/TypeScript feature code that imports them real prop types
// instead of implicit `any`, without touching a single line of the actual
// component implementations.
import type { ComponentPropsWithoutRef, ComponentPropsWithRef, CSSProperties, ElementType, ReactNode } from 'react';

export declare function Button(props: ComponentPropsWithoutRef<'button'> & { variant?: 'primary' | 'ghost' }): ReactNode;

// ComponentPropsWithRef (not WithoutRef) so callers can pass `ref` — #77
// needs it for TreePanel.tsx/PreviewPanel.tsx to scroll their own
// container into view. GlassPanel's actual .jsx implementation already
// spreads `...rest` onto the rendered Tag, so `ref` already worked at
// runtime (React 19 forwards a plain `ref` prop through a function
// component's props without needing forwardRef); this only fixes the type
// declaration to match, same "types only, don't touch the .jsx" rule this
// file states above.
export declare function GlassPanel<T extends ElementType = 'div'>(
  props: { as?: T; className?: string; children?: ReactNode } & Omit<ComponentPropsWithRef<T>, 'as' | 'className' | 'children'>,
): ReactNode;

export declare function Field(props: { label: ReactNode; hint?: ReactNode; children?: ReactNode }): ReactNode;

export declare function Input(props: ComponentPropsWithoutRef<'input'>): ReactNode;

export declare function Select(props: ComponentPropsWithoutRef<'select'>): ReactNode;

export declare function Badge(props: {
  tone?: 'tool' | 'llm' | 'llm-none' | 'error';
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
}): ReactNode;

export declare function Logo(props: { mark?: 'line' | 'construct' | 'cockpit' | 'cli'; size?: number; className?: string }): ReactNode;

// #455: the same mark with the always-on subtle idle animation. Identical props to `Logo` on purpose —
// it is a drop-in at every call site — except that `className` lands on the wrapper element rather than
// the <svg>, because the wrapper is what carries the motion state (`data-motion`).
//
// #406 adds two opt-in states, both no-ops when omitted: `busy` (a faster loop of the same
// keyframes — what AnimatedLoader below sets) and `exiting` (a one-shot hand-off; `onExitEnd` fires
// once, when the animation finishes or immediately under reduced motion).
export declare function AnimatedLogo(props: {
  mark?: 'line' | 'construct' | 'cockpit' | 'cli';
  size?: number;
  className?: string;
  busy?: boolean;
  exiting?: boolean;
  onExitEnd?: () => void;
}): ReactNode;

// #406: a reusable loading indicator built from AnimatedLogo's `busy` state — the same marks/tokens,
// not a separate spinner. `decorative` mirrors AnimatedLogo's own aria-hidden idiom: pass it when the
// loader sits beside a control that already carries the accessible name (e.g. a button whose own text
// reads "Signing in…"); omit it for a standalone loader, which announces itself instead
// (`role="status"` + `aria-label`).
export declare function AnimatedLoader(props: {
  size?: 'small' | 'medium' | 'large' | number;
  variant?: 'inline' | 'overlay';
  label?: string;
  mark?: 'line' | 'construct' | 'cockpit' | 'cli';
  decorative?: boolean;
  className?: string;
}): ReactNode;
