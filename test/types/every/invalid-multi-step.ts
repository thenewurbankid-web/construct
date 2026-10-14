// Must not compile: a body longer than one atom. It becomes a named molecule in the app, made of
// existing atoms (R9), so nothing chains after the body word and a placeholder is never a plain
// value. These are TypeScript's own messages, not string literals: see test/every-types.test.mjs.
import { plus } from '../../../src/atoms';
import { every, x } from '../../../src/fluent';

const xs = [3, -1, 4];

// error: TS2339 Property 'and' does not exist on type 'number[]'.
every(x).in(xs).is().mapped().to().clone().by().multiplying(x).by(2).and();
// error: TS2769 No overload matches this call.
every(x).in(xs).is().mapped().to().clone().by().multiplying(x).by(plus(x, 1));
// error: TS2362 The left-hand side of an arithmetic operation must be of type 'any', 'number', 'bigint' or an enum type.
every(x).in(xs).is().mapped().to().clone().by().multiplying(x).by(x * 2);
