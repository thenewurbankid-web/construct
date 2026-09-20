// #348 -- the test-attribute convention, in one place (owner decision on #284: events bind by
// `data-testid` convention, no binding file). Pure, deterministic, no LLM.
//
//   data-testid   = kebab(event name)              REQUEST_REFUND -> request-refund
//                   scoped `<machine>-<event>` on EVERY machine of a feature that shares the name
//   data-flow     = the machine key                scopes several machines on one page
//   data-flow-state = the machine's leaf state path (raw XState path: `manualReview`, `parent.child`)
//
// Only user events (transitions of kind `on`) bind a data-testid; `after`, `always`, `invoke` and
// `onDone` are driven by the flow itself, so nothing on the page can trigger them.

/** kebab-case: camelCase boundaries and any run of non-alphanumerics become a single "-", lowercased. */
export function kebab(name) {
  return String(name)
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}

/** The data-testid for a user event on its own (unscoped). */
export const eventTestId = (event) => kebab(event);

/** The data-testid a scaffolded page slot gets: `onRequestRefund` -> `request-refund`, `onSubmit` -> `submit`. */
export function slotTestId(slotName) {
  const m = /^on([A-Z][A-Za-z0-9]*)$/.exec(slotName);
  return m ? kebab(m[1]) : null;
}

/** Unique, filesystem- and selector-safe machine keys for a feature's machines (in the given order):
 * kebab of the machine id, `-2`, `-3`... for a repeat. `machines` need only carry `id`. */
export function machineKeys(machines) {
  const used = new Map();
  return machines.map((m) => {
    const base = kebab(m.id || m.exportName || '') || 'machine';
    const n = (used.get(base) || 0) + 1;
    used.set(base, n);
    return n === 1 ? base : `${base}-${n}`;
  });
}

/** The user events (raw names, source order, de-duplicated) of one extracted machine. */
export function userEventsOf(machine) {
  return [...new Set((machine.transitions || []).filter((t) => t.kind === 'on').map((t) => t.event))];
}

/**
 * The data-testid for every user event of every machine in a feature.
 * `machines`: extracted machines in a stable order. Returns `{ keys, testIds }` where
 * `testIds[i]` is a Map(event -> testid) for machine i and `keys[i]` is its machine key.
 * An event name used by two or more machines is scoped `<machine key>-<event>` on all of them.
 */
export function assignTestIds(machines) {
  const keys = machineKeys(machines);
  const events = machines.map(userEventsOf);
  const count = new Map();
  for (const evs of events) for (const id of new Set(evs.map(eventTestId))) count.set(id, (count.get(id) || 0) + 1);
  const testIds = events.map((evs, i) => new Map(evs.map((e) => {
    const id = eventTestId(e);
    return [e, count.get(id) > 1 ? `${keys[i]}-${id}` : id];
  })));
  return { keys, testIds };
}
