# R9 every() sentences — built (commit 86e517a, branch r9-every-sentences off functional-atoms, not pushed)

- Code: src/fluent/every.ts (placeholders x/y/item/total, starts every/the/folds, checks().if() no-arg overload in index.ts).
- Data: naming.json grammar.every holds the R9 table (6 rows + js twins), starts->kind, binders, participles, gerunds, bodyAtoms.
- Body vocabulary is exactly the table: multiplying(a).by(b)=times, adding(a).to(b)=plus(b,a), is().positive()=greaterThan(v,0). Anything else needs new body words.
- Not built: molecules (declaration still open in R9), nested every(y).in(x) (no body word starts a nested sentence), the().sum().of(xs).
- Catalog conflict: `and` atom's sentence `checks().if(a).and(() => b)` starts with checks() but returns a or b, not yes/no. Grammar test lists it as NOT_YET.
- Suite: 702/702 (was 668), tsc + test:types clean.

## Update: types travel along the chain (commit 700390b, same branch)
- Branch facts: local functional-atoms is still 3d98c8a. All R9 commits, including the owner's doc commits 86c4c6d, dcc0752 and 7c9b3b3, are on r9-every-sentences only, because the doc commits were made in this worktree, where r9-every-sentences is checked out. origin/functional-atoms is 939c25c (unrelated).
- Type-level scope S (Bind<S,N,T>), string-literal errors via conditional params and `this` params, nested by().every(y).in(x) and kept().if().any/every(y), and no nesting inside a folds() body.
- Fixtures: test/types/every/{valid,invalid-*}.ts, asserted by test/every-types.test.mjs (real tsc, exact codes and messages, TS2589 guard).
- tsc: about 60-70 ms wall per fixture, 7-11 ms check, 15-19k instantiations (floor importing fluent: 14,451). Stress test with 300 sentences and 4-level nesting: 18,789 instantiations, 17 ms check, no TS2589.
- Gotcha: a layer type with a `fixed` field matched every string, because of String.prototype.fixed(). The field is renamed to `returns`.

## Update: other callback shapes (commit 5b61133)
- at(i) on all five binders; does() returns void (atoms.each); waiting(ms) = delay is the only async body word. `logging` is not built, because there is no log atom.
- Async runner in every.ts `sentence()`: sync -> list atom; async one at a time -> loop with an early stop for every/some/find, then the atom over the answers; all().at().once() -> allOf, then the atom. Fold and question bodies cannot wait.
- Placement decision (the spec doesn't say): all().at().once() goes right after in(xs).
- Suite 757/757. tsc fixtures 53-78 ms wall, 10-15 ms check; floor is now 19,627 instantiations; stress test (300 sentences plus 4-level async nesting) 23,830 instantiations, no TS2589.
