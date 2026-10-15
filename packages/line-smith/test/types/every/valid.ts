// R9 every() sentences that must compile, with the type each one returns. Compiled by
// `npm run test:types` (test/types/tsconfig.json) and timed by test/every-types.test.mjs; the
// invalid-*.ts fixtures beside it must not compile, with the messages they name.
import { checks, every, folds, i, item, the, total, x, y } from '../../../src/fluent';

type Same<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
const same = <A, B>(_: Same<A, B>): void => {};

const xs = [3, -1, 4];
const big = [3n, -1n];
const rows = [[1, -2], [3]];

// The first word decides: every() a list, checks() a yes or no, the() one item, folds() one value.
const doubled = every(x).in(xs).is().mapped().to().clone().by().multiplying(x).by(2).andThe().mapped();
same<typeof doubled, number[]>(true);
const positives = every(x).in(xs).is().kept().if(x).is().positive().andThe().kept();
same<typeof positives, number[]>(true);
const allPositive = checks().if().every(x).in(xs).is().positive().andThe().answer();
same<typeof allPositive, boolean>(true);
const anyPositive = checks().if().any(x).in(xs).is().positive().andThe().answer();
same<typeof anyPositive, boolean>(true);
const firstPositive = the().first(x).in(xs).that().is().positive().andThe().found();
same<typeof firstPositive, number | undefined>(true);
const sum = folds().every(x).in(xs).into(total).starting().at(0).by().adding(x).to(total).andThe().total();
same<typeof sum, number>(true);

// Any imported placeholder names the item; positive() asks about bigints too.
const kept = every(item).in(xs).is().kept().if(item).is().positive().andThe().kept();
same<typeof kept, number[]>(true);
const bigPositives = every(x).in(big).is().kept().if(x).is().positive().andThe().kept();
same<typeof bigPositives, bigint[]>(true);
// A body word takes a constant or a bound placeholder of the right type, on either side.
const squares = every(x).in(xs).is().mapped().to().clone().by().multiplying(x).by(x).andThe().mapped();
same<typeof squares, number[]>(true);
const tens = every(x).in(xs).is().mapped().to().clone().by().multiplying(10).by(x).andThe().mapped();
same<typeof tens, number[]>(true);

// Nested callbacks add to the scope: every(y).in(x) binds y to the item type of x.
const doubledRows = every(x).in(rows).is().mapped().to().clone().by().every(y).in(x).is().mapped().to().clone().by().multiplying(y).by(2).andThe().mapped();
same<typeof doubledRows, number[][]>(true);
const positiveRows = every(x).in(rows).is().mapped().to().clone().by().every(y).in(x).is().kept().if(y).is().positive().andThe().mapped();
same<typeof positiveRows, number[][]>(true);
const someRows = every(x).in(rows).is().kept().if().any(y).in(x).is().positive().andThe().kept();
same<typeof someRows, number[][]>(true);
const allRows = every(x).in(rows).is().kept().if().every(y).in(x).is().positive().andThe().kept();
same<typeof allRows, number[][]>(true);
// The outer item stays in scope inside the nested body.
const scaled = every(x).in(xs).is().mapped().to().clone().by().every(y).in(rows).is().mapped().to().clone().by().multiplying(x).by(2).andThe().mapped();
same<typeof scaled, number[][]>(true);
// Three levels.
const cubes = [[[1]]];
const deep = every(x).in(cubes).is().mapped().to().clone().by().every(y).in(x).is().mapped().to().clone().by().every(item).in(y).is().mapped().to().clone().by().multiplying(item).by(2).andThe().mapped();
same<typeof deep, number[][][]>(true);

// checks().if(value) is unchanged.
const subject = checks().if(1).is().greater().than(0).andThe().answer();
same<typeof subject, boolean>(true);

// The index: every(x).at(i).in(xs) binds i to a number, in every start.
const xs2 = ['a', 'b'];
const byIndex = every(x).at(i).in(xs).is().mapped().to().clone().by().multiplying(x).by(i).andThe().mapped();
same<typeof byIndex, number[]>(true);
const afterFirst = every(x).at(i).in(xs2).is().kept().if(i).is().positive().andThe().kept();
same<typeof afterFirst, string[]>(true);
const indexSum = folds().every(x).at(i).in(xs2).into(total).starting().at(0).by().adding(i).to(total).andThe().total();
same<typeof indexSum, number>(true);
const allAt = checks().if().every(x).at(i).in(xs).is().positive().andThe().answer();
same<typeof allAt, boolean>(true);
const firstAt = the().first(x).at(i).in(xs).that().is().positive().andThe().found();
same<typeof firstAt, number | undefined>(true);
const nestedAt = every(x).at(i).in(rows).is().mapped().to().clone().by().every(y).in(x).is().mapped().to().clone().by().multiplying(y).by(i).andThe().mapped();
same<typeof nestedAt, number[][]>(true);

// all().at().once() with a sync body changes nothing.
const syncTogether = every(x).in(xs).all().at().once().is().kept().if(x).is().positive().andThe().kept();
same<typeof syncTogether, number[]>(true);
