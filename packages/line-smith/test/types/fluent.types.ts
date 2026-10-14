// Type-level checks for the fluent facade: a chain's result has the type of the atom it wraps.
import { attempt, attempts, checks, choose, chooses, clones, list, match, matches, text, when } from '../../src/fluent';

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

// Atomic English sentences: the same types as the forms above.
const greater = checks().if(2).is().greater().than(1);
same<typeof greater, boolean>(true);
// @ts-expect-error -- compares a number with text
checks().if(1).is().equal().to('1');
// @ts-expect-error -- a question takes one argument per word
checks().if(1).is().greater().than(1, 2);
const has = checks().if([1, 2]).has().item(2);
same<typeof has, boolean>(true);
// @ts-expect-error -- the item must be of the list's type
checks().if([1, 2]).has().item('2');
const sorted = clones().list([3, 1]).and().sorts().by((a, b) => a - b);
same<typeof sorted, number[]>(true);
const trimmed = clones().text(' a ').and().trims();
same<typeof trimmed, string>(true);
const lengthsV2 = clones().list(['a', 'bb']).and().maps().each().with((s) => s.length);
same<typeof lengthsV2, number[]>(true);
const strings = clones().list([1, 'a']).and().keeps().where((x): x is string => typeof x === 'string');
same<typeof strings, string[]>(true);
const firstV2 = list([1, 2]).takes().first();
same<typeof firstV2, number | undefined>(true);
const wordsV2 = text('a b').splits().by(' ');
same<typeof wordsV2, string[]>(true);
const chosenV2 = chooses().when(true).yields(() => 1).when(false).yields(() => 'b').otherwise(() => null);
same<typeof chosenV2, number | string | null>(true);
const matchedV2 = matches().value('k').on('k').yields(() => 1).otherwise(() => false);
same<typeof matchedV2, number | boolean>(true);
const attemptedV2 = attempts().to(() => 1).and().recovers().with(() => 'failed').and().cleans().up().with(() => {});
same<typeof attemptedV2, number | string>(true);
