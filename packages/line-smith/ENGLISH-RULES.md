# Atomic English: grammar rules for Smith atoms (draft, 2026-10-14)

Status: approved by the owner. Build-order steps 1-4 are built (2026-10-15): the 37 atoms that had a fluent
form now have Atomic English sentences, checked by `test/grammar.test.mjs`. The other 300 atoms have no sentence yet.
R9 is built (2026-10-15) for its table (map, filter, every, some, find, and the `folds()` reduce) and nested
`every(y).in(x)`, the index `at(i)`, `does()` and async bodies (one at a time, or `all().at().once()`), in
`src/fluent/every.ts`, with types travelling along the chain (fixtures in `test/types/every/`). Not built yet: molecules
(bodies longer than one atom), and `logging` (no log atom exists).

Owner, 2026-10-14: "incorporate English grammar into the design, like functions are `compares()` instead of
`compare()`, and `checks().if()`, and multiple arguments get a description like
`checks().if(subject).is().greater().than(100)`"; "third person everywhere, and for ones that return a copy,
`clones().and().compares()`".

## Decisions so far (owner, 2026-10-14)

1. **Where the grammar applies:** the fluent layer (`smith/fluent`) and the names of new atoms. Existing atom names
   stay as aliases, so the catalog, the codemod, the dataset and Construct's `@line/atoms` pin keep working.
2. **What Import v2 writes into an app (revised by the owner, 2026-10-15):** the app keeps its original typed code;
   that is what runs, is typed and is debugged. The fluent layer is built from the JS reference and shown as a
   generated, read-only English view of the code (also the English context for the small model). Sentences can still
   run where a developer chooses to write them, so the runtime layer (R9 placeholders, chain types) stays. Supersedes
   the earlier "writes the fluent sentence, for example `checks().if(n).is().greater().than(100)`, not the plain call".
3. **Verbs:** third person singular everywhere.
4. **Copies:** an atom that returns a changed copy starts its sentence with `clones()`, before the subject, for
   every kind of value, text and numbers included: `clones().text(s).and().trims()`.

## The rules

**R1. Verbs are third person singular.** `compares`, `joins`, `sorts`, `trims`, `parses`, `sends`, `waits`.
Never the base form (`compare`, `join`) and never a past participle (`sorted`, `trimmed`) in a fluent chain, except
inside an `every()` sentence (R9).

**R2. A sentence starts with a third-person verb or its subject.** Verbs: `checks()`, `clones()`, `when()`,
`chooses()`, `matches()`, `attempts()`. Subjects: `text(s)`, `list(xs)`, `number(n)`, `date(d)`, `record(o)`,
`map(m)`, `set(s)`. After `checks()` or `clones()` the subject comes next.

**R3. One argument per word, and the word names its role.** No fluent method takes more than one argument. The word
that carries an argument is a preposition or a role noun: `if(subject)`, `than(x)`, `to(x)`, `by(order)`,
`with(x)`, `from(x)`, `at(index)`, `of(x)`, `between(low).and(high)`, `first(pattern)`, `days(n)`.

**R4. Questions use `is`, `has`, `can` or `does`, split into words.** `is().greater().than(x)`,
`is().equal().to(x)`, `is().not().empty()`, `has().key(k)`. The comparison word and its preposition are separate
calls, so each argument sits after the word that names it (R3). Inside an `every()` sentence (R9), `is()` also
introduces what happens to each item, as in `is().mapped()`, and that clause returns a list, not a yes or no.

**R5. A copy is said out loud, first.** An atom that returns a changed value and leaves its input alone reads
`clones().<subject>.and().<verb>()`: `clones().list(xs).and().sorts().by(order)`,
`clones().text(s).and().trims()`. This holds for every kind of value, text and numbers included (owner,
2026-10-14). An atom that really changes its input in place starts with the subject and has no `clones()`:
`list(xs).sorts().by(order)` sorts `xs` itself. Questions (R4) return a yes or no, not a copy, so they never take
`clones()`. In an `every()` sentence (R9) the copy is said where it happens, as `to().clone()`, not first.

**R6. Connectors join clauses and carry no argument except `if`.** `and()`, `then()`, `also()`, `but()`,
`otherwise()`.

**R7. Every chain still ends in a plain value and calls exactly one atom.** This is the guarantee `smith/fluent`
already holds; `test/fluent.test.mjs` keeps checking it.

**R8. Plain names for new atoms follow the chain.** The plain name is the chain's words after the subject, joined in
camelCase, with arguments in the order they appear: `isGreaterThan(n, 100)`, `clonesAndSortsBy(xs, order)`,
`replacesFirstWith(s, pattern, replacement)`. Existing names (`greaterThan`, `sortedBy`, `replaceFirst`) stay as
aliases in `naming.json`.

