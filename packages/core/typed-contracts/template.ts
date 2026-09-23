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
//
// #591 -- a triple-slash reference (compiler-only: no runtime import, nothing a bundler ever
// sees) so the ambient `JSX` global merge travels with this file into ANY consumer's compilation.
// This repo's own tsconfig picks up jsx-global.d.ts for free via its directory-wide "include": a
// downstream project's tsconfig does not glob into node_modules, so without this reference a real
// project's own `tsc` sees a bare, unmerged `JSX` and fails with TS2503 "Cannot find namespace
// 'JSX'" the moment it imports anything built on Template -- see test/typed-contracts-publish.test.mjs.
/// <reference path="./jsx-global.d.ts" />

export type Template<Props> = (props: Props) => JSX.Element;
