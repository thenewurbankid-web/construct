// #501 -- the shared template type every JSX-returning unit (component,
// page, controller, route) is written as, per #499/#500's design: "every
// JSX-returning function is written as this type." Moves a real share of
// enforcement (return completeness, shape) into `tsc` itself instead of a
// hand-written AST rule -- see jsx-global.d.ts for why `JSX.Element` needs a
// small shim under React 19's types, and examples/implicit-return.ts (used
// by test/typed-contracts-tsc.test.mjs) for the compile-error proof that a
// branch falling off the end of a Template without returning is a real
// `tsc` error (TS7030 "Not all code paths return a value"), not just a
// missed lint.
export type Template<Props> = (props: Props) => JSX.Element;
