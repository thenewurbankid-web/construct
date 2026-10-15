// Must not compile: the index (at(i)) used wrongly. Each `// error:`
// line is the code and message the next line must produce (test/every-types.test.mjs).
import { every, i, x, y } from '../../../src/fluent';

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
