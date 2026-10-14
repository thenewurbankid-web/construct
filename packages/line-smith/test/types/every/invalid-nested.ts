// Must not compile: nested callbacks whose scope does not fit. Each `// error:` line is the code and
// message the next line must produce (test/every-types.test.mjs).
import { every, folds, total, x, y } from '../../../src/fluent';

const xs = [3, -1, 4];
const rows = [['a'], ['b', 'c']];

// error: TS2345 "in needs a list; x is a number"
every(x).in(xs).is().mapped().to().clone().by().every(y).in(x);
// error: TS2345 "every(x): x is already bound; nested callbacks use different names"
every(x).in(rows).is().mapped().to().clone().by().every(x);
// error: TS2345 "any(x): x is already bound; nested callbacks use different names"
every(x).in(rows).is().kept().if().any(x);
// error: TS2345 "multiplying needs a number; y is a string"
every(x).in(rows).is().mapped().to().clone().by().every(y).in(x).is().mapped().to().clone().by().multiplying(y).by(2);
// error: TS2684 "positive needs a number; y is a string"
every(x).in(rows).is().kept().if().any(y).in(x).is().positive();
// error: TS2684 "every: a fold's body is one atom on its total, not a nested sentence"
folds().every(x).in(xs).into(total).starting().at(0).by().every(y);
// error: TS2345 "into(x): x is already bound; nested callbacks use different names"
folds().every(x).in(xs).into(x);
