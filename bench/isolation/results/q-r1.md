# QuickJS isolation q-r1

2026-10-14. #947 (part of #941). quickjs-emscripten@0.32.0 (MIT), release-sync WebAssembly build. Coder qwen2.5-coder:1.5b. Rows: `q-r1.jsonl` (r1.jsonl's row format for the sampler setups, plus `q`); this page's other tables come from `q-r1.notes.json`. Command: see q-run.mjs header.

## 1-2. The QuickJS backend against the vm child

`bench/isolation/quickjs/compare.mjs` (2026-10-14T00:10, node v24.19.0): the logicVerify isolated tests' cases as pairs (A), the isolation tasks' services, store functions and reference pages as units and as start->reference pairs (B). Warm = median of 10 calls per case; deterministic = 20 identical results.

| group | cases | results equal | vm warm (median per call) | quickjs warm | speed-up | deterministic (vm / quickjs, 20 runs each) |
| --- | --- | --- | --- | --- | --- | --- |
| A tests | 18 | 18/18 | 49 ms | 39 ms | 1.3x | 18/18 / 18/18 |
| B tasks (pair) | 14 | 14/14 | 66 ms | 38 ms | 1.7x | 14/14 / 14/14 |
| B tasks (unit) | 20 | 20/20 | 51 ms | 14 ms | 3.7x | 20/20 / 20/20 |

Cold, a fresh node process (median of 3): vm 146 ms module load + 214 ms first call; QuickJS 153 ms + 245 ms (the WebAssembly module loads on the first call).

Results that differ: none.

### Escape attempts (both sandboxes; host file, host prototypes and the next run checked after each)

| attempt | expected | vm | quickjs |
| --- | --- | --- | --- |
| process.mainModule.require | notFaked | notFaked, blocked | notFaked, blocked |
| require('node:fs') inside the module | notFaked | notFaked, blocked | notFaked, blocked |
| import fs from 'node:fs' and dynamic import('node:child_process') | notFaked | notFaked, blocked | notFaked, blocked |
| globalThis.constructor.constructor('return process')() | thrown:EvalError | thrown:EvalError, blocked | thrown:EvalError, blocked |
| new Function / eval / async-function constructor | thrown:EvalError | thrown:EvalError, blocked | thrown:EvalError, blocked |
| a fake's own constructor: localStorage.getItem.constructor('return process')() | thrown:EvalError | thrown:EvalError, blocked | thrown:EvalError, blocked |
| the error a refused access throws, then its constructor chain | notFaked | notFaked, blocked | notFaked, blocked |
| Error.prepareStackTrace call-site objects (a V8 vm escape route) | thrown:EvalError | thrown:EvalError, blocked | thrown:EvalError, blocked |
| an infinite loop | error | error, blocked | error, blocked |
| a memory blow-up (arrays until the limit) | error | error, blocked | error, blocked |
| unbounded recursion | thrown:RangeError | thrown:RangeError, blocked | thrown:RangeError, blocked |
| prototype pollution (Object.prototype, Array.prototype.map, JSON.parse), then a clean run | thrown:none | thrown:none, blocked | thrown:none, blocked |
| the host clock and timers (Date, setTimeout, Math.random) are fixed fakes | thrown:none | thrown:none, blocked | thrown:none, blocked |

## 4. Q-plan: plan sketches on the spec examples

Sketches: `bench/isolation/plans/<task>.plan.js`, one per task, written from the goal and SPEC only (`view`), plus one deliberately wrong sketch each (`wrongView`). The examples are the task check's own fixture ids and expected strings (`quickjs/examples.mjs`). Each runs in a fresh QuickJS context.

Right sketches pass: **12/12**. Wrong sketches caught: **12/12**.

