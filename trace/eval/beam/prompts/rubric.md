---
version: v1
---
# Planner eval rubric

Draft for the owner to edit (#897). Both the Opus-Grader and the owner score every item against these lines, so the two
sets of scores are comparable. Each line is a `## <id> — <title> (0–<max>)` heading; the grader's parser and the UI's
score buttons are built from those headings, so keep the format when you edit. Bump `version` above whenever a
definition or a scale changes (every grade records the rubric version it was given).

The rules come from the owner's resolve-flow definitions: a page part is either dynamic or static; dynamic data comes
from an api or is computed (computed includes values derived from api fields); every connection goes through a function
at every layer (controller → hook → provider → service → contract); per layer the order is (1) an existing stub for this
part → complete it, (2) an existing function → map / reuse it, (3) create; a stub is any function with an unused input
or return; nothing in a finished plan may leave an input or a return unused.

Score what the plan says, not how it is worded. A line that does not apply (for example the plan touches no layer
below the page) gets its maximum if nothing in the plan is wrong for it.

## intent — Intent right (0–2)
Definition: the plan's intent (verb × structural object from the drafter's catalog, and the target it points at) is
what the requirement asks for.
- 0: wrong verb or wrong object (an add read as an update, a page change read as a workflow change), or no intent.
- 1: verb and object right but the target is wrong or vague (right kind, wrong page / component), or the right intent
  is only an alternative while a wrong one leads.
- 2: verb, object and target all match the requirement.
Example: "Show the contact's full name instead of the first name" → `update.prop` on the contacts page is 2;
`add.component` is 0; `update.prop` on the orders page is 1.

## path — Layers and path right (0–3)
Definition: the Trace path (page part → dynamic? → api | computed → controller → hook → provider → service → contract)
goes through the right layers in the right order, makes the right dynamic/static and api/computed calls, and stops
where the requirement stops.
- 0: the path is missing or goes through the wrong layers (a computed value routed to a new api endpoint, a static
  label sent through a service).
- 1: the first decision (dynamic vs static, api vs computed) is right but a later layer is wrong or missing.
- 2: every layer is right; one node's detail is off (the wrong field, an extra layer that does no harm).
- 3: every layer, every branch decision and the stopping point are right.
Example: "Show a joined name" → part → dynamic → computed (first + last from the api's fields) → controller → hook is
3; routing it to a new `GET /name` service is 0.

## reuse — Stubs checked first, reuse over create (0–3)
Definition: at each layer the plan follows the order: an existing stub for this part is completed first, then an
existing function is mapped or reused, and only then is something created. Creating what exists is the main failure.
- 0: the plan creates at a layer where a stub or a fitting function exists, at more than one layer.
- 1: one layer creates (or reuses a non-fitting function) where a stub or a fitting function exists.
- 2: the order is right everywhere, but a reuse picks a weaker candidate when a better one exists (a partial match
  over the exact stub).
- 3: every layer takes the stub first, then the existing function, and creates only what does not exist.
Example: the contacts page has a stub `useContactName(row)` with an unused return; a plan that completes it is 3; a
plan that creates `useFullName` next to it is 1 (0 if it also creates a new service).

## question — Question needed and closed (0–2)
Definition: the planner asks only when the requirement is truly ambiguous for the plan (two readings lead to
different paths), and when it asks, the question is closed (a few named options, each leading to a path).
- 0: asks when the requirement already answers it, or asks an open question ("what do you want?"), or does not ask
  when two readings lead to different paths and it guessed wrong.
- 1: the question is needed but open or badly scoped (options that do not map to paths), or not needed but harmless
  and closed.
- 2: no question when none is needed, or a needed question with closed options that each map to a path.
Example: "Show the total" on a page with an api `total` and computable line items → "From the api field `total`, or
computed from the line items?" is 2; "How should the total work?" is 1; asking "Which page?" when the requirement names
it is 0.

## unused — No unused inputs or returns (0–2)
Definition: no function the plan creates or completes leaves an input or a return unused, and only the limited scope a
function needs is passed to it (no whole row or whole response where one field is used).
- 0: the plan leaves a new function with an unused input or return (it ships a stub), or passes whole objects through
  every layer.
- 1: one unused input / return, or one over-wide scope, in an otherwise clean plan.
- 2: every input and return of every created or completed function is used, with a limited scope.
Example: `formatName(contact)` that reads only `first` and `last` and is called with the row is 1 (over-wide scope);
`formatName(first, last)` is 2; `formatName(contact, locale)` with `locale` never read is 0.
