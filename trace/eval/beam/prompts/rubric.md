---
version: v2
---
# Planner eval rubric

The owner's rubric (v2, set 2026-10-12; v1 is in `archive/rubric.v1.md`). Four lines, max 10. Both the Opus-Grader and
the owner score every item against these lines, so the two sets of scores are comparable. Each line is a
`## <id> — <title> (0–<max>)` heading; the grader's parser and the UI's score buttons are built from those headings, so
keep the format when you edit, and bump `version` above whenever a definition or a scale changes.

The plan is the planner's attempt to fit the request into the Trace map: page part → dynamic? → api | computed →
controller → hook → provider → service → contract. Per layer the order is (1) an existing stub for this part → complete
it, (2) an existing function → map / reuse it, (3) create. Score what the plan says, not how it is worded.

## fits — Fits the request (0–3)
Definition: the plan does what the requirement asks: the right verb and object, on the right target (page, part,
field), and stops where the requirement stops.
- 0: a different change (an add read as an update, the wrong page, a workflow where a field was asked), or no plan.
- 1: the right kind of change on the wrong or a vague target, or the right reading is only an alternative.
- 2: the right change on the right target; one detail is off (the wrong field, a small extra the owner did not ask for).
- 3: exactly what was asked, nothing missing, nothing extra.
Example: "Show the contact's full name instead of the first name" → `update.prop` on the contacts page's Name cell is
3; the same on the orders page is 1; `add.component` is 0.

## layer — Right layer, stub-first (0–3)
Definition: the path goes through the right layers with the right dynamic/static and api/computed calls, and at each
layer it completes an existing stub first, then reuses an existing function, and creates only what does not exist.
- 0: the wrong layers (a computable value routed to a new endpoint, a static label sent through a service), or it
  creates at more than one layer where a stub or a fitting function exists.
- 1: the first decision (dynamic vs static, api vs computed) is right but one layer is wrong, or one layer creates
  where a stub or fitting function exists.
- 2: every layer is right and stub-first is kept; one reuse picks a weaker candidate, or one harmless extra layer.
- 3: every layer, every branch decision and the stub → reuse → create order are right.
Example: the contacts page has a stub `useContactName(row)`; a computed path that completes it is 3; one that creates
`useFullName` beside it is 1; one that adds a `GET /name` service is 0.

## asked — Asked only when needed (0–2)
Definition: the planner asks only when the requirement is truly ambiguous for the plan (two readings lead to
different paths and the checks cannot decide), and does not guess when it should ask.
- 0: asks what the requirement already answers, or does not ask when two readings lead to different paths and it
  guessed wrong.
- 1: asks when it could have decided from the app, but the question is harmless; or guessed right where asking was
  the safer call.
- 2: no question when none is needed, or a question when one is needed.
Example: "Show the total" on a page with an api `total` and computable line items → asking is 2; asking "Which page?"
when the requirement names it is 0.

## clarity — Question clarity (0–2)
Definition: when the planner asks, the question is one clear, closed question: a few named options, each leading to a
path, worded for the product owner (no internal ids). When it asks nothing, this line gets its maximum.
- 0: an open question ("what do you want?", "How should the total work?"), or several questions at once.
- 1: closed, but the options do not map to paths, or it uses internal names the owner would not know.
- 2: no question, or one closed question whose named options each map to a path.
Example: "From the api field `total`, or computed from the line items?" is 2; "Pick: update.prop / add.component" is
1; "How should the total work?" is 0.
