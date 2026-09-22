// @types/react 19 declares its JSX types under `React.JSX`, not the bare
// global `JSX` namespace `Template<Props> = (props: Props) => JSX.Element`
// (template.ts) refers to by name, per #499/#500's design. Normally `tsc`
// synthesizes that global merge automatically, but only when it sees real
// JSX syntax in a `.tsx` file with `jsx: "react-jsx"` configured (the
// automatic runtime import triggers the merge). None of this package's
// files contain JSX syntax (units are authored with `React.createElement`,
// see examples/valid.ts) -- kept deliberately since Props (not JSX syntax)
// is the whole point being type-checked here, so this one small ambient
// shim does the same global merge explicitly instead.
import type { JSX as ReactJSX } from 'react';

declare global {
  namespace JSX {
    type Element = ReactJSX.Element;
  }
}

export {};
