// Must not compile: a placeholder the sentence has not bound. Each `// error:` line is the code and
// message the next line must produce (test/every-types.test.mjs).
import { every, folds, item, total, x, y } from '../../../src/fluent';

const xs = [3, -1, 4];

// error: TS2345 "multiplying: y is not bound here; bind it with every(y).in(list)"
every(x).in(xs).is().mapped().to().clone().by().multiplying(y).by(2);
// error: TS2345 "if: y is not bound here; bind it with every(y).in(list)"
every(x).in(xs).is().kept().if(y).is().positive();
// error: TS2345 "adding: item is not bound here; bind it with every(item).in(list)"
folds().every(x).in(xs).into(total).starting().at(0).by().adding(item).to(total);
// error: TS2345 "in: y is not bound here; bind it with every(y).in(list)"
every(x).in(y);
// error: TS2345 "in needs a list"
every(x).in(3);
// error: TS2345 "if needs a placeholder: x, y, item or total"
every(x).in(xs).is().kept().if(3);