**R9. Arrow functions become `every()` sentences (owner, 2026-10-15).** A callback is not written as an arrow. The
item gets a name with `every(x)`, the list follows with `in(xs)`, and the body is a chain of atoms on `x`:

| Plain JS | Fluent today | Atomic English |
|---|---|---|
| `xs.map((x) => x * 2)` | `list(xs).maps().each((x) => x * 2)` | `every(x).in(xs).is().mapped().to().clone().by().multiplying(x).by(2)` |

Owner's wording, kept as written apart from the spelling of `multiplying`. In this form, past participles
(`mapped`) and `-ing` forms (`multiplying`) are allowed (R1), `is()` starts the action (R4), and the copy is said as
`to().clone()` where it happens (R5). Sentences outside `every()` keep R1, R4 and R5 unchanged, so the 37 existing
sentences and `test/grammar.test.mjs` still hold.

**The first word decides what the sentence returns (owner, 2026-10-15).** `checks()` returns a yes or no,
`every(x).in(xs)` returns a list, `the().first(x).in(xs)` returns one item, `folds()` returns one value. Never a word deep in the chain: the parser,
the grammar test and a small model read only the first word to know the kind, so no list of adjectives versus
participles is needed as atoms grow.

| Plain JS | Atomic English |
|---|---|
| `xs.map((x) => x * 2)` | `every(x).in(xs).is().mapped().to().clone().by().multiplying(x).by(2)` |
| `xs.filter((x) => x > 0)` | `every(x).in(xs).is().kept().if(x).is().positive()` |
| `xs.every((x) => x > 0)` | `checks().if().every(x).in(xs).is().positive()` |
| `xs.some((x) => x > 0)` | `checks().if().any(x).in(xs).is().positive()` |
| `xs.find((x) => x > 0)` | `the().first(x).in(xs).that().is().positive()` |

**`reduce` (owner, 2026-10-15):** the common reductions (sum, count, join, group-by) are named atoms the converter
picks, as in `the().sum().of(xs)`. Any other `reduce` starts with `folds()`, the first word for "one value":
`xs.reduce((total, x) => total + x, 0)` reads
`folds().every(x).in(xs).into(total).starting().at(0).by().adding(x).to(total)`.

**The other callback shapes (owner, 2026-10-15):**
- *Index:* `xs.map((x, i) => …)` reads `every(x).at(i).in(xs)…`; `i` is an imported placeholder, typed `number`.
- *Effects only:* withdrawn by R11 (effects are not in the library). It was `does().every(x).in(xs)…`, the first
  word for "returns nothing".
- *Async:* an async body makes the chain return a Promise and run **one at a time** by default; parallel is said
  out loud with `all().at().once()`. The converter writes `all().at().once()` for `Promise.all(xs.map(async …))`, so
  behaviour matches the original.
- *Early return:* a branch, so more than one atom: a molecule using `when().yields().otherwise()`.
- *`this`:* the converter rewrites it as an explicit parameter when its value is provable (class method, `.bind(obj)`,
  object-literal method); otherwise it refuses and the developer gets a diff.

First words are now five, each with one result kind: `checks()` yes/no, `every()` list, `the().first()` one item,
`folds()` one value, `does()` nothing.

**`to().clone()` copies the list, not the items (owner, 2026-10-15).** It says out loud that `xs` is left alone (R5),
exactly as `map` behaves; each item of the new list is whatever the body returns. A deep copy of the items is a
separate atom (`structuredClone`), never implied by `clone()`.

How it runs, with no build step: `x` is a placeholder from `smith/fluent`. `multiplying(x).by(2)` records the steps
instead of computing them, and `every(x).in(xs)` turns the record into `(v) => v * 2` when the chain runs. The body
can only use atoms, never raw JS, which keeps R7.

**Placeholders are imported (owner, 2026-10-15):** `import { x, y, item, total } from 'smith/fluent'`. No strings, so a
typo is a compile error; nested callbacks use different names (`every(x).in(rows)…every(y).in(x)…`); TypeScript learns
the item type at `.in(xs)`, so the body after it is typed.

**Types travel along the chain (owner, 2026-10-15).** `x` has the type `Placeholder<'x'>` and only names a slot.
`every(x)` records `'x'`; `.in(xs: T[])` binds `'x'` to `T` in a type-level map carried by the chain; each body method
looks its placeholder up there and exists only when the type fits, so `every(x).in(names)…multiplying(x)` is a `tsc`
error at the call site. Nested callbacks add to the map (`every(y).in(x)` binds `y` to the item type of `x`);
molecules are typed functions checked the same way. A wrong type reads as a string-literal message, e.g.
`"multiplying needs a number; x is a string"`. Checked by compiling and non-compiling fixtures. Watch: `tsc` time and
TypeScript's instantiation-depth limit on long chains (kept short because long bodies are molecules).

