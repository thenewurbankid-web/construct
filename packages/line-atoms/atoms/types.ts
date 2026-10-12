// The shape every atom's index.ts exports as `machine` (contract.mjs AtomMachine): pure, no timers and no I/O.
// Effects (a fetch, a timer, a submit) happen outside and come back in as events, so every state and every event can
// be driven by a test kit without mocks.

export interface AtomEventBase {
  type: string;
}

export interface AtomMachine<S, E extends AtomEventBase, I> {
  id: string;
  init(input: I): S;
  send(state: S, event: E): S;
  stateOf(state: S): string;
}
