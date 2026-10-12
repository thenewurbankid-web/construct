# Pilot gaps (M1 pilot, 12 Oct 2026)

Two pilot builds of the e-commerce MVP, Line arm only, Auto mode (ct1 "Let Auto approve in this session", enabled
for the bench projects only), `plan-cli` as the only write path, the same prompt (`BUILDER-PROMPT.md` with `SPEC.md`).
The output is the gap list, not a score. Tags: **line-gap** (a tool or step Line lacks, or a refusal with no usable
fix), **model-gap** (the model misused a tool that exists, or wrote bad arguments or code), **harness** (the bench's
own driver or prompt was wrong; fixed), **unclear**.

Logs: `runs/<pilot>/logs/calls.jsonl` (every plan-cli call), `runs/pilot-qwen-7b/logs/turns.jsonl` (per turn),
`results/<pilot>.json` (metrics), `results/pilot-qwen-7b.tokens.jsonl` (per-turn tokens). Read a run with
`node bench/ecommerce/driver/call-summary.mjs runs/<pilot>/logs/calls.jsonl`. (`runs/` is not committed.)

Acceptance baseline: the starter passes 0 of the 22 acceptance tests (every test runs and fails).

## 1. qwen2.5-coder:7b (local, Ollama)

| | |
| --- | --- |
| Budget | 30 minutes or 200 turns; it stopped at 200 turns after 4.5 minutes (avg 1.3 s per turn) |
| Turns | 200 (every tool call written as text JSON, none as a native tool call; the harness parses them) |
| Tokens | 975,340 in, 9,735 out (Ollama `prompt_eval_count` / `eval_count`), $0 |
| Plan | 2 steps added, 2 landed (line.baseOn, line.setCode), 192 refused when added (189 of them the same call) |
| Validate | 0 errors, 10 warnings (the starter's own) |
| Acceptance | 0 of 22 (`next build` fails on its one rewritten page, see Q6); tsc 1 error |
| Verdict | Too weak by the owner's rule: fewer than 3 landed steps, and model-gaps are most of the list. Haiku ran. |

An earlier attempt (`runs/pilot-qwen-7b-attempt1`, 38 turns) was stopped after it found gap Q1; it was rerun once
that refusal was fixed.

| # | Tag | What it tried | Tool or step, and Construct's answer | Rule / code |
| --- | --- | --- | --- | --- |
| Q1 | line-gap (fixed) | `line.createFeature` with `points` as one numbered string | Refused with "points must be a non-empty string", which it was, so the model could not correct itself (37 identical retries). Now: "points must be a JSON list of 1 to 50 non-empty strings, like [...]"; the model corrected itself on the next turn. | BAD_ARGS |
| Q2 | model-gap | `line.createFeature` for catalog, which the starter already has | Refused; the sentence names the fix (setCode on its spec.md); the model moved on | NAME_TAKEN |
| Q3 | model-gap | `line.setCode` on an existing page without its hash | Refused; it read the file and retried with the hash; landed | STALE |
| Q4 | model-gap, with a line-gap part | `line.addRoute {"route": "/", "page": "catalog"}` and `"page": "ListPage"`, alternating, 189 times | Refused: "name a file like features/<feature>/pages/<Name>.tsx". The model never put the path together. Line part: the refusal carries no closed options; it could list the feature pages that exist ("features/catalog/pages/ListPage.tsx") as typed fixes, which a 7B model can pick. | UNKNOWN_ITEM |
| Q6 | line-gap | `line.setCode` of its catalog page importing `'library/pages/ListPage'` (a bare path the tsconfig does not map) | **Landed**: validate and the file check passed, but the import does not resolve, so `tsc` fails and `next build` fails. `line.setCode` runs no type check (line.setFragment does when the project has a tsconfig), so a step can land code that does not compile. | TS2307 after landing |
| Q5 | model-gap | Named its catalog page `ListPage`, the library page's own name | Landed (the name is allowed), but it shadows the library name in the page's import | – |

## 2. Claude Haiku (subagent, model "haiku")

| | |
| --- | --- |
| Budget | 30 minutes; it stopped by itself after 7 minutes (00:15:37 to 00:22:30 UTC) |
| Turns | 52 tool uses (about 75 plan-cli commands; 143 log lines including Auto's approvals) |
| Tokens | 149,127 total as reported by the orchestrator at completion; no input, output or cache split was reported, so the cost is a range: $0.015 (all input) to $0.075 (all output) at Haiku 5.5 list prices, $0.15 to $0.75 at Haiku 4.5 |
| Plan | 33 change steps added, 31 landed, 2 refused at run (then left as is), 3 refused when added; 0 typed fixes applied |
| Landed by tool | line.setCode 17, line.baseOn 6, line.addRoute 5, line.createFeature 3 |
| Validate | 0 errors, 18 warnings (PAGE-008 7, COMPONENT-005 6, PAGE-001 4, COMPONENT-006 1) |
| Library reuse | 6 of 6 feature components and pages based on a library item; logic went to library services and usecases |
| Direct writes | 0 (every changed file was written by a landed plan step) |
| Acceptance | **22 of 22** (`run-acceptance.sh`, production build, one worker); tsc 0 errors; 394 lines of code in 23 files |

| # | Tag | What it tried | Tool or step, and Construct's answer | Rule / code |
| --- | --- | --- | --- | --- |
| H1 | line-gap | A cart link on every page, in the root layout `app/layout.tsx` | `line.setCode` refused: Line writes only library and feature files. No Line tool changes the app shell (layout, providers, global nav). It put a CartLink in each of the five pages instead (duplication the layout would avoid). | UNKNOWN_ITEM |
| H2 | line-gap | ProductPage calling the library cart service | Refused at run: "page imports a forbidden application layer". No typed fix was offered (the option had no step). It found the Line way itself: a feature usecase that calls the service, imported by the page. | PAGE-003 |
| H3 | line-gap | Library CartLink reading the cart store | Refused at run: "component imports application logic". No typed fix. It moved the read to a library usecase and made CartLink take a count prop. | COMPONENT-003 |
| H4 | line-gap + harness (fixed) | Apply the fix run-next offered for H2 and H3 | The options were `{id: "fix", sentence}` with no `step` or `fixId`, while plan-cli and the plan service both said "add one of its fixes with args.fixOf". The plan service's NEEDS_YOU sentence still says it (Line); plan-cli now says "Construct offers no typed fix for this" when none exists (harness). | NEEDS_YOU |
| H5 | harness (fixed in the next prompt) | JSON args from a file with `'$(cat file)'` | The pilot prompt suggested single quotes around `$(...)`, which the shell does not expand | BAD_JSON |
| H6 | model-gap | `line.createFeature` for catalog (exists) | Refused with the fix in the sentence; it used setCode on the spec | NAME_TAKEN |
| H7 | unclear | `run-next` with nothing ready | "The plan is done, so no step runs." Harmless | PLAN_STATE |

## Line gaps both pilots hit

- **Refusals without typed fixes.** Every refusal a builder could not get past alone had no `options[].step`: Q4
  (UNKNOWN_ITEM on addRoute: no list of the feature pages to pick from), H2 (PAGE-003), H3 (COMPONENT-003). LINE.md asks
  for a typed fix on every Construct error; the new build tools' refusals and these two layer rules have none.
- **Feature already in the starter.** Both tried `line.createFeature` for `catalog` (the New Line project flow makes a
  first feature with a placeholder spec). Recovered from the sentence both times; a `line.setSpec` or a createFeature
  that fills an empty placeholder spec would remove the step.

Hit by one pilot only:

- **`line.setCode` lands code that does not compile** (Q6, Qwen): no type check runs on a whole-file write, so the
  plan said "landed" while `tsc` and `next build` failed. setFragment already type-checks; setCode should too
  (refuse with the TS error as the sentence, and an import-path fix as the typed fix).

Only Haiku got far enough to hit these (Qwen stopped at the first route):

- **No tool for the app shell** (H1): the root layout, shared providers and global navigation sit in `app/`, which no
  Line tool writes. Needed for CART-1 ("every page shows Cart (n)").
- **The cart is cross-feature state** that every feature needs; the only legal home is the library
  (`library/services`, `library/usecases`). It worked, but the library now holds app-specific logic; the layers wave
  should say where shared app state belongs.
- **COMPONENT-005 / PAGE-008 warnings on every list and conditional** (also on the starter's own Radix components):
  they ask for `@expression` units, and the Line layout has no `expressions` kind, so a builder cannot satisfy them.

## Harness changes made because of the pilot

- `planTools.mjs`: the `strings` argument type says what it wants (Q1), with a test in `test/line-build-tools.test.mjs`.
- `plan-cli.mjs run-next`: names `options[].step` only when one exists (H4).
- Haiku's prompt: JSON args inline (H5); the committed BUILDER-PROMPT.md never suggested `$(cat ...)`.

## 3. After `bench-gaps`: Haiku again, same harness (12 Oct)

Same procedure (`new-run.sh`, `print-prompt.mjs line`, a Haiku subagent with plan-cli only, 30 minutes). The prompt
now names `line.setLayoutSlot` and says to add `fixes[0].step` when `add` refuses with fixes.

| | Pilot 1 (before) | Pilot 2 (gaps 1-6) | Pilot 3 (+ route-props gate) |
| --- | --- | --- | --- |
| Tool uses / tokens | 52 / 149,127 | 26 / 127,951 | 50 / 155,428 |
| Wall time | 7 min | 15 min | 20 min |
| Steps landed | 31 of 33 | 25 of 25 | 28 of 28 |
| Refused at add | 3 (NAME_TAKEN, BAD_JSON harness, UNKNOWN_ITEM) | 2 (NAME_TAKEN, UNKNOWN_ITEM), both passed with the fix or the sentence | 0 |
| Refused at run | 2 (PAGE-003, COMPONENT-003), no typed fix, left as is | 1 (COMPONENT-003), typed fix applied, landed | 3 (PAGE-003 x2, COMPONENT-003), typed fix applied each time, landed |
| Refusals left unresolved | 2 | 0 | 0 |
| Validate | 0 errors, 18 warnings | 0 errors, 4 warnings (PAGE-001) | 0 errors, 4 warnings (PAGE-001) |
| Cart link | copied into 5 pages | one `line.setLayoutSlot` | one `line.setLayoutSlot` |
| Acceptance | 22/22 | **0/22**: `next build` refused every page (props kept from the line.baseOn wrapper) | **22/22** |

Pilot 2 found a new Line gap: a route-served page may take only `params` and `searchParams` (Next.js's rule), which tsc
alone does not check; the type gate now checks it with a virtual file per route entry and offers "take no props" as the
fix. Pilot 3 ran before the "Did you mean <nearest id>?" fixes (im2) landed. Tokens did not fall (155k vs 149k):
pilot 3 built more (a feature usecase per consumer, an order service) and took three typed-fix round trips; the
refusals that cost the builder nothing now are the ones it previously had to work around by hand.
