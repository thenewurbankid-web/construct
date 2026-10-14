// Type-level checks for R9 every() sentences: the first word decides the result type, TypeScript
// learns the item type at `.in(xs)`, and a body longer than one atom does not type-check.
import { checks, every, folds, item, the, total, x, y } from '../../src/fluent';
import { plus } from '../../src/atoms';

type Same<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
const same = <A, B>(_: Same<A, B>): void => {};

const xs = [3, -1, 4];

// The first word decides: every() a list, checks() a yes or no, the() one item, folds() one value.
const doubled = every(x).in(xs).is().mapped().to().clone().by().multiplying(x).by(2);
same<typeof doubled, number[]>(true);
const positives = every(x).in(xs).is().kept().if(x).is().positive();
same<typeof positives, number[]>(true);
const allPositive = checks().if().every(x).in(xs).is().positive();
same<typeof allPositive, boolean>(true);
const anyPositive = checks().if().any(x).in(xs).is().positive();
same<typeof anyPositive, boolean>(true);
const firstPositive = the().first(x).in(xs).that().is().positive();
same<typeof firstPositive, number | undefined>(true);
const sum = folds().every(x).in(xs).into(total).starting().at(0).by().adding(x).to(total);
same<typeof sum, number>(true);
// Any imported placeholder names the item.
const kept = every(item).in(xs).is().kept().if(item).is().positive();
same<typeof kept, number[]>(true);

// checks().if(value) is unchanged.
const subject = checks().if(1).is().greater().than(0);
same<typeof subject, boolean>(true);

// The body is typed by the item type learned at in(xs).
// @ts-expect-error -- text items cannot be multiplied
every(x).in(['a']).is().mapped().to().clone().by().multiplying(x).by(2);
// @ts-expect-error -- positive() asks about numbers, and the items are text
every(x).in(['a']).is().kept().if(x).is().positive();
// @ts-expect-error -- positive() asks about numbers, and the items are text
checks().if().every(x).in(['a']).is().positive();
// @ts-expect-error -- the factor must be a number
every(x).in(xs).is().mapped().to().clone().by().multiplying(x).by('2');

// A placeholder the sentence does not bind is a compile error.
// @ts-expect-error -- y is not bound; every(x) binds x
every(x).in(xs).is().mapped().to().clone().by().multiplying(y).by(2);
// @ts-expect-error -- y is not bound
every(x).in(xs).is().kept().if(y).is().positive();
// @ts-expect-error -- item is not bound; the fold binds x and total
folds().every(x).in(xs).into(total).starting().at(0).by().adding(item).to(total);

// A body longer than one atom is a compile error: it becomes a named molecule (R9).
// @ts-expect-error -- the body word ends the sentence; nothing chains after it
every(x).in(xs).is().mapped().to().clone().by().multiplying(x).by(2).and();
// @ts-expect-error -- a placeholder is not a value, so it cannot go into a plain atom
every(x).in(xs).is().mapped().to().clone().by().multiplying(x).by(plus(x, 1));
// @ts-expect-error -- nor into raw JS
every(x).in(xs).is().mapped().to().clone().by().multiplying(x).by(x * 2);
