// #501/#502 step 5(b) -- deliberately illegal cross-layer wiring. Excluded
// from this directory's own tsconfig.json (it must NOT compile), and
// compiled on its own by test/typed-contracts-tsc.test.mjs, which asserts
// on the actual `tsc` diagnostics produced (not just "some error happened").
import * as React from 'react';
import { defineService, definePage, defineComponent, defineProvider, type PropRef, type HookUnitAny } from '../index.ts';

const fetchUser = defineService<{ id: string }, Promise<{ id: string }>>('fetchUser', async ({ id }) => ({ id }));

// A stand-in for an arbitrary (non-Provider) hook unit -- there is no `defineHook` factory yet
// (units.ts's own doc comment: out of scope, tracked separately), so this is cast directly to
// `HookUnitAny` purely to have a concrete value of that type for the illegal-wiring case below.
const someOtherHook = ((id: string) => id) as unknown as HookUnitAny;

// Illegal: PAGE-002/003/005's real-world intent, restated as a type error --
// a page's props may reference a ComponentUnit (canImport: ['component']),
// never a ServiceUnit. `definePage`'s own generic constraint
// (`Forbid<Props, ComponentUnitAny>`, factories.ts) rejects this BadPageProps
// at the `definePage<BadPageProps>(...)` call site below.
interface BadPageProps { fetchUser: typeof fetchUser }
const BadPage = definePage<BadPageProps>('BadPage', (props) =>
  React.createElement('div', null, String(props.fetchUser)),
);
void BadPage;

// A second, independent illegal wiring: a component's props may not hold a
// PropRef to a ServiceUnit either -- PropRef<T> only changes HOW a slot is
// filled (pick vs. type in), not WHAT layer boundary applies to it.
interface BadComponentProps { fetchUser: PropRef<typeof fetchUser> }
const BadComponent = defineComponent<BadComponentProps>('BadComponent', (props) =>
  React.createElement('div', null, String(props.fetchUser)),
);
void BadComponent;

// A third, independent illegal wiring (#510): a Provider's own Props may only reference
// workflow/service/domain units (mirrors DEFAULT_LAYERS.hook.canImport) -- never an arbitrary
// other hook. `defineProvider`'s own generic constraint (`Forbid<Props, ProviderAllowed>`,
// provider.ts) rejects this BadProviderProps at the `defineProvider<BadProviderProps, ...>(...)`
// call site below.
interface BadProviderProps { other: typeof someOtherHook }
const BadProvider = defineProvider<BadProviderProps, string>('BadProvider', ({ other }) => other('x'));
void BadProvider;
