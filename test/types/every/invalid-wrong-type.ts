// Must not compile: a body word given a placeholder whose type does not fit. Each `// error:`
// line is the code and message the next line must produce (test/every-types.test.mjs).
import { checks, every, folds, the, total, x } from '../../../src/fluent';

const names = ['ada', 'grace'];
const xs = [3, -1, 4];

// error: TS2345 "multiplying needs a number; x is a string"
every(x).in(names).is().mapped().to().clone().by().multiplying(x).by(2);
// error: TS2345 "by needs a number; x is a string"
every(x).in(names).is().mapped().to().clone().by().multiplying(2).by(x);
// error: TS2345 "by needs a number"
every(x).in(xs).is().mapped().to().clone().by().multiplying(x).by('2');
// error: TS2684 "positive needs a number; x is a string"
every(x).in(names).is().kept().if(x).is().positive();
// error: TS2684 "positive needs a number; x is a string"
checks().if().every(x).in(names).is().positive();
// error: TS2684 "positive needs a number; x is a boolean"
checks().if().any(x).in([true]).is().positive();
// error: TS2684 "positive needs a number; x is a string"
the().first(x).in(names).that().is().positive();
// error: TS2345 "to needs a number; total is a string"
folds().every(x).in(xs).into(total).starting().at('').by().adding(x).to(total);
// error: TS2345 "adding needs a number; x is a record"
folds().every(x).in([{ price: 1 }]).into(total).starting().at(0).by().adding(x).to(total);
// error: TS2345 "multiplying needs a number; x is a mix of types"
every(x).in([1, 'a']).is().mapped().to().clone().by().multiplying(x).by(2);
