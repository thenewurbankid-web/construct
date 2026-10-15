# Atomic English, build steps 1-4 (smith-functional, branch functional-atoms)

Commits (local, not pushed): fb81674 rules doc, bf36968 naming grammar + alias map, f649a05 fluent v2 + catalog,
7beb47a grammar test, 51143a6 doc status. `npm test`: 668/668 pass.

## Counts
- 37 atoms have new sentences (every atom that had a `fluent` form): 15 questions, 12 copies, 10 other.
- 30 of them changed (old form kept as `fluentDeprecated` + @deprecated methods); 7 already followed the rules: and, when, isText, isNumber, isBoolean, isNothing, hasKey.
- 25 plain-name aliases (R8) in naming.json `grammar.plainNames` and catalog `plainName`. Data only: not exported as functions.
- 300 atoms (all 203 generated + 97 curated) have no sentence yet.

## Where things live
- `scripts/lib-sentence.mjs`: parse / reading / plainName (shared by gen-atoms and the test).
- naming.json `grammar`: verbs, questionWords, subjects, connectors, roleWords, words, argumentVerbs, plainNames.
- curated.json: `fluent` (new), `fluentDeprecated` (old), `returnsCopy`; no `reads` for fluent atoms (generator derives it).
- `test/grammar.test.mjs`: R1/R3/R4/R5 + R8 + reads, and a list of bad sentences it must reject.

## Not expressible under the rules (old forms still take them)
Trailing optional arguments: a word that carries an argument must return a plain value, so it cannot be followed by
an optional one. Lost in the sentences: hasItem fromIndex, splitBy limit, flattened depth. sortedBy / joinWith /
part take `undefined` for "none" (`sorts().by(undefined)`).

## Owner questions
1. R8 examples disagree: `clonesAndSortsBy` keeps `clones`, `replacesFirstWith` drops it, though both are copies. Built: keep clones (clonesAndReplacesFirstWith).
2. Is mapEach a copy? Built as `clones().list(xs).and().maps().each().with(fn)` (same kind of value); could be `list(xs).maps()...`.
3. R3 allows only prepositions/role nouns, but approved `when(c).yields(() => a)` puts an argument on a verb. Built: `yields` is an approved argument verb, reused by chooses/matches.
4. Words added to the role list: most/least (`is().at().most(b)`), every/first (`replaces().every(p)`), where, on, value, key, item, when, otherwise.
5. isEveryWhere -> `checks().if(xs).has().only().items().where(test)`; isA -> `is().an().instance().of(Type)`; firstOf -> `list(xs).takes().first()`; attempt -> `attempts().to(body).and().recovers().with(r).and().cleans().up().with(c)`; match -> `matches().value(v).on(k).yields(a)`. OK?
6. Export the R8 names (isGreaterThan, ...) as callable aliases, or keep them as catalog data only?
7. Sentences for the other 300 atoms: next step, before the corpus re-import?