**Bodies longer than one atom become named molecules (owner, 2026-10-15).** `x => x.price * qty` is not chained in
place and is not a new Smith atom: it becomes a molecule in the app, named for its use case (`lineTotal`), composed of
existing atoms; larger flows are organisms. The sentence calls it by name. Smith's catalog only grows with real atoms,
and only new atoms need the owner's approval. A molecule or organism built only from approved atoms needs no approval,
once tests show it matches the original JS. Open: how a molecule is declared (e.g. a `defineMolecule` factory).

**The gate for accepting a molecule without approval (owner, 2026-10-15).** All six checks are deterministic:
1. *Only approved parts:* a static check that the body calls only approved atoms or already-accepted molecules; no
   raw operators, no globals.
2. *Same results:* a fast-check property test of the original JS against the molecule, 1,000 seeded runs, plus a
   fixed edge-case set per input type: numbers `0`, `-0`, `NaN`, `±Infinity`, `MAX_SAFE_INTEGER`, fractions; text
   `''`, whitespace, emoji and surrogate pairs; lists `[]`, one item, duplicates, holes; objects with a missing key,
   `null`, `undefined`; an invalid `Date`.
3. *Same behaviour:* the same error type thrown, inputs changed the same way (deep compare afterwards), impure atoms
   called in the same order. A pure original needs a pure molecule (the catalog's `pure` flag).
4. *Same types:* the molecule's TypeScript signature equals the original's inferred input and output types.
5. *Deterministic:* two runs with the same seed give the same answer.
6. *No duplicates:* the molecule's shape, with parameter names normalised, is hashed; a match reuses the existing
   molecule instead of adding a new one.

A molecule that fails any check is not dropped and does not go to the owner: it goes to the developer as a reviewable
diff, with the failing seed and the counterexample.

**Level and placement: static plus a small model (owner, 2026-10-15).** A unit's level is decided by complexity,
functionality and semantic relevance to the block it is in.
- *Static (deterministic)* measures the shape (steps, branches, effects, number of purposes) and gives a candidate
  level: a molecule is 2-5 atom steps with at most one branch and one purpose; beyond that, composing molecules, or
  with effects, it is an organism. Thresholds are tunable.
- *A small model answers one closed question:* given the unit's Atomic English, its name and the block's purpose
  sentence, does it `belongs`, need to be `separate`, or need a `split`? The answer must be one of the three, and a
  `split` must name split points that exist in the shape (deterministic check).
- Static sets the level, the model sets placement; when they disagree, the unit goes to the developer as a diff.
- The model runs in shadow until it beats a static-only baseline on a labelled set; until then placement is static.
- *A block's purpose (owner, 2026-10-15):* one sentence in a fixed shape (third-person verb + object, R1). It comes
  from the Trace path step that created the block, which records why it exists. With no Trace path, it is derived
  deterministically from the block's name and the English of the atoms it uses, e.g. "lineTotal: multiplies price by
  quantity", which says what the block does, not why. Doc comments are not used.

**R10. Every sentence ends by naming what it returns (owner, 2026-10-15).** The last words are
`andThe().<name>()`, where `<name>` is the returned value's name and says what it is:
`clones().text(s).and().lowercases().andThe().lowercased()`. The name is
- the verb's past participle when the sentence returns the changed thing: `trimmed`, `sorted`, `replaced`, `mapped`,
  `kept`, `joined`, `found`;
- a noun when it returns something else: `answer` for every question (R4), `parts` for a split, `first` and `last` for
  an item taken from a list, `total` for a fold, `index`, `length`, `count`;
- `chosen` for `when()` and `chooses()`, `matched` for `matches()`, `result` for `attempts()`.

The name is decided by rules, not chosen per atom: the participle comes from the sentence's last content verb
(`naming.json` `grammar.participles` for irregular ones, `finds` -> `found`); a question always ends in `answer`; the
exceptions are one table, `grammar.returnNames` (`splits` -> `parts`, `drops().duplicates()` -> `deduplicated`). The
first word still decides the kind of value (R9); R10 names it. R7 holds: the chain still calls exactly one atom, and
`.<name>()` returns the plain value. Inside an `every()` body, steps are not sentences and take no return clause; the
`every()` sentence itself does: `every(x).in(xs).is().mapped().to().clone().by().multiplying(x).by(2).andThe().mapped()`.

**R11. Atoms, molecules and organisms are pure (owner, 2026-10-15).** A unit in the library never changes its inputs,
never reads anything it is not given, and never has an effect. Same inputs, same result.
- *In-place built-ins become copies:* `m.set(key, value)` is `new Map(m).set(key, value)`, said with `clones()`
  (R5): `clones().map(m).and().creates().at(key).to(value).andThe().created()` (the atom `withEntry`). A built-in
  that cannot be copied (`WeakMap.set`, `WeakSet.add`) is not in the library, nor is any member that returns nothing.
- *What a unit reads is passed in:* the clock, a random source, the locale and the time zone are parameters
  (`now(clock)`, `random(source)`). Members that read the machine's locale or time zone (`toLocaleString`,
  `getHours`, `new Date(y, m, d)`) are not in the library; their UTC or explicit forms are.