| task | plan | wrong sketch caught | how it was caught |
| --- | --- | --- | --- |
| t01-book-by-author | pass | yes | example 0: missing text "by Ines Okafor" |
| t02-book-page-count | pass | yes | example 0: missing text "312 pages" |
| t03-book-availability | pass | yes | example 0: missing text "Available" |
| t04-book-not-found | pass | yes | example 0: no link "Back to the catalogue" to / |
| t05-book-add-to-picks | pass | yes | example 0: missing text "Added to your picks" |
| t06-picks-store | pass | yes | example 0: lists [[],["a","b","a"],["b"],["x","y"]], expected [[],["a","b"],["b"],["x","y"]] |
| t07-picks-page-list | pass | yes | example 0: no button "Remove Salt and Lanterns" |
| t08-picks-page-empty | pass | yes | example 0: missing text "You have not picked any books yet" |
| t09-browse-heading-availability | pass | yes | example 0: h1 is "Books", expected "Library catalogue" |
| t10-browse-paging | pass | yes | example 0: 5 book links, expected 6 |
| t11-browse-sort-title | pass | yes | example 0: book links 15 ["River Kings -> /books/river-kings","Moss and Mycelium -> /books/moss-and-mycelium","Kestrel Street -> /books/kestrel-street"]..., expected 15 ["Bridges of Empire -> /books/bridges-of-empire","Cartographers at War -> /books/cartographers-at-war","Copper Roads -> /books/copper-roads"]... |
| t12-browse-genre-filter | pass | yes | example 0: select Genre options ["Fiction","History","Science"] |

### The 4 quick logic tasks: K2b and K5b sketches executed (inputs from exp/english-loop-chain fbce3355)

Each sketch is transpiled and run in QuickJS on the task's check examples (`chain/quick/tasks.mjs` check). References: availability pass, picks-store pass, paging pass, sort-title pass; mutants caught: 8/8.

| model | sketches | pass the examples | wrong (fail) | wrong that Smith text match accepted | right that text match rejected |
| --- | --- | --- | --- | --- | --- |
| qwen2.5-coder:7b | 20 | 20 | 0 | 0 | 13 |
| qwen2.5-coder:1.5b | 20 | 4 | 16 | 0 | 3 |

Per task (pass the examples / text match):

- qwen2.5-coder:7b: availability 5/5 exec, 5/5 text; picks-store 5/5 exec, 0/5 text; paging 5/5 exec, 0/5 text; sort-title 5/5 exec, 2/5 text
- qwen2.5-coder:1.5b: availability 0/5 exec, 0/5 text; picks-store 0/5 exec, 0/5 text; paging 3/5 exec, 0/5 text; sort-title 1/5 exec, 1/5 text

K5b (the availability formatter end to end; the coder is always the 1.5b):

| plan model | runs | Smith rule pass | plan sketch passes the examples | fill passes the examples |
| --- | --- | --- | --- | --- |
| qwen2.5-coder:7b | 5 | 5 | 5 | 5 |
| qwen2.5-coder:1.5b | 5 | 5 | 0 | 0 |

### Where Smith text match was wrong: references and r3 fills (K6) under Q-diff

K6 judged each task's reference and its r3 H+fix fill by Smith text against Claude-written Smith plans. Here the same files run in QuickJS: Q-exec on the examples, Q-diff against the plan sketch on every scenario (every fixture book, pick lists, pages, genres).

References: Q-exec 12/12, Q-diff 12/12; K6 text 7/12. Start files (must not pass Q-exec): 0/12 pass. r3 fills: r3 check 9/12, Q-exec 9/12, Q-diff 9/12; K6 text 4/12.

| task | ref Q-exec | ref Q-diff | ref K6 text | fill r3 check | fill Q-exec | fill Q-diff | fill K6 text | Q-diff note |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| t01-book-by-author | pass | pass | pass | pass | pass | pass | pass |  |
| t02-book-page-count | pass | pass | pass | pass | pass | pass | fail |  |
| t03-book-availability | pass | pass | pass | pass | pass | pass | pass |  |
| t04-book-not-found | pass | pass | pass | fail | fail | fail | fail | fill: scenario 0: no link "Back to the catalogue" to / |
| t05-book-add-to-picks | pass | pass | fail | fail | fail | fail | fail | fill: scenario 6: enabled button "Add to my picks" |
| t06-picks-store | pass | pass | fail | pass | pass | pass | fail |  |
| t07-picks-page-list | pass | pass | fail | pass | pass | pass | fail |  |
| t08-picks-page-empty | pass | pass | pass | pass | pass | pass | pass |  |
| t09-browse-heading-availability | pass | pass | pass | pass | pass | pass | fail |  |
| t10-browse-paging | pass | pass | fail | pass | pass | pass | fail |  |
| t11-browse-sort-title | pass | pass | pass | pass | pass | pass | pass |  |
| t12-browse-genre-filter | pass | pass | fail | fail | fail | fail | fail | fill: scenario 1: book links 15 ["Salt and Lanterns -> /books/salt-and-lanterns","Orchard at Night -> /books/orchard-at-night","Glass Harbou |

## 3. Q-exec in the sampler (H+fix best-of-5, paired draws)

Q-exec runs each candidate of the task's final function in QuickJS on the examples, before tsc and the check, and drops it on a failed example. A bundle that does not build or a ReferenceError (a missing import the importFixer may still add) is cant-tell and goes on to tsc. Both setups judge the same samples (the coder's replies are cached by prompt and seed).

