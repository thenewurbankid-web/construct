# Trace: the concept and this proof of concept

## In one paragraph

Three teams each hand over a piece of the same screen: design gives a page, backend gives an API, product gives requirements. Turning those into working front-end code is mostly *wiring*: which field feeds which column, how it is formatted, which button calls which endpoint. Much of that wiring is mechanical, and the rest is judgment that nobody wrote down. **line-matcher** does the mechanical part by rule, turns every place where the three sources disagree or say nothing into an explicit question, and records the answers so the result can be reproduced. An optional AI layer can propose those answers, but it is only allowed to propose, and every proposal is checked and recorded.

This document explains the idea, what the proof of concept (POC) shows, what it does not show, and what it would take to find out whether the idea works on real pages.

## The problem

- **The wiring is repetitive.** For every page someone rebuilds the same layers (route, controller, workflow, service, domain, page, components), maps API fields to UI text, and writes the same conversions.
- **Disagreements surface late.** A column with no field behind it, a button with no endpoint, a form input the API rejects, two fields that look interchangeable: these are usually found while coding, or in QA.
- **The judgment calls are invisible.** "Is *Requested by* the requester or the assignee?" gets answered in someone's head and lives only in the code.
- **Tooling that hides its guesses is worse than none.** A generator that quietly picks an option produces code that looks right and isn't.

## The concept

Treat the wiring as a **data problem with exceptions**, not as a text-generation problem.

1. **Match deterministically.** Take the designed page (with its example values) and the API's example data. For each dynamic part, search a small, fixed library of transforms (as text, money, date, count, sum, average, min, max, percent, sort) for the way the API data produces exactly what the design shows. Keep only the simplest explanations.
2. **Exceptions become questions.** A part with no explanation, or with several equally simple ones, is not resolved for you. It becomes a question with concrete options.
3. **Decisions are data.** Each answer is stored in a file next to the inputs (`answers.json`). The same inputs plus the same answers always give the same output. Changing an answer is a one-line diff.
4. **Gaps are a first-class output.** What is still open is listed together with the exact change that would close it ("add a `status` field with these values per row", "add a `DELETE` endpoint", "make `assignee` differ from `requester` in one row").
5. **Everything re-runs from scratch.** Fix the data and one re-run closes every path the fix explains. Nothing depends on a previous run's hidden state.
6. **AI is a proposer, not a decider.** Where a person would answer a question, an AI can answer it instead, as a tiny task with a checkable result and a recorded reason. The deterministic core does not depend on it.

```
   design (page.jsx) ───┐
   API contract (openapi) ┼─► extract ─► match ─► questions ─► plan ─► generate ─► layered React + tests + reports
   requirements (opt.) ─┘      (deterministic)      ▲                                     │
                                                    │                                     ▼
                              you  /  AI proposer ──┘ (answers.json, decisions.json)   open items + hints
```

### Principles

| Principle | What it means here |
|---|---|
| Deterministic core | No model in matching or code generation. Same inputs and answers give identical files. |
| Never guess | An ambiguous or missing part is asked, skipped, or left as a marked TODO or placeholder, never silently chosen. |
| Auditable | Every decision has a source (you, saved, AI with the model and the sentence it cited). |
| Small tasks | Each AI call is a single-turn task with at most four numbered facts and a machine-checked answer, so a ~2B local model can attempt it. |
| Gaps over polish | Showing what does not line up is treated as more valuable than producing code that hides it. |
| Re-runnable | Runs are cheap and idempotent; watching the inputs and re-running is the normal loop. |

## What the POC does

**Inputs** (per screen, in one folder): the designed page as JSX with three markers (`data-dyn`, `data-list`, `data-action`), a `feature.json` with the route, the API contract as a Swagger/OpenAPI file (`openapi.json` or `openapi.yaml`, uploaded into the folder; its examples are the data the matcher works on), and optionally `story.md` and `ui.md`. A feature with no contract still runs: it says so once, leaves everything that needs the API open, and asks nothing until a contract is uploaded.

**Pipeline:** extract the dynamic parts, lists, actions and form fields from the page AST; match each to the API data; ask about the rest; plan which layers are needed; emit the code.

**Output:** Route, Controller, Workflow (XState), Service, Domain (the discovered transforms), Page (the design rewritten to take props), a list row Component, a mock API, domain tests whose expected values are the design's own values, and reports that say what matched, what was asked and what is still open.

**Questions and placeholders.** Every question also offers "something else": combine fields into a value, take it from the controller, take it from an endpoint that does not exist yet, or write your own button handler. You name the function; a placeholder is generated in the right layer and marked. Any question can be skipped for now and is asked again next time.

**Automation around it.** Auto mode (no questions, use saved answers, list what is open), watch mode (re-run when the design, the API file or the answers change), hints for every open item, and one-answer-at-a-time notes when several parts are tied on the same fields.

