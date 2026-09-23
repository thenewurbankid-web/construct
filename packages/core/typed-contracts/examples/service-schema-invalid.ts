// #585 (part of #575) -- deliberately WRONG use of a schema-checked service: reading `.value`
// (and `.issues`) before narrowing on `status`. Excluded from this directory's own
// tsconfig.json (it must NOT compile) and compiled on its own by
// test/typed-contracts-tsc.test.mjs, which asserts on the actual `tsc` diagnostics -- this is
// what "a mismatch becomes a typed error state, never a thrown surprise" costs the caller: the
// type system makes them look at `status` first.
import { defineService, type StandardSchema } from '../index.ts';

interface User { id: string; name: string }
const UserSchema: StandardSchema<User> = {
  '~standard': {
    version: 1,
    vendor: 'hand-written',
    validate: (value) => ({ value: value as User }),
  },
};

const fetchUser = defineService('fetchUser', async ({ id }: { id: string }): Promise<unknown> => ({ id }), {
  schema: UserSchema,
});

export async function unguarded(): Promise<string> {
  const result = await fetchUser({ id: 'u1' });
  // TS2339: Property 'value' does not exist on type '{ status: "error"; kind: "schema"; issues }'.
  const name: string = result.value.name;
  // TS2339: Property 'issues' does not exist on type '{ status: "ok"; value: User }'.
  const count: number = result.issues.length;
  return `${name}:${count}`;
}