- *Effects stay outside the library:* `forEach` for its effects, timers, network, storage, logging and `does()`
  sentences belong to app code. The R9 `does()` first word is withdrawn.
- R5's in-place form (a subject with no `clones()` that changes its input) no longer occurs in the library.
- Enforced statically: `gen-atoms` excludes members the TypeScript lib shows as impure, in-place or returning nothing,
  and refuses to write a catalog with any atom marked `mutates` or impure; approving an `in-place` or `effect` atom
  is refused.
- The codemod never puts a pure atom where the original code mutates: that changes what the code does. A mutating
  call stays as written and is reported (`untranslated`, reason `mutates`), so restructuring it (building the value
  with a fold, say) is a reviewed step, never a silent one.

## Examples with real atoms

| Atom today | `reads` today | Fluent today | Fluent under these rules |
|---|---|---|---|
| `equals(a, b)` | a equals b | `checks().if(a).is().equalTo(b)` | `checks().if(a).is().equal().to(b)` |
| `greaterThan(a, b)` | a is greater than b | `checks().if(a).is().greaterThan(b)` | `checks().if(a).is().greater().than(b)` |
| `sortedBy(xs, order)` | list sorted by order | `list(xs).sortedBy(order)` | `clones().list(xs).and().sorts().by(order)` |
| `replaceFirst(s, p, r)` | text with the first pattern replaced | `text(s).replaceFirst(p, r)` | `clones().text(s).and().replaces().first(p).with(r)` |
| `trimmed(s)` | text without surrounding spaces | `text(s).trimmed()` | `clones().text(s).and().trims()` |
| `joinWith(xs, sep)` | list joined with sep | (none) | `list(xs).joins().with(sep)` (a new text, not a copy of the list) |
| `addDays(d, n)` | date plus n days | (none) | `clones().date(d).and().adds().days(n)` |
| `daysBetween(a, b)` | days from a to b | (none) | `checks().days().between(a).and(b)` |
| `when(c, a, b)` | when c, a, otherwise b | `when(c).yields(a).otherwise(b)` | unchanged: already third person |

## How the rules are checked

A grammar test reads every catalog `fluent` form and fails on:
- a verb not in third person (a word list built from the catalog plus a small irregular list);
- a call that takes more than one argument;
- an argument whose word isn't a preposition or a role noun from the allowed list;
- a copy-returning atom whose chain doesn't start with `clones()` followed by its subject and `and()`;
- an in-place atom (`mutates: true`) or a question whose chain has `clones()`.

## Build order (after the owner approves these rules)

1. `naming.json`: add the grammar section (verb list, role words) and the alias map from old to new names.
2. `smith/fluent` v2: the new word classes. The current forms stay as deprecated aliases for one release.
3. Regenerate the catalog: each atom's `fluent` becomes the new sentence, and `reads` follows it.
4. Add the grammar test.
5. atomic-codemod: `toAtoms` can write the fluent form, not only the plain call.
6. Construct: bump the `@line/atoms` pin, and have `line.import.writeAtoms` write fluent sentences.
7. Re-import the full JS corpus (`atomic-codemod-atoms/bench/atoms/js-reference/`) and measure what converts, what is
   refused, and how readable the output is.

## Proposed, not decided: declarations and reads as sentences (owner, 2026-10-15: "not yet")

Idea: `a().new('price').is().equal().to(100)` declares, `a().changing('total').starts().at(0)` declares a variable
that can change, `the('total').becomes(…)` assigns, and `the('price')` reads. A function call can't create a variable
in its caller, so this only works as a compiled form: a Babel plugin turns the sentences into `const` / `let` /
assignment / plain names before the code runs (with source maps), and the converter writes them from plain code.
Reading through `the()` means editors never see an undeclared name. Open costs: a build step for every run, and a
TypeScript plugin so `the('price')` keeps its type in the editor. Would become rules R9 (declarations) and R10 (reads).