**The screen.** The designed page fills the window and is coloured by connection state (connected, waiting for an answer, missing, placeholder, static). A dock holds the run steps and questions, a tree of *design part → transform → API* with the generated layer and function name on each node (mini in the dock, a zoomable, draggable full-screen window on demand), the generated layers as blocks with a colour stripe for what each serves, and the API contract with fields the design uses highlighted and what is missing in red.

**AI layer (opt-in).** Three task types: `choose`, `pick-fields`, `draft-body`. Rules that keep it safe:
- an answer must cite a numbered fact that mentions the part or the chosen option, or it is dropped;
- it may not choose "static text" (that would hide a missing connection);
- a drafted placeholder expression is **executed against the design's own examples** and kept only if it reproduces them, using a restricted expression language;
- replies are cached by prompt hash, so a re-run costs no tokens and repeats the result;
- each AI answer is recorded with its model and the cited sentence, and listed in the report for review;
- the model for each task is configurable (local Qwen through Ollama, an OpenAI-compatible server, or Claude), so a cheap local model can choose while a stronger one drafts.

## Scenarios the examples cover

| Example | What it shows |
|---|---|
| `products` | Everything is explained by the API: nothing to ask, nothing open. |
| `categories` | Full create/edit/delete on mocks; one value the API can't provide. |
| `invoices` | Six kinds of exception at once: ambiguous field, unmatched column, sort tie, aggregate tie, missing value, unknown verb. |
| `contacts` | Placeholders: a joined name, a controller value, a value from a future endpoint, a custom handler. |
| `roster` | Ties across two columns and two totals; notes instead of guesses. |
| `orders` | Missing API (no field, no `PUT`/`DELETE`, a form input the API lacks) and the "fix the file, everything closes at once" loop. |
| `deals` | One complex screen: eight transformations matched automatically, plus a join, a tie, a missing column and endpoint, form gaps and an unknown verb. |
| `portfolio-*` (three) | Real pages: the three Portfolio Health pages from Subframe against the Category Health Report contract. Surfaces design-versus-contract mismatches (row order, a 1–5 versus 0–100 maturity scale, forbidden `L2`/`L3` badges, values that match by coincidence). |
| `products-no-contract` | No API contract yet: the run is allowed and honest (one notice, one item for Backend, stubs), and closes when a contract is uploaded. |
| `metrics` | Values only, no list: all built-in aggregates and formats. |

## What is proven, and what is not

**Shown by the POC**
- The matching approach works on small screens: on all eleven examples every part the tool matches reproduces the design's own values from the example data (the rest is listed as open), and the tests generated from them pass (31 tests across the repo).
- Exceptions surface as specific, actionable questions and gaps, and fixing data closes several at once (demonstrated on `orders`, including through the file watcher).
- The AI layer can be made small, checked and reproducible. Measured on one local model (Qwen 2.5 VL 8B, the only one available; not a 2B coder): `roster` 4 of 4 correct in about 750 tokens; `invoices` 4 of 6 correct, with the other two wrong before the "no static text" guard was added (not re-run since); `contacts` failed to identify that a value is combined from fields or supplied by the controller, and produced no verified expression.

**Not shown**
- **Real pages, measured.** Eight examples were written for this POC. Three are re-authored from real Subframe pages against a real (draft) API contract: 24, 24 and 21 open items out of 36, 36 and 25 dynamic parts. That is one screen shown three ways, and the contract is a draft, so it says how much of a real screen is unexplained today, not how much the tool would save.
- **A small model.** No ~2B model was tried. The one result we have suggests judging "what kind of thing is this value?" is the hard part, and a smaller model may do worse.
- **Claude as a provider.** The code path exists; it has not been run.
- **Conventions.** The generated layer structure and file names are a guess, not the team's real repository layout.
- **Code quality at scale.** The output is a first draft that still needs review. No one has compared it to hand-written code for maintainability.
- **Time saved.** No measurement. The expectation (less wiring, earlier gap discovery) is a hypothesis.

## Limits and risks

- One list and one form per page; no user-driven filtering, sorting, pagination or search.
- Design pages need the `data-*` markers, which designers do not produce today; the API contract must carry **examples** (a Swagger/OpenAPI file with no examples imports fine, but gives the matcher nothing to match: those are reported as gaps, never filled in).
- Behaviour that no source states (validation, error and empty states, permissions, business rules) is not generated. It shows up as a gap at best.
- Ties are settled by intent, not data. If two fields have identical values in the sample, a wrong human or AI answer can still pass the generated tests. The mitigation is recording every decision and asking for data that tells them apart, not a technical guarantee.
- AI-drafted expressions become generated code. They are restricted and verified against examples, but they are still code from a model and need review.
- A dependence on the quality of the example data: if the mock API is wrong or unrepresentative, the matches are too.

## What would make it real

In the order that removes the most manual work with the least risk:

