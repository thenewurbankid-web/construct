// Must not compile: the index (at(i)), does() and async bodies used wrongly. Each `// error:`
// line is the code and message the next line must produce (test/every-types.test.mjs).
import { does, every, folds, i, total, x, y } from '../../../src/fluent';

const xs = [3, -1, 4];
const names = ['ada', 'grace'];
const rows = [[1], [2, 3]];

// error: TS2345 "by: i is not bound here; bind the index with every(x).at(i).in(list)"
every(x).in(xs).is().mapped().to().clone().by().multiplying(x).by(i);
// error: TS2345 "at(x): x is already bound; nested callbacks use different names"
every(x).at(x).in(xs);
// error: TS2345 "at(i): i is already bound; nested callbacks use different names"
every(x).at(i).in(rows).is().mapped().to().clone().by().every(y).at(i).in(x);
// error: TS2345 "in needs a list; i is a number"
every(x).at(i).in(rows).is().mapped().to().clone().by().every(y).in(i);
// error: TS2345 "multiplying needs a number; x is a string"
does().every(x).at(i).in(names).by().multiplying(x).by(i);
// error: TS2345 "waiting needs a number; x is a string"
does().every(x).in(names).by().waiting(x);
// error: TS2684 "waiting: only a list (every) or an effect (does) waits, not a fold or a question"
folds().every(x).in(xs).into(total).starting().at(0).by().waiting(x);
// error: TS2322 Type 'void' is not assignable to type 'number[]'.
const nothing: number[] = does().every(x).in(xs).by().multiplying(x).by(2);
// error: TS2322 Type 'Promise<void>' is not assignable to type 'void'.
const notYet: void = does().every(x).in(xs).by().waiting(x);
void nothing;
void notYet;
