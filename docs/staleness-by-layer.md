# Staleness by layer

Story #577 (epic #570). The model is XState's: an event a state does not
handle changes nothing; an invoked call is cancelled when its state exits, so
a late result cannot land; a stopped actor ignores everything. Staleness is
decided by one small, deterministic rule at the boundary, not by every caller
remembering to check. This page states that rule per layer, names what
enforces it today (`path:line`), and what is still proposed. The examples are
the document; copy them.

Status words: **ENFORCED** (a rule, factory or module exists and has a test),
**PARTIAL** (part of the invariant is enforced, the rest is by example),
**PROPOSED** (nothing enforces it yet; the rule and its fixture are named).

Factory imports below are written as `@line/construct-core/typed-contracts`
(#591: `packages/core/package.json` exports that subpath and ships the `.ts`
sources directly, no compile step -- a TS-aware toolchain like a
`construct init` scaffold consumes them as-is). The repo's own examples
still import by relative path (`packages/core/typed-contracts/index.ts`).

| Layer | Stale means | Guard | Status |
|---|---|---|---|
| Domain | a value outside its type's meaning | pure, boundary-typed function; branded values | ENFORCED |
| Service | a response after its request was superseded, or of the wrong shape | `AbortSignal` per request slot, `SERVICE-003`; schema at the boundary (#575) | ENFORCED (opt-in) |
| Workflow | an event in a state that does not decide it | transition table + `WORKFLOW-004`; typed state union | ENFORCED (opt-in) |
| Hook | an effect that outlives its owner; a closure over an old value | `useTrackedState` + `HOOK-001`; `useProvider` throws outside its tree; `HOOK-003` (cleanup required) | ENFORCED (opt-in, cleanup half) |
| Component / Page | props older than the state they render | pure view of one union member; `PAGE-00x`/`COMPONENT-00x` | PARTIAL |
| Controller | a snapshot copied at an earlier render | read the hook live every render; `CONTROLLER-003` (no local state in a controller) | ENFORCED (opt-in) |
| Route | a URL param that no longer names anything | `ROUTE-003` (forward `params` whole); a domain parser turns it into found / not-found | ENFORCED (opt-in, forwarding half) |
| Cockpit files | a save built on an old copy of the file | sha256 content hash, `409` on mismatch | ENFORCED |

## Domain

**Invariant.** A domain function never receives a value its type cannot
mean, and has no clock, so nothing it holds can go stale.

**Guard.** `defineDomain` forbids every unit kind in its props
(`packages/core/typed-contracts/factories.ts:175-180`, via `Forbid<Props, never>`,
`packages/core/typed-contracts/units.ts:174-176`); `DOMAIN-001` bans effects by
name (`packages/core/architecture-enforcer.mjs:477-484`, `packages/core/config.mjs:228`)
and `DOMAIN-002`, opt-in, allows only the function's own bindings
(`packages/core/architecture-enforcer.mjs:504-512`, `packages/core/config.mjs:238`).
Branded values use the same `unique symbol` idiom as `Brand<T, Layer>`
(`packages/core/typed-contracts/brand.ts:30-46`). **ENFORCED**; value branding
is by example, not by rule.

```ts
// features/orders/domain/parseOrderId.ts
import { defineDomain } from '@line/construct-core/typed-contracts';

declare const orderIdBrand: unique symbol;
/** Only parseOrderId can make one; a raw string never passes as an OrderId. */
export type OrderId = string & { readonly [orderIdBrand]: 'OrderId' };

export const parseOrderId = defineDomain<{ raw: string }, OrderId | null>(
  'parseOrderId',
  ({ raw }) => (/^ord_[a-z0-9]{8}$/.test(raw) ? (raw as OrderId) : null),
);
```

## Service

**Invariant.** A response that arrives after its request was superseded, or
that does not match the declared shape, changes nothing.

**Guard today.** `defineService` fixes the import boundary
(`packages/core/typed-contracts/factories.ts:157-162`); `SERVICE-002` keeps React
out (`packages/core/architecture-enforcer.mjs:447-454`). `SERVICE-001` ("Services
own external effects") is registered (`packages/core/config.mjs:226`) but has no
detector in any enforcer. Supersede is now checked; shape at the boundary is
still open. **ENFORCED (opt-in, supersede half); PROPOSED (shape half, #575).**

**Supersede-and-abort (`SERVICE-003`, opt-in).** Every service takes an
`AbortSignal` and passes it to `fetch`; the caller owns one `AbortController`
per request slot and aborts the previous request before starting the next.
Inside a workflow this is free: XState v5's `fromPromise` hands the invoked
function a `signal` that is aborted the moment the invoking state exits, so
the workflow's own cancel-on-exit becomes the network abort.

- Rule `SERVICE-003` (off by default; opt in with `rules: { SERVICE-003:
  warning }`): a service's first `fetch(url, init)` call must pass `signal` in
  `init`, and a `defineService(name, fn)` call's `fn` must declare
  `signal: AbortSignal` in its first parameter's type (inline, or as
  `defineService`'s own explicit generic type argument). Deterministic, first-hit
  only, same style as `PAGE-004`/`SERVICE-002`: `collectCalls(ast,
  new Set(['fetch']))[0]` gates presence (a service with no network calls is
  never reported), `findMissingAbortSignal`
  (`packages/core/architecture-enforcer.mjs:315-353`) does the real check,
  emitted at `packages/core/architecture-enforcer.mjs:632-640`, opt-in flag
  read at `packages/core/architecture-enforcer.mjs:1011`. Registered at
  `packages/core/config.mjs:300`.
- Generator: the service template (`packages/core/generators.mjs:21-24`) emits
  the signal-taking form below.
- Fixture: `fixtures/staleness/features/bad/services/fetchOrder.ts` (no
  `signal` anywhere) fails; `.../good/services/fetchOrder.ts` (below) passes.
  Test: `test/serviceAbortSignal.test.mjs`.

```ts
// features/orders/services/fetchOrder.ts
import { defineService } from '@line/construct-core/typed-contracts';
import type { OrderId } from '../domain/parseOrderId';

export const fetchOrder = defineService<
  { id: OrderId; signal: AbortSignal },
  Promise<{ id: string; total: number }>
>('fetchOrder', async ({ id, signal }) => {
  const response = await fetch(`/api/orders/${id}`, { signal });
  if (!response.ok) throw new Error(`Request failed: ${response.status}`);
  return response.json();
});
```

```ts
// features/orders/workflows/OrderWorkflow.tsx -- the invoking state owns the signal
import { fromPromise, setup } from 'xstate';
import { fetchOrder } from '../services/fetchOrder';

export const OrderWorkflow = setup({
  actors: {
    loadOrder: fromPromise(({ input, signal }: { input: { id: OrderId }; signal: AbortSignal }) =>
      fetchOrder({ id: input.id, signal })),
  },
}).createMachine({
  id: 'order',
  initial: 'loading',
  states: {
    loading: {
      invoke: { src: 'loadOrder', input: ({ context }) => ({ id: context.id }), onDone: 'ready', onError: 'failed' },
      on: { SELECT: { target: 'loading', reenter: true } }, // exit + re-enter: the old fetch is aborted
    },
    ready: { on: { SELECT: 'loading' } },
    failed: { on: { SELECT: 'loading' } },
  },
});
```

```ts
// In a plain hook (no machine): one controller per slot, abort before replacing.
const inFlight = useRef<AbortController | null>(null);
function load(id: OrderId) {
  inFlight.current?.abort();
  const controller = new AbortController();
  inFlight.current = controller;
  fetchOrder({ id, signal: controller.signal }).then(setOrder, (e) => { if (e.name !== 'AbortError') setError(e); });
}
```

**Shape at the boundary** is story #575 (a Zod schema on `defineService`,
parsed where the response enters). Not restated here.

## Workflow

**Invariant.** An event a state does not handle changes nothing, and that
"nothing" was decided, not forgotten.

**Guard.** XState's transition table ignores unhandled events by
construction. `WORKFLOW-004` (`packages/core/config.mjs:213`, off by default;
opt in with `rules: { WORKFLOW-004: warning }`) reports every atomic non-final
state that has no decision for an event the machine handles elsewhere;
`findTransitionHoles` is the whole rule
(`packages/core/architecture-enforcer.mjs:211-224`, emitted at
`packages/core/architecture-enforcer.mjs:608-617`, opt-in flag read at
`packages/core/architecture-enforcer.mjs:1007`). The explicit ignore is `EVENT: {}`. `construct generate workflow
--state-union` emits a `<Name>State` union with `match<Name>State` and
`assertNever<Name>State` (`packages/engine/workflowGenerator.mjs:274-303`), so
handling only some states is a `tsc` error. `defineWorkflow`:
`packages/core/typed-contracts/factories.ts:147-152`. **ENFORCED** (opt-in).
Tests: `test/workflowTransitionTable.test.mjs`,
`test/workflowGenerator.test.mjs:300`.

```ts
states: {
  idle:       { on: { SUBMIT: 'submitting', CANCEL: {} } },   // CANCEL decided: ignored on purpose
  submitting: { on: { SUBMIT: {}, CANCEL: 'idle' } },         // a second SUBMIT changes nothing
  done:       { type: 'final' },
}
```

```ts
// CheckoutWorkflowState.ts is generated; leave a state out and this stops compiling.
const label = matchCheckoutState(state, { idle: () => 'Idle', submitting: () => 'Sending', done: () => 'Done' });
```

## Hook

**Invariant.** An effect or subscription never outlives the hook that started
it, and no closure reads a value older than the render it runs in.

**Guard today.** A `use<Name>State` hook is built through `useTrackedState`
(`packages/core/typed-contracts/trackedState.ts:47-51`) and `HOOK-001` forbids
any `useEffect`, `useRef`, `fetch` or control flow beside it
(`packages/core/architecture-enforcer.mjs:544-566`, `packages/core/config.mjs:163`):
the class "an effect inside a state hook" cannot exist. A Provider consumer
that renders outside its `ProviderComponent` throws instead of reading a
missing value (`packages/core/typed-contracts/provider.ts:101-110`, `HOOK-002`
at `packages/core/architecture-enforcer.mjs:521-530`). Nothing covers the
general `use<Name>` hook (`packages/core/generators.mjs:19`) that owns an
effect; `HOOK-003` (below) covers that. **ENFORCED (opt-in, cleanup half);
PARTIAL for stale closures** (by example, and `eslint-plugin-react-hooks`).

```ts
// features/orders/hooks/useOrderState.ts -- HOOK-001 shape; no effect can live here
import { useTrackedState } from '@line/construct-core/typed-contracts';
export function useOrderState() {
  const [selected, setSelected] = useTrackedState<OrderId | null>('selected', null);
  return { selected, setSelected, hasSelection: selected !== null };
}
```

```ts
// A stale closure cannot happen when the setter is given a function of the previous value.
setCount((prev) => prev + 1);   // not: setCount(count + 1)
```

**Cleanup (`HOOK-003`, opt-in, #668).** Off by default; opt in with
`rules: { HOOK-003: warning }`. In `features/*/hooks/**`, a `useEffect` or
`useLayoutEffect` (also `React.useEffect`) whose callback calls a
subscribe-shaped API (`addEventListener`, `setInterval`, `setTimeout`,
`subscribe`, `.on(`, `new AbortController`/`WebSocket`/`EventSource`/
`MutationObserver`/`ResizeObserver`/`IntersectionObserver`) must return
something React can run on cleanup: a `return <function|identifier|call>` in the
callback's own body, or an expression body that is `store.subscribe(cb)`.
`collectUncleanedSubscriptions` (`packages/ast/staleness.mjs:101`) is the whole
rule, emitted at `packages/core/architecture-enforcer.mjs:713-721`, opt-in flag
read at `packages/core/architecture-enforcer.mjs:1014`, registered at
`packages/core/config.mjs:305`. An effect with no subscribe-shaped call is
never reported. Known exception, by design: a timer stored in a ref and
stopped by a *sibling* effect's cleanup (`ui/client/features/shell/hooks/useFaviconMotion.tsx`)
is reported, because the rule reads one effect at a time; silence it with
the usual `exceptions` entry. Stale closures need data flow; wrap
`eslint-plugin-react-hooks` (`exhaustive-deps`) rather than build a rule.
Fixtures: `fixtures/staleness/features/bad/hooks/useViewport.ts` (listener never
removed) fails; `.../good/hooks/useViewport.ts` (below) passes. Test:
`test/stalenessRules.test.mjs`.

```ts
useEffect(() => {
  const controller = new AbortController();
  window.addEventListener('resize', onResize, { signal: controller.signal });
  return () => controller.abort();          // the subscription dies with the hook
}, [onResize]);
```

## Component / Page

**Invariant.** A view renders exactly one member of a state union, from props
only, so it can never show a combination of states that never existed.

**Guard today.** Pages and components cannot fetch, import an application
layer, or use a machine (`PAGE-002..006`, `packages/core/architecture-enforcer.mjs:266-321`;
`COMPONENT-002/003` at `packages/core/architecture-enforcer.mjs:351-358`), so a view has no copy of application state
to go stale; `definePage`/`defineComponent` forbid non-component units in
props (`packages/core/typed-contracts/factories.ts:82-94`). The one-member-per-
view render is the generated `match<Name>State`
(`packages/engine/workflowGenerator.mjs:290-294`), by example. **PARTIAL**: the
purity half is enforced; "state is a union, not flags" is story #573
(`STATE-001`, proposed there, not restated here).

```tsx
// features/checkout/pages/CheckoutPage.tsx
import { definePage } from '@line/construct-core/typed-contracts';
import { matchCheckoutState, type CheckoutState } from '../workflows/CheckoutWorkflowState';

export const CheckoutPage = definePage<{ state: CheckoutState; onSubmit: () => void }>(
  'CheckoutPage',
  ({ state, onSubmit }) =>
    matchCheckoutState(state, {
      idle:       () => <button onClick={onSubmit}>Pay</button>,
      submitting: () => <p>Sending</p>,
      done:       () => <p>Paid</p>,
    }),
);
```

## Controller

**Invariant.** A controller binds the hook's live value on every render,
never a copy taken at an earlier one.

**Guard today.** `CONTROLLER-001` allows no `fetch` and no control flow
(`packages/core/architecture-enforcer.mjs:462-475`, `packages/core/config.mjs:219`),
and the binder emits `const { ... } = useX();` read fresh each render and
passed straight into JSX (`packages/engine/controllerBinder.mjs:219-233`);
`defineController`: `packages/core/typed-contracts/factories.ts:119-124`.
`CONTROLLER-003` (below) forbids `useState(snapshot.total)` or `useRef(snapshot)`
in a controller, which is exactly the copy. **ENFORCED (opt-in).**

```tsx
// features/orders/controllers/OrderController.tsx -- what the binder emits; nothing is stored
import { OrderPage } from '../pages/OrderPage';
import { useOrder } from '../hooks/useOrder';

export function OrderController() {
  const { state, select } = useOrder();     // live on every render
  return <OrderPage state={state} onSelect={select} />;
}
```

```ts
// Reading one field of a running machine: a selector on the live snapshot, never a copy.
import { useSelector } from '@xstate/react';
const total = useSelector(actorRef, (snapshot) => snapshot.context.total);
```

**No state of its own (`CONTROLLER-003`, opt-in, #667).** Off by default; opt in
with `rules: { CONTROLLER-003: warning }`. A controller may not call `useState`,
`useReducer`, `useRef`, `useEffect`, `useLayoutEffect`, `useMemo` or
`useCallback` (also as `React.useX`): state lives in hooks and workflows, and
reading a hook is not a violation. `collectControllerStateCalls`
(`packages/ast/staleness.mjs:33`) is the whole rule, emitted at
`packages/core/architecture-enforcer.mjs:663-671`, opt-in flag read at
`packages/core/architecture-enforcer.mjs:1013`, registered at
`packages/core/config.mjs:304`. Fixtures:
`fixtures/staleness/features/bad/controllers/OrderController.tsx`
(`const [total] = useState(state.total)`) fails; `.../good/controllers/OrderController.tsx`
(the binder's output above) passes. Test: `test/stalenessRules.test.mjs`. Not
switched on for `ui/client`: 11 of its 64 controllers hold state today.

## Route

**Invariant.** A URL param that no longer names anything becomes a typed
not-found state at the boundary; a raw string never travels inward.

**Guard today.** `ROUTE-001/002` make a route import a controller and hold no
logic (`packages/core/architecture-enforcer.mjs:247-263`, `packages/core/config.mjs:144-145`);
`defineRoute` accepts only a controller in its props
(`packages/core/typed-contracts/factories.ts:132-137`). `ROUTE-003` (below) keeps
the route from reading params; the parse itself is a domain unit, by example.
**ENFORCED (opt-in, forwarding half); PROPOSED (a rule that the controller calls
a `parse<Name>Route`).**

**Forward, do not read (`ROUTE-003`, opt-in, #669).** Off by default; opt in with
`rules: { ROUTE-003: warning }`. A route reports every read into `params` or
`searchParams`: `params.id`, `params["id"]`, `searchParams.get(...)`,
`(await params).id`, `const { id } = params` / `= await params` / `= useParams()`,
and `function Page({ params: { id } })`. Passing `params` on whole
(`<OrderController params={params} />`) is never reported. It reads the file,
not the folder name, so it needs no dynamic-segment detection: a route with no
params has nothing to read. `collectParamsReads`
(`packages/ast/staleness.mjs:130`) is the whole rule, emitted at
`packages/core/architecture-enforcer.mjs:428-436`, opt-in flag read at
`packages/core/architecture-enforcer.mjs:1015`, registered at
`packages/core/config.mjs:306`. The controller (which may import domain) calls
one `parse<Name>Route` domain unit and passes its union to the page.
Fixtures: `fixtures/staleness/app/bad/orders/[id]/page.tsx` (`params.id`) fails;
`.../good/orders/[id]/page.tsx` and the two files below pass. Test:
`test/stalenessRules.test.mjs`.

```tsx
// app/orders/[id]/page.tsx -- route: forward, do not read
import { OrderController } from '@/features/orders/controllers/OrderController';
export default function Page({ params }: { params: { id: string } }) {
  return <OrderController params={params} />;
}
```

```ts
// features/orders/domain/parseOrderRoute.ts -- the only place a param becomes meaning
export type OrderRoute = { status: 'found'; id: OrderId } | { status: 'not-found'; raw: string };
export const parseOrderRoute = defineDomain<{ params: { id: string } }, OrderRoute>(
  'parseOrderRoute',
  ({ params }) => {
    const id = parseOrderId({ raw: params.id });
    return id ? { status: 'found', id } : { status: 'not-found', raw: params.id };
  },
);
```

```tsx
// features/orders/controllers/OrderController.tsx -- one call, no branch (CONTROLLER-001 holds)
export function OrderController({ params }: { params: { id: string } }) {
  const route = parseOrderRoute({ params });
  const { state, select } = useOrder(route);
  return <OrderPage route={route} state={state} onSelect={select} />;  // the page renders 'not-found'
}
```

## Cockpit files

**Invariant.** A save built on an old copy of a file is refused, never
merged.

**Guard.** Every read returns `contentHash` (sha256 of the text,
`ui/server/src/pagesEditor.mjs:164-166`); every write re-reads the disk and
compares. Pages editor: `patchNode` throws `409` on mismatch
(`ui/server/src/pagesEditor.mjs:216-219`) and when the node id is gone
(`ui/server/src/pagesEditor.mjs:126`). Components editor: `componentSave`
returns `409 CHANGED_ON_DISK` (`ui/server/src/componentsApi.mjs:122`).
**ENFORCED.** Tests: `ui/server/src/pagesEditor.test.mjs:161`,
`ui/server/src/componentsApi.test.mjs:204-216`.

The hash is required (#590): `patchNode` and every other write call
`assertContentHash` (`ui/server/src/pagesEditor.mjs:139-150`), so a client that
omits it gets `400 HASH_REQUIRED`, a stale one `409 CHANGED_ON_DISK`.

```ts
// Client side: carry the hash you read; a 409 means reload, never retry the same body.
const { snippet, contentHash } = await api.getNodeSnippet(file, nodeId);
const r = await api.patchNode({ file, nodeId, snippet: edited, contentHash });
if (r.status === 409) await reloadTree();
```

## What ships first, and why

The service supersede-and-abort guard (`SERVICE-003` plus the template change),
as the story says. Three reasons over the other proposed rows:

1. It is the most common real bug: a late response overwriting a newer one is
   a race every list-detail screen has, and nothing in the stack stops it
   today; the workflow row is already enforced and the hook/controller rows
   are narrower.
2. It reuses the machinery that exists: XState's `fromPromise` already passes
   the `signal`; the rule needs only `collectCalls` and an object-property
   check; the generator change is one template string.
3. It makes the other rows cheaper: `HOOK-003`'s cleanup form is
   `controller.abort()`, and `CONTROLLER-003` has nothing to copy once the
   request lives in a signal-owning hook or machine.

Then, in the order written on the page: `CONTROLLER-003` (#667; one call-name
set, fixture is the binder's own output), `HOOK-003` (#668; a return-shape check
on effect callbacks), `ROUTE-003` (#669; a params-read collector), and the
pages-editor hash made required (#590). All four are shipped and opt-in. Still
proposed: a rule that a route's controller calls a `parse<Name>Route` domain
unit, `STATE-001`'s one-member-per-view render (story #573), and the schema at
the service boundary (#575).