1. **Match the real conventions.** Emit the team's actual layer and file structure instead of the guessed one. Without this the output is a demo.
2. **Import the OpenAPI contract** instead of a hand-written example. **Done for the part the matcher uses** (`src/openapi.mjs`: Swagger 2.0 and OpenAPI 3.x, JSON and YAML, local `$ref`s, the list envelope, examples in a fixed order, an uploaded file per feature folder, migration of the shipped examples with identical output). A missing example is a named gap, never a guess, and the code shape is still generated from the schema (an empty list, typed form inputs). **What remains:** the contract also carries required fields, enums, nullable fields, error responses and auth, which are deterministic sources for validation, status badges, empty and error states and permissions, so many "nobody wrote it down" gaps stop being gaps and need no AI. None of that is read yet. Also open: external and remote `$ref`s, generating code for endpoints with several path parameters (they are imported and listed, not generated), `oneOf`/`anyOf`, generating example values from constraints (deliberately not done: it would be guessing), and diffing a new upload against the previous contract.
3. **Provenance everywhere.** Record the source of every decision (person, saved, AI) and review the decisions file like a lockfile.
4. **Turn a design export into the marked page**, so designers are not asked to add attributes.
5. **Requirements traceability.** Link each requirement sentence to a design part, an API field and a generated block; a requirement with nothing behind it is a gap. This is where an AI helps most, checked by verifying that each link points at something that exists.
6. **More than one list or form per page**, then filtering, sorting and pagination.
7. **Trial the AI layer on real stories with a genuinely small model**, and keep only the tasks that pass their checks reliably.

## How to evaluate it on a real screen

A small experiment settles most of the open questions:

1. Pick three real screens of different complexity that are already built by hand.
2. For each, take the design, the API example bodies and the story, and add the markers.
3. Run it in Auto mode first, then answer the questions, then (separately) with the AI layer.
4. Compare with the hand-built version on: share of dynamic parts matched without a question; questions asked and how many were needed; gaps reported that were real, and real bugs or mismatches it missed; lines of wiring produced that survive review unchanged; time spent by a person versus the hand-built time; and, for the AI layer, answers accepted versus overridden, and tokens per screen.
5. Decide from those numbers, not from the examples here.

## Decisions needed from the team

- Is the target repository layout available to encode (item 1 above)? Who owns it?
- Will the backend provide an OpenAPI contract per feature, and can it include field descriptions?
- Who marks up the pages, or can the design export produce the markers?
- Where should AI answers be allowed (choices only, or also drafting), and which model may see the requirements?
- What accuracy on real screens would make this worth adopting?

## The vocabulary (what the demo says)

The demo front door (Trace, at `/`) hides the pipeline's own terms behind a small pattern language. It is defined once, in `src/ui/vocab.mjs`, with a test; the studio (`/studio`) keeps the pipeline's words.

| Word | Means | The pipeline calls it |
|---|---|---|
| **Seam** | A place where design, API and product meet and may not fit. (In prose the demo says "mismatch".) | none: the umbrella word |
| **Fit** | A part the contract reproduces exactly. | connected |
| **Waiting** | A part that is waiting for your answer: an Ask is open, so nothing is wrong yet. | an unanswered question (state `ask`, or `missing` while its question is open) |
| **Gap** | A part with nothing behind it, confirmed: someone answered "not in the API yet", or no question is possible. | missing |
| **Tie** | Two explanations fit equally well. | tie |
| **Ask** | A Gap or a Tie turned into a question with concrete options. | question |
| **Stub** | An honest, marked stand-in for something that doesn't exist yet. | placeholder |
| **Suggest** | The AI proposes an answer that rules check. | AI answer |
| **Ledger** | Every decision, recorded with who or what made it. | `answers.json` / `decisions.json` |
| **Replay** | Run again from scratch, same output. | re-run |
| **Handoff** | What a team must do, plus the ready email. | team action |
| **Fit report** | The summary of a run. | run summary |

In one sentence: Trace finds the seams. Each is a Fit, a Gap or a Tie. Gaps and Ties become Asks, which you answer or Suggest answers. Answers go in the Ledger, so a Replay gives the same result. Each team gets a Handoff.

How the states map: a part is a Fit when its tree state is `ok` or `static`; a Tie when several candidates fit; a Stub when it is a `placeholder`; Waiting when its Ask is still open (state `ask`, or a red cell the pipeline flags `waiting: true`: "needs your answer", or a button whose endpoint is missing and whose Ask has not been answered; the demo reads the flag, never the cell's words), which includes a skipped Ask; and a Gap only when it is settled as having nothing behind it (`missing` with no question to ask, or answered "not in the API yet"). Red is only for a Gap; an open Ask is amber. The word "envelope" is not used: it already means the API response wrapper in this tool.

## Where things are

- **Try it:** `npm install && npm start`, then read the top-level `README.md`.
- **Code:** `src/` (pipeline, matcher, questions, emitters), `src/ai/` (the AI layer and its tests), `src/tree/` (the tree and layers model), `src/ui/index.html` (the studio), `src/ui/demo.*` and `src/demo-server.mjs` (the demo front door).
- **Examples:** `examples/*`, each with its own `README.md` explaining the scenario.
