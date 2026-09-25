// #658 -- a workflow unit is callable, as its type says. `defineWorkflow` returns a function at
// runtime (like every other non-JSX unit); `WorkflowUnit` used to be typed as a config object, so
// every call below was a compile error (TS2349: not callable). Compiles with zero `tsc` errors
// now, and the assertions pin what a caller gets back. `xstate` is a root devDependency of THIS
// repo only (MIT): nothing under packages/core/typed-contracts/ imports it.
import { createMachine, getInitialSnapshot } from 'xstate';
import { defineWorkflow, type WorkflowUnit } from '../index.ts';

// A type-level assertion: `Equal<A, B>` is `true` only when the two types are identical.
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
const assertType = <_T extends true>(): void => undefined;

// (a) A config-shaped workflow: calling the unit gives its config, with its literal shape kept.
const Checkout = defineWorkflow('Checkout', () => ({
  id: 'checkout',
  initial: 'idle',
  states: { idle: {}, done: { type: 'final' } },
}));
const config = Checkout({});
const initial: string = config.initial;
const stateNames: string[] = Object.keys(config.states);
assertType<Equal<typeof config.id, string>>();

// (b) A workflow that returns a real XState machine: calling the unit gives the machine itself
// (not a widened config), so a hook can run it with the XState functions directly.
const Toggle = defineWorkflow('Toggle', () =>
  createMachine({ id: 'toggle', initial: 'off', states: { off: { on: { FLIP: 'on' } }, on: { on: { FLIP: 'off' } } } }),
);
const snapshot = getInitialSnapshot(Toggle({}));
const value: unknown = snapshot.value;

// (c) The unit is assignable to the bare `WorkflowUnit` (the wildcard the composition slots use),
// and is a real function of its props.
const asWildcard: WorkflowUnit = Checkout;
const asFunction: (props: Record<string, never>) => { id: string } = Checkout;

void [initial, stateNames, value, asWildcard, asFunction];
