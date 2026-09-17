// Hand-authored type declarations for the plain-.jsx UI primitives (#46).
// Kept deliberately separate from the .jsx implementations rather than
// converting them to .tsx — the components themselves stay exactly as
// they were (untouched, Storybook-documented, already proven in
// production) per #71's "reuse as-is" instruction; this file only gives
// the Next.js/TypeScript feature code that imports them real prop types
// instead of implicit `any`, without touching a single line of the actual
// component implementations.
import type { ComponentPropsWithoutRef, ElementType, ReactNode } from 'react';

export declare function Button(props: ComponentPropsWithoutRef<'button'> & { variant?: 'primary' | 'ghost' }): ReactNode;

export declare function GlassPanel<T extends ElementType = 'div'>(
  props: { as?: T; className?: string; children?: ReactNode } & Omit<ComponentPropsWithoutRef<T>, 'as' | 'className' | 'children'>,
): ReactNode;

export declare function Field(props: { label: ReactNode; hint?: ReactNode; children?: ReactNode }): ReactNode;

export declare function Input(props: ComponentPropsWithoutRef<'input'>): ReactNode;

export declare function Select(props: ComponentPropsWithoutRef<'select'>): ReactNode;

export declare function Badge(props: { tone?: 'tool' | 'llm' | 'llm-none' | 'error'; children?: ReactNode }): ReactNode;
