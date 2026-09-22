// #501/#502 step 5(b) -- deliberately illegal cross-layer wiring. Excluded
// from this directory's own tsconfig.json (it must NOT compile), and
// compiled on its own by test/typed-contracts-tsc.test.mjs, which asserts
// on the actual `tsc` diagnostics produced (not just "some error happened").
import * as React from 'react';
import { defineService, definePage, defineComponent, type PropRef } from '../index.ts';

const fetchUser = defineService<{ id: string }, Promise<{ id: string }>>('fetchUser', async ({ id }) => ({ id }));

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