| setup | pass | samples drawn | non-model time (splice, Q-exec, workspace, tsc, fixer, check) | model time | fails |
| --- | --- | --- | --- | --- | --- |
| H+fix | 8/12 | 40 | 36.8 s | 54 s (first draw) | check 2, fragment 1, tsc 1 |
| Q-exec | 8/12 | 40 | 23.8 s | 54 s (first draw) | q-exec 3, fragment 1 |

Final-function candidates run in QuickJS: 33 (of 38 drawn; the rest did not splice). Dropped early: **15** (45% of those run), cant-tell 9. QuickJS time: 0.45 s in all (median 12 ms per candidate). Non-model time saved: 13.0 s (35%).

| task | H+fix | Q-exec | Q-exec per candidate (verdict: first reason) |
| --- | --- | --- | --- |
| t01-book-by-author | pass (2) | pass (2) | cant-tell: ReferenceError: 'id' is not defined; pass |
| t02-book-page-count | pass (1) | pass (1) | pass |
| t03-book-availability | fail check (5) | fail q-exec (5) | fail: scenario 0: missing text "Available"; fail: scenario 0: missing text "Available"; fail: scenario 0: missing text "Available"; fail: scenario 0: missing text "Available"; fail: scenario 0: missing text "Available" |
| t04-book-not-found | fail check (5) | fail q-exec (5) | cant-tell: ReferenceError: 'id' is not defined; fail: scenario 0: no link "Back to the catalogue" to /; fail: scenario 0: no link "Back to the catalogue" to /; fail: scenario 0: no link "Back to the catalogue" to /; fail: scenario 0: no link "Back to the catalogue" to / |
| t05-book-add-to-picks | fail fragment (5) | fail fragment (5) | cant-tell: ReferenceError: 'id' is not defined; cant-tell: ReferenceError: 'id' is not defined; cant-tell: ReferenceError: 'id' is not defined; cant-tell: ReferenceError: 'setStatus' is not defined |
| t06-picks-store | pass (3) | pass (3) | pass |
| t07-picks-page-list | pass (4) | pass (4) | pass |
| t08-picks-page-empty | pass (5) | pass (5) | cant-tell: ReferenceError: 'cartProducts' is not defined; cant-tell: ReferenceError: 'cartProducts' is not defined; cant-tell: ReferenceError: 'cartProducts' is not defined; fail: scenario 0: h1 is "You have not picked any books yet", expec; pass |
| t09-browse-heading-availability | pass (1) | pass (1) | pass |
| t10-browse-paging | pass (3) | pass (3) | fail: scenario 0: no button "Previous page"; fail: scenario 0: no button "Previous page"; pass |
| t11-browse-sort-title | pass (1) | pass (1) | pass |
| t12-browse-genre-filter | fail tsc (5) | fail q-exec (5) | fail: scenario 0: no select labelled "Genre"; pass; fail: scenario 0: no select labelled "Genre"; fail: scenario 0: no select labelled "Genre" |

## 5. Q-diff: each candidate against the plan sketch, beside Smith text match and the check

Census: all 5 samples of each task's final function (same draws). correct = tsc clean and the task check passes (after the importFixer). Smith text match = the fill's canonical Smith sentences equal the reference's (lsp-r3 L-gate-canon). Q-diff = the candidate and the plan sketch show the same View on every scenario (pages: heading, lines, book links, buttons, selects, picks; never the JSX).

