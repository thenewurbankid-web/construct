// Type-level checks: the atoms' declared types say what their JS forms say.
// Compiled with noEmit by `npm run test:types`; a wrong type fails the build.
import {
  at, equals, get, isText, join, keysOf, mapEach, nowTime, orElse, plus, promiseFrom, seededSource, withKey,
} from '../../src';

type Same<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
const same = <A, B>(_: Same<A, B>): void => {};

// operators keep the operand type
same<ReturnType<typeof equals<number>>, boolean>(true);
same<typeof sum, number>(true);
same<typeof big, bigint>(true);
same<ReturnType<typeof join>, string>(true);
const sum = plus(1, 2);
const big = plus(1n, 2n);
// @ts-expect-error -- number + bigint throws in JS
plus(1, 2n);

// access: reads through null are typed as possibly undefined
const user = { name: 'Ada', age: 36 };
const name = get(user, 'name');
same<typeof name, string>(true);
const maybeName = get(user as typeof user | null, 'name');
same<typeof maybeName, string | undefined>(true);
// @ts-expect-error -- not a key of user
get(user, 'email');
const first = at(['a', 'b'], 0);
same<typeof first, string | undefined>(true);

// checks narrow
const unknownValue: unknown = 'x';
if (isText(unknownValue)) same<typeof unknownValue, string>(true);

// logic: orElse drops null and undefined from the left side
const fallback = orElse(null as string | null, () => 0);
same<typeof fallback, string | number>(true);

// lists and objects
const lengths = mapEach(['a', 'bb'], (s) => s.length);
same<typeof lengths, number[]>(true);
const keys = keysOf(user);
same<typeof keys, Array<'name' | 'age'>>(true);
const withEmail = withKey(user, 'email', 'ada@example.com');
same<typeof withEmail.email, string>(true);
same<typeof withEmail.name, string>(true);

// generated and impure atoms
const promised = promiseFrom<number>((resolve) => resolve(1));
same<typeof promised, Promise<number>>(true);
same<ReturnType<typeof nowTime>, number>(true);
const source = seededSource(1);
same<ReturnType<typeof source>, number>(true);
