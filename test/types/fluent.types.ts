// Type-level checks for the fluent facade: a chain's result has the type of the atom it wraps.
import { attempt, checks, choose, list, match, text, when } from '../../src/fluent';

type Same<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
const same = <A, B>(_: Same<A, B>): void => {};

const isEqual = checks().if(1).is().not().equalTo(2);
same<typeof isEqual, boolean>(true);
// @ts-expect-error -- compares a number with text
checks().if(1).is().equalTo('1');
const both = checks().if('a' as string | null).and(() => 1);
same<typeof both, '' | null | number>(true);

const words = text('a b').splitBy(' ');
same<typeof words, string[]>(true);
const lengths = list(['a', 'bb']).mapEach((s) => s.length);
same<typeof lengths, number[]>(true);
const first = list([1, 2]).firstOf();
same<typeof first, number | undefined>(true);

const picked = when(true).yields(() => 1).otherwise(() => 'no');
same<typeof picked, number | string>(true);
const chosen = choose().when(true, () => 1).when(false, () => 'b').otherwise(() => null);
same<typeof chosen, number | string | null>(true);
const matched = match('k').on('k', () => 1).otherwise(() => false);
same<typeof matched, number | boolean>(true);
const attempted = attempt(() => 1).onFailure(() => 'failed').finally(() => {});
same<typeof attempted, number | string>(true);