Candidates: 53 (24 correct). Correct fills text match rejects but Q-diff accepts: **23**. Wrong fills Q-diff catches that text match misses: **0**. Q-diff errors: 0 correct fills rejected, 3 wrong fills accepted. Text match accepted 0. Q-exec dropped 0 correct fills.

| task | samples | correct | text rejects, Q-diff accepts (correct) | Q-diff catches, text accepts (wrong) | Q-diff rejects a correct fill | Q-diff accepts a wrong fill | wrong: tsc / check |
| --- | --- | --- | --- | --- | --- | --- | --- |
| t01-book-by-author | 5 | 4 | 4 | 0 | 0 | 0 | 1 / 0 |
| t02-book-page-count | 5 | 5 | 5 | 0 | 0 | 0 | 0 / 0 |
| t03-book-availability | 5 | 0 | 0 | 0 | 0 | 0 | 1 / 4 |
| t04-book-not-found | 5 | 0 | 0 | 0 | 0 | 0 | 1 / 4 |
| t05-book-add-to-picks | 4 | 0 | 0 | 0 | 0 | 0 | 4 / 0 |
| t06-picks-store | 5 | 3 | 3 | 0 | 0 | 2 | 2 / 0 |
| t07-picks-page-list | 2 | 2 | 2 | 0 | 0 | 0 | 0 / 0 |
| t08-picks-page-empty | 5 | 1 | 0 | 0 | 0 | 0 | 4 / 0 |
| t09-browse-heading-availability | 5 | 5 | 5 | 0 | 0 | 0 | 0 / 0 |
| t10-browse-paging | 3 | 1 | 1 | 0 | 0 | 0 | 0 / 2 |
| t11-browse-sort-title | 5 | 3 | 3 | 0 | 0 | 0 | 0 / 2 |
| t12-browse-genre-filter | 4 | 0 | 0 | 0 | 0 | 1 | 4 / 0 |

Q-diff disagreements with the check:

- t06-picks-store sample 3: check tsc, Q-diff pass
- t06-picks-store sample 5: check tsc, Q-diff pass
- t12-browse-genre-filter sample 2: check tsc, Q-diff pass

## Notes and caveats

- Smith text match (canonical Smith of the fill vs the reference's) accepted 0 of 53 census candidates, as in lsp-r3 (25/25 rejected). So "wrong fills Q-diff catches that text match misses" is 0 by construction: text match never accepts. Every correct fill Q-diff could run (23 of 24) was accepted by Q-diff and rejected by text match.
- The 3 wrong fills Q-diff accepted all fail tsc only (t06 x2, t12 x1): their behaviour matches the plan; the type error is what makes them wrong. Q-diff is a behaviour check and runs beside tsc, not instead of it.
- Census Q-diff ran on the fill before the importFixer, so 11 candidates were cant-tell (a ReferenceError for a name the fixer imports later, such as `Button`); one of them (t08 sample 5) is correct.
- Q-exec dropped no correct fill: the pass rate is the same (8/12), and the time saved is the tsc + check runs of the 15 dropped candidates (35% of non-model time). Model time is equal by construction (paired draws).
- Two of the 12 references (t05, t06) had been read during the backend work, before the plan-sketch step was assigned; the sketches were written from goal and SPEC.
- QuickJS limits: no Intl; URL, URLSearchParams, TextEncoder and TextDecoder are small guest polyfills (guest.mjs). The fakes share the unit's realm, so a unit that overrides a built-in (Array.prototype.push, JSON) can skew its own run's records; nothing leaks to the host or the next run (escape table).
- vm quirks, not QuickJS differences: on the vm path `process` reads as ReferenceError and `globalThis.WebSocket` returns undefined instead of throwing (both still list notFaked, so the verdict is the same).

## Verdict

Ship QuickJS as an opt-in sandbox (`sandbox: 'quickjs'`) and as the Q-exec / Q-diff executor now: results equal the vm child on 52/52 cases, all 13 escape attempts are blocked, it is deterministic, 1.3x to 3.7x faster warm, and it needs no child process or node permission flags. Do not flip the logicVerify default from vm yet: the per-context bootstrap (about 4 ms) dominates, Intl is missing, and the fakes share the unit's realm.
