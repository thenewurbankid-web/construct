# Trace

*(The folder and the npm package are still named `line-matcher`.)*

Takes a **designed page**, the **API it talks to (a Swagger/OpenAPI file with example data)** and optionally the **requirements**, and generates the layered React code for it. Wherever the three sources don't add up, it says so and asks. It is a proof of concept; the idea behind it is written up in **[docs/CONCEPT.md](docs/CONCEPT.md)**.

The core is deterministic: it matches every dynamic part of the page to the API data with a fixed library of transforms, and a part it can't settle becomes a question, never a guess. An optional AI layer (off by default) can answer those questions with small, checked tasks that a local ~2B model can do.

```
page.jsx (design, marked) + feature.json (route) + openapi.json / .yaml (the API contract) [+ story.md]
   → 1 extract   find the dynamic parts, lists, actions, form fields      (TSX ok; Construct AST if CONSTRUCT_ROOT is set)
   → 2 match     explain each value from the mock data                    (brute force over transforms)
   → 3 ask       questions for anything unresolved                        (you, or the AI layer; saved to answers.json)
   → 4 plan      decide the layers and say why
   → 5 emit      Route · Controller · Workflow · Service · Domain · Page · Component + mock API + tests + reports
```

## Quick start

```bash
npm install
npm start          # http://localhost:4177 is the demo front door (Trace); the full studio is at /studio: pick an example, press Start (questions) or Auto (none)
npm run demo       # the same, after a preflight check (npm run demo:check)
npm test           # domain tests of the generated features, the AI layer, the OpenAPI import, the eval harness and the demo
```

`three` (the 3D hero) and `esbuild` (which bundles it) are **dev dependencies**: the bundle `src/ui/hero3d/hero.bundle.mjs` is in the repository, so running, testing and deploying never need them. Only `npm run build:hero` does (it needs `npm install` with dev dependencies, the default). A deployed build copies only the production `node_modules` (the packages `package-lock.json` does not mark `"dev": true`). `esbuild` has an install script (it checks its platform binary); npm 11 lists install scripts that are not yet reviewed, so `package.json` records the review under `allowScripts` (`"esbuild@0.28.2": true`, added with `npm approve-scripts esbuild`). That is the only script approved, `ignore-scripts` and the other npm safety settings are untouched, and after an esbuild upgrade npm asks again (`npm approve-scripts esbuild`).

In a terminal instead:

```bash
node src/cli.mjs examples/invoices --out /tmp/out --ask     # asks the questions in the terminal
npm run auto                                                # every example, no questions, into demo-app/src
npm run generate                                            # regenerate demo-app/src/features/categories
cd demo-app && npm install && npm run dev                   # run the generated categories app (create, edit, delete on mocks)
```

## Measuring quality

`npm run eval` scores Trace against ground truth (the 11 examples plus a seeded synthetic corpus of adversarial cases) and writes `eval/out/report.html`; `npm run eval:gate` fails on determinism drift, more wrong-accepts, lower recall or lower oracle accuracy compared with the recorded baseline. **The gate is a regression detector, not an accuracy measurement**: only about a tenth of the scored parts have independent truth (the rest is synthetic truth from a copy of the transform library, or Trace's own answer), and the report splits every number that way. `npm run eval:worksheet` writes blind labelling worksheets so an independent person can grow that share. No algorithm change merges without an eval run. See [docs/EVAL.md](docs/EVAL.md).

## Inputs

**1. The page** (`examples/<name>/page.jsx`): the static design with example values and three markers.

| Marker | Meaning |
|---|---|
| `data-dyn="totalSpend"` | this element's text is data; its text is the example value |
| `data-list="categories"` | the children are a repeated list; the first child is the row template |
| `data-action="save"` | a button or form that does something |

Known action verbs: `create/add/new`, `update`, `save/submit` (create, or update if a row is selected), `delete/remove`, `edit/select/open`, `cancel/reset/close`, `refresh/reload`. Any other verb is a question.

**2. The API contract** (`examples/<name>/openapi.json`, `openapi.yaml` or `openapi.yml`): a Swagger 2.0 or OpenAPI 3.x file that lives in the feature's own folder. It is the only source of the API; `feature.json` no longer lists endpoints.

```json
{ "feature": "categories", "route": "/categories", "page": "page.jsx", "about": "one line shown in the UI",
  "docs": { "fields": { "assignee": "who approves the invoice" }, "endpoints": { "GET /api/invoices": "…" } } }
```

- **Where it comes from.** You upload it (UI: the *API contract* section has a file picker and a drop zone; API: `POST /api/openapi?example=<name>` with `content-type: application/json` and a body `{"name": "openapi.yaml", "text": "<the file text>"}`; like every state-changing route it goes through the central guard, so a raw or `text/plain` body is refused with 415). Uploading validates it (size up to 2 MB; JSON or YAML; OpenAPI 3.x or Swagger 2.0; at least one endpoint the generator can use) and saves it in the example's folder as `openapi.json` or `openapi.yaml`, removing any other `openapi.*` file so there is exactly one. The response is `{ file, hasContract, endpoints, gaps }`; a bad file is refused with the reason and nothing is written. `GET /api/contract?example=<name>` and `GET /api/examples` report `hasContract`, the source file name, the endpoints and the gaps. No API is loaded by default. To convert an old hand-written `apis` list, run `node scripts/apis-to-openapi.mjs <example-dir>` (the shipped examples were migrated with it; their generated code is byte-identical, which a test checks).
- **How it is read** (`src/openapi.mjs`, deterministic, no model). Local `$ref`s are followed (a cycle just stops, an external `$ref` is reported as a gap); `{id}` becomes `:id`; the server path (`basePath`, or the path of `servers[0].url`) is part of the endpoint path; `allOf` is merged. Bodies are **examples**, taken in this order: `example`, `examples`, `default`, a single-value `enum`. The first 2xx response with a JSON body is the response. A `readOnly` property is left out of a request and a `writeOnly` one out of a response. Every path parameter becomes `:name`, and endpoints with more than one path parameter, or one that is not the last segment (`/a/{id}/b/{sub}` becomes `/a/:id/b/:sub`), are imported and listed like any other, not reported as gaps. The generator fills one trailing `:param`, so such an endpoint is marked `wired: false` ("not generated" in the Contract card) and is never picked as the list, create, update or remove endpoint (`src/endpoint-paths.mjs` is the one place that decides item versus list); a file with only such endpoints is not a usable contract.
- **Envelope responses.** Real APIs rarely return a bare array. A GET on a collection path whose response is an object with **exactly one array property** is the list, and that property's name is the list key (`{ "portfolio_at_a_glance": {...}, "categories": [...] }` gives `categories`). The list rows are matched as before; the *rest* of the response is matched too: any scalar in it (`portfolio_at_a_glance.spend_you_manage`, `meta.snapshot_date`) can explain a page value, shown as text, money, percent or date. Nested fields inside the rows are matched as dotted paths (`spend.value`), and generated code reads them as `item.spend.value`. The list key is never written down: it is found again in the contract. An optional `"list": "categories"` in `feature.json` overrides it, only needed when a response has several array properties (which is ambiguous, so it is never guessed).
- **A missing example is a gap, never a guess.** If a response or a field has no example, no value is made up. It is listed as a gap ("the contract has no example for …"), shown in the contract panel, `REPORT.md` (*Contract gaps*) and as an open item routed to Backend, and the parts that would have matched it say so instead of the usual "add a field" hint. The code shape is still generated from the schema, and labelled: a list endpoint with no example gets an **empty** list (`[]`, or `{ key: [] }`), so the service, workflow and mock exist and the mock starts empty; a request whose schema declares fields without examples types the form inputs from the schema (`number`, `boolean`, `string`) and they are not reported as "not in the API". Nothing that could match a design value by chance (`null`, `0`, `""`) is ever produced.
- **A run without a contract is allowed** (terminal, UI, Auto, Watch). It is not blocked, and it is honest: one notice, *No API contract for this feature: upload a Swagger/OpenAPI file*, at the top of the run, in `REPORT.md`, `REPORT.html`, `status.json` and the run summary; one open item for the contract (routed to Backend; the parts that only wait for it are not repeated as team actions); every part that needs the API says the contract is missing, not a per-field message; nothing is asked (or answered by AI) until there is something to match against; the tree marks everything missing; and the generated code is stubs (a service call that rejects on purpose, an empty mock, TODO values). Upload a contract and run again (or let Watch re-run) and the parts close exactly as they would have. A contract file that cannot be read gets the same treatment with the reason. Try `examples/products-no-contract`.

The mock data should produce exactly what the design shows. Keep numbers raw in the API (`78400000`) and formatted in the design (`$78.4M`), so the formatter is discovered rather than hidden in the data. `docs` is optional and only feeds the AI layer.

**3. Requirements** (optional): `story.md` and `ui.md` next to `feature.json`. Only the AI layer reads them.

## Demo

`npm run demo` starts the server and opens **Trace**, a simple front door for showing the tool: pick one of three curated screens (a real Portfolio Health page, Invoices, Orders), press **Wire it**, watch the designed page fill with **Fit** / **Waiting** / **Gap** / **Tie** / **Stub** (an open Ask is amber and says "waiting for you"; red is only for a Gap someone has settled), answer the **Asks** with a click (or let **Suggest** answer what it can), then read the four **Handoffs** (Backend, Product, Design, Frontend) with their emails. It uses only a small pattern language (see the vocabulary table in [docs/CONCEPT.md](docs/CONCEPT.md)); the studio below is one click away under **Details** (`/studio`).

- `npm run demo:check` is the preflight: Node version, files, port, the three scenarios run end to end with the numbers in the script, and whether the helper for Suggest is running (a warning only: the demo works completely without it). Run it before going on stage.
- The script, expected numbers, what not to claim and the fallback plan are in **[docs/DEMO.md](docs/DEMO.md)**. Three screenshots: `docs/demo/`.
- The first screen shows a small live picture of the selected screen's designed page next to the Contract card (a sandboxed, inert frame fed by `GET /api/preview`; hidden below 1000 px), and a three-step strip under **Wire it** (Wire it, Answer the Asks, Hand off). **Wire it** holds the first screen for about 350 ms (`WIRE_DELAY_MS`, `src/ui/wire-delay.mjs`) so the hero's pulse is seen; there is no wait with reduced motion or from the Space shortcut. Every count in the shell is a count of parts of the design: two buttons with one name are two parts, listed once with `×2` and traced once, so the trace list adds up to the ring.
- The first screen carries a small 3D version of the Trace mark (Three.js, vendored and lazy, with a static-mark fallback); `/?hero=off` turns it off, `npm run build:hero` rebuilds its bundle. See the "3D hero" section of [docs/DEMO.md](docs/DEMO.md).
- The fit screen draws each part's trace back to the contract on a 2D canvas (a pulse per part, a Map view; decorative, also given as text, and it respects reduced motion): see "Canvas visuals" in [docs/DEMO.md](docs/DEMO.md); code in `src/ui/canvas/`.
- Between takes: **Reset demo** (top right) clears the saved answers and restores the original contracts (also an uploaded one). Keyboard: Space wires or continues, `1`-`3` pick a screen, `S` skips an Ask, `R` replays, Esc goes back. **Present** (or `/?present=1`) enlarges the type and slows the reveal.

### The Part inspector (spot, click, fix)

Every part that has a problem carries a small badge in plain words: **Gap** (nothing in the API), **Tie** (two fields fit equally), **Stub** (placeholder to write), **Ask** (waiting for you), **No endpoint** (a button whose endpoint the contract lacks) and **Input the API lacks** (a form input no request carries). Click a badge, a part of the page or a Handoff item (any element keyed by a part id) to open the inspector:

- **Blocks** (left): the options for the part in a fixed order (candidates by cost, then alphabetical; then Gap, Stub, fixed text). Each shows what it produces on the design's own example values beside what the design shows, the API endpoint, path and a sample response, and the generated source of the part (read-only, file and line range). The first option is tagged **Rule default**: it is only the first in the rules' fixed order, not evidence that it is right.
- **Chat** (right): a streaming chat that only knows this part's facts. Its reply is checked against them (numbers, quoted names and field names must appear in the facts, the rest is flagged), it refuses questions about anything else, and it can propose an option but never applies one (`POST /api/part-chat`).
- **Suggest**: one small checked AI call for this part only (`POST /api/suggest`). It selects one of the rule-computed options, or drafts a Stub expression that the evaluator runs on the design's examples. It writes nothing; applying stays your click.
- **Preview, Apply, Undo**: choosing an option shows its effect first (the part's new state, the fit score change, the generated code diff), computed by running the real pipeline in a scratch copy under `/private/tmp`. **Apply** writes `answers.json` and appends to `answers.history.jsonl` (sorted keys, one line per change, with the source `inspector` or `inspector+suggest` plus the cited fact), then Replays. **Undo** and **Redo** work per part and for the whole example. **Fix all similar** offers the same choice to parts with the same kind of problem and the same candidates, with a combined preview.

Kinds live in one registry (`src/ui/issues.mjs`: label, colour token, explanation, question form); a new kind is one more entry. In the studio the same badges appear on the page stage and the open-items rows, and double-clicking a part opens the inspector. Server side: `src/inspector/`. Tests: `src/inspector/inspector.test.mjs`, `src/ui/issues.test.mjs`.

## The UI (the studio, at `/studio`)

The designed page fills the window; everything else is a dock on the right with four stacked, collapsible sections (click a header; drag the dock's left edge to resize; **☰ Panel** hides it). What is needed opens by itself: Run when you start or a question arrives, Tree when you click a highlighted element on the page. Badges on the headers show what is waiting.

- **The page** is coloured by connection state: amber = needs your answer or skipped, red dashed = missing (no API behind it), violet = placeholder, grey dotted = static. Hover an element for the reason; click one to jump to it in the tree. Things the page lacks entirely (an API field with no form input) are listed under it as "Not on the page".
- **Run**: the five steps as they happen, the current question, open items with what would close each, your answers (tagged saved / AI / skipped), and AI usage.
- **Tree**: a **mini** overview in the dock (colour and shape only). **Full screen** opens the big tree in a floating window: mouse-wheel zoom, drag to pan, drag the header to move it, resize from the corner, double-click or **Fit** to fit, **100%** for actual size, Esc to close. Each node shows the generated layer it lands in (Page, Component, Domain, Service, Workflow, Controller) and the function name; `ƒ` marks a transform. Paths are colour-coded: green connected, grey dotted static, amber dotted needs an answer, violet dashed placeholder, red dashed missing. Hover a node to light up its whole path and its element on the page.
- **Generated layers**: after Plan, each layer is a box with the functions and components inside it. Each block has a stripe with one colour per design part it serves. Hover a block to light up what it serves, and hover a tree path to light up the blocks that serve it.
- **API contract**: the example's openapi file: the endpoints with their request and response examples (which ones have none, and the gaps), an upload box (file picker and drag-and-drop) to replace it, and after an upload which endpoints were imported and which lack examples, with **Run again**. Fields the design uses are green; what the design needs but the contract lacks (an endpoint, a field) is flagged red. An example with no contract shows *No contract yet* and the upload box; the **Start**, **Auto** and Watch controls stay enabled, with a warning beside them: *No contract: the run will leave everything open until you upload one.*
- **When a question stops the run**, the part it is about is lit up everywhere: a pulsing ring on the page (scrolled into view), its whole path in the tree (dimming the rest, the Tree section opens), and the layer blocks that serve it. The question card carries a context box: what the design shows, the API endpoint, each candidate field with sample values from the mock data, and which blocks the answer would land in (Component, Domain, Service, ...).
- **Run summary** (a popup when a run finishes; the **Summary** button reopens it; a watcher re-run doesn't pop it): a *Summary* tab (connections, questions, files changed, what is still open, AI time), a *Code changes* tab (a git-style diff of every generated file against what was on disk before this run, with a directory tree grouped by feature and layer folders, `A`/`M`/`=` per file and `+N −M`), and a *Missing & open* tab that sorts what is left: open questions, missing endpoints, missing fields, buttons not wired, placeholders to write, design-versus-contract gaps. Click an item to jump to it on the page and in the tree.
- **Run summary as an app**: the popup has a navigation rail (*Overview*, *Team actions*, *Open items*, *Code changes*). *Overview* is a readiness ring, tiles and a short "Next up" list; every row expands in place, with **Locate on page**. *Open items* filters by severity and team and has search. *Team actions* is a board with one column per team:
  - **Backend / API**: a missing endpoint or field, a form input with no request field, a service-layer placeholder, data for a chart or graphic the design draws.
  - **Product**: ties (which field means what), buttons with no defined behaviour, skipped decisions.
  - **Design**: a chart or graphic with no named component, a form input the API expects but the design lacks.
  - **Frontend**: everything else (stubs to write, wiring).
  Routing is a fixed rule (`src/actions.mjs`); a skipped item is routed by why it was open (nothing in the API, a tie). Each column has **Write email**, which replaces the summary window with the **email composer** (**← Back to summary** returns; your draft and chat are kept), and **Copy**. The generated email text is fixed, not model-written: each item has what we saw, what the design shows, the API and candidate fields, why it matters and what is needed, plus the contract used. In the composer you can edit the email by hand (Undo/Redo, every change is a version, **Reset to generated**) and chat with the model set for the `mail` task to rewrite it. A request that ends in "?" or starts with why/what/which/who/how/explain is *answered*; anything else is a *rewrite*. A rewrite is only a **proposal**: it streams in with its thinking (if the model has any), and is checked against the email it came from. Any detail (field name, endpoint, number, weekday, ticket id) that was not in the email or your request is flagged, and a draft that drops most details or balloons in size is flagged too. A clean draft is applied for you if **Auto-apply** is on (default); a flagged one waits for **Apply anyway**. Chat controls: **Pause** (freezes the reply on screen, the model keeps going in the background), **Stop** (aborts the model call), **Queue** (messages sent while it is busy wait their turn; Stop puts the queue on hold), **Regenerate** (asks again with a little randomness), **Show changes** (line diff), quick requests (Shorter, Friendlier, More formal, Only blockers, Add a deadline, Bullets). **Open in mail app** sends the current version. `mailto:` bodies are cut near 1800 characters, so the full text is also put on your clipboard.
- **Plain-language summary** (Options → "Explain open items and each summary section", on by default; `--explain` in the terminal). The model that is set for the `explain` task (default `qwen2.5-coder:1.5b`; use `ollama:qwen2.5vl:latest` if that is what you have) writes a short paragraph for **each section of the summary page** and a plain-language card for each open item, **one call per block, and each call sees only that block's facts** (Connections sees only the connection counts, Code only the file counts, and so on). Severity and order (Blocker, Risk, Decision, To write) come from a fixed rule, not the model. A model text is used only if it stays inside its facts: no number, quoted value or name that isn't in them; no claim about placeholders, blockers, ties, skips, errors or cache hits unless the facts have a non-zero count for it (and "no X" only if the count is zero); short; about this part. Otherwise a fixed sentence is shown, tagged "fixed text", and the Console shows why it fell back. With no model reachable the whole summary is fixed text. The checks catch invented facts, not loose wording: the prose can still be generic or speculative ("users might be confused"), so read it as a draft. On `invoices` with Qwen 2.5 VL 8B, 7 of 13 texts were used and 6 fell back.
- **Console** (bottom, docked): every AI exchange as it happens: which task and which model (`provider:model`), the exact prompt we sent, the raw answer, any reasoning the model returned (shown for models that expose it, such as Ollama "thinking" models or `<think>` output; otherwise it says so), tokens and time (or "cached"), and our verdict (accepted with the cited fact, or why it was skipped). Drag its top edge to resize; **Detach** floats it into a window you can move and resize, **Attach** docks it again; `Console` in the nav shows or hides it.
- **Options**: use saved answers, ask about every part, watch, the AI switch with a model per task, "Auto-run every example".

## Theming

Light and dark, one set of colour tokens. The top-bar sun/moon button cycles **Auto** (follow the system) → **Light** → **Dark**; the choice is kept in `localStorage` (`lm-theme`) and applied as `<html data-theme="light|dark">` by an inline script in `<head>`, so there is no flash of the wrong theme. The light theme is a warm "paper" palette (page `#efece6`, raised surfaces `#f8f6f1`, text `#24211d`), not white.

- **Single source**: `TOKENS` / `THEME_CSS` in `src/tree/svg.mjs` (the block comment there documents every token: `bg card stat fg mut bd bd2 line sb sel grn amb ambbg red redbg ph phbg acc on-acc ly-* shadow shadow-lg`). The UI, the tree SVG and the static `REPORT.html` all use it (`REPORT.html` follows `prefers-color-scheme`; it has no script).
- **Reuse from another page**: the server serves it at `/theme.css`. Add `<link rel="stylesheet" href="/theme.css">`, use `var(--bg)`, `var(--card)`, `var(--fg)`, ..., and (optionally) the same head script to honour `lm-theme`. `TREE_CSS` (same file) styles the tree and layer blocks.
- **Contrast**: `src/tree/theme.test.mjs` computes WCAG ratios from the shipped CSS for both themes (4.5:1 text, 3:1 control borders). Change a colour there, not in a component.

## Questions and answers

A part the matcher can't settle (no match, or several equally simple ones) becomes a question:

```
? "refreshedAt" (shows "31 Jul 2026") can't be computed from the mock data. What is it?
  1) data the API doesn't provide yet — leave a TODO
  2) static text — not data
  3) something else — build a placeholder…
```

- **Never a guess.** Exact matches are not asked; ties are always asked. When parts are tied on the same fields and you resolved one, the later question shows a plain note ("`lead` is already used by `row.owner`"); it is information only.
- **Something else — build a placeholder…** ends every question. You name the function yourself:

  | The part comes from | What is generated |
  |---|---|
  | fields combined (pick them) | a placeholder function in the Domain layer that receives them |
  | the controller | a placeholder function in the Controller; its result goes to the page |
  | a new endpoint that doesn't exist yet (values only) | a placeholder call in the Service, used by the Controller |
  | your own handler (buttons) | a placeholder handler in the Controller, wired to the button |

  Placeholders return the design's example (or a naive join) so the page looks right, and are violet in the tree. Their tests are `todo` unless the AI layer drafted a body that reproduces the design (then it is a normal test). `REPORT.md` lists them under "Placeholders to fill in".
- **Skip for now** (button, key `s`, or `s` / `/skip` in the terminal): the part stays a TODO, amber, and is not saved, so the next run asks again.
- **Ask about every part** (`--ask-all`, or the UI option) also asks about parts that matched, so you can override them.
- Answers are saved to `answers.json` next to the feature, so re-runs are repeatable. Delete it to be asked again.

## Auto, watch, hints

- **Auto** (a button per example, "Auto-run every example", `npm run auto`) never asks. It uses saved answers and every unambiguous match, leaves the rest open, generates code for everything resolved, and lists each open item with the exact edit that would close it (`status.json`, `REPORT.md`, the Run panel).
- **Watch** (ticked by default): after you run an example, the server watches its `feature.json`, openapi file, page and `answers.json`, and re-runs in Auto mode when one changes (uploading a contract counts). Every run re-matches from scratch, so one data fix can close several paths at once. Terminal: `npm run watch`.
- **Hints**: every question and open item says what data change would settle it: which fields to make differ and in which row, the values a missing field needs, the endpoint to add.

## AI layer (opt-in)

Turn it on with `--ai` (terminal) or Options → "Let AI answer". Every task is **one tiny, single-turn call**: at most 4 numbered facts, JSON-only output, temperature 0, so a ~2B local model can do it.

| Task | What it does | How it is checked |
|---|---|---|
| `choose` | picks one option of a question | it must cite a fact that mentions the part or the chosen option, or it is skipped; it may not pick "static text" |
| `pick-fields` | picks several fields for a placeholder | same |
| `draft-body` | writes one expression for a placeholder | the expression is **run on the design's own examples** and kept only if it reproduces them (2 tries); only simple expressions are allowed |

Facts come from `story.md` / `ui.md`, `docs` in `feature.json`, and the design (column headers, button labels). Retrieval is word overlap; there is no model in it.

**Model per task** is configurable in `ai.config.json` (project root), `<example>/ai.json`, `--ai-task choose=anthropic:claude-haiku-4-5-20251001` (repeatable), or the Options menu. Providers: `ollama` (local Qwen; default `qwen2.5-coder:1.5b`, so `ollama pull qwen2.5-coder:1.5b`), `jev` ([open-jev](tools/jev/README.md), a tiny "system one" decision model; single choice only, random weights), `openai` (any OpenAI-compatible server: LM Studio, llama.cpp, vLLM) and `anthropic` (Claude; set `ANTHROPIC_API_KEY`). They can be mixed: a local model to choose, Claude to draft.

**Who may choose what (security).** A request over HTTP can choose a model *name* for a task and nothing else: the provider, the base URL and the API keys come only from `ai.config.json` and an example's `ai.json`. For a paid provider (`anthropic`, or an OpenAI-compatible server that is not on this machine) a request may only pick a model the config already names or lists under `"allowedModels": { "anthropic": ["claude-haiku-4-5-20251001", "claude-sonnet-4-5"] }`. `ANTHROPIC_API_KEY` is only ever sent to `https://api.anthropic.com`; `OPENAI_API_KEY` only to a loopback server or a host listed under `"keyHosts": ["llm.example.com"]`. Both settings, their defaults and the guard rules every route must pass are in **[docs/SECURITY.md](docs/SECURITY.md)**.

**Determinism and audit.** Each reply is cached by prompt hash in `ai-cache.json`, so a re-run costs no tokens and gives the same result. `decisions.json` records every AI answer with the model and the fact it cited; `REPORT.md` lists them under "AI decisions to review". A human answer replaces the AI's.

**Measured so far** with Qwen 2.5 VL 8B (the only local model available, not a 2B coder): `roster` 4 of 4 correct (~750 tokens, ~5 s); `invoices` 4 of 6 correct, the other 2 wrong before the "no static text" guard (not re-run after it); `contacts` could not tell that a value is combined from fields or supplied by the controller, and drafted no verified expression. Treat AI answers as a first pass and read `decisions.json`. The Claude provider is untested.

## Resetting an example

Options → **Reset this example…** or **Reset all examples…** (with a confirmation), or `npm run reset [-- <name>]` in the terminal. A reset deletes the saved state (`answers.json`, `decisions.json`, `ai-cache.json`, and the inspector's undo history `answers.history.jsonl`) and restores `feature.json`, the openapi contract, the page and the stories from the example's `.original/` folder (a contract uploaded later is removed, so an example that started without one has none again), so an example you edited (for instance `orders` after copying `fixed.openapi.json` over `openapi.json`) starts clean again. It refuses while a run of that example is still going. Generated code in `demo-app` is kept. `.original/` is a pristine copy made with `node src/reset-cli.mjs examples --snapshot`; an example without one only has its state cleared. **State that survives a reset:** generated code in `demo-app`, and any file this list does not name. **Contract:** an example that shipped with an `openapi.*` gets it back from `.original/`; an example that shipped **without** one (`products-no-contract`) loses a contract uploaded later, so it starts empty again. If you want an uploaded contract to survive a reset, save it into `.original/` (`node src/reset-cli.mjs examples <name> --snapshot` only writes a missing `.original/`, so copy the file there by hand).

### Benchmark: how do the models compare?

`npm run bench -- --models ollama:qwen2.5vl:latest,jev:open-jev --repeat 3 --detail` runs 21 gold questions (`benchmarks/gold.json`, from the examples' stories) through each model with no cache. It prints raw accuracy (the model's pick), how many answers our checks accepted, the precision of those, and latency (cold start, median, p95, mean), and appends one line per call to `bench-log.jsonl`. The Console panel shows the same per-call times live, and the Run panel shows total AI time.

Measured on this machine (21 questions × 2 runs each):

| Model | Raw correct | Accepted | Accepted and right | Cold | Median | p95 |
|---|---|---|---|---|---|---|
| `ollama:qwen2.5vl:latest` (8B) | 28 / 42 (66%) | 24 | 24 (100%) | 3.7 s | 240 ms | 392 ms |
| `jev:open-jev` (random weights) | 14 / 42 (33%) | 0 | – | 33 ms | 6 ms | 6 ms |

Random guessing would get about 27%. Both models gave identical answers on both runs. open-jev is about 40× faster but is at chance and never passes its own confidence gate, which is the right behaviour for an untrained model. Qwen was never wrong when accepted, but left 9 of the questions it got right to a person (no fact cited, or the cited fact wasn't about the part), and it picks "static text" for the "combine fields" and "not in the API" cases, which the AI is not allowed to choose. A ~2B coder model has not been measured (only the 8B `qwen2.5vl` is installed here).

## Deploying locally

`npm run deploy:local` keeps the latest build running at http://localhost:4200 (the dev server, `npm start`, stays on 4177). It runs `npm test` first and refuses to deploy on a failure, copies the deployable tree to `deploy/<version>/`, starts it on a temporary port and health-checks it, switches `deploy/current`, restarts on the fixed port, checks again and rolls back on its own if that fails. It keeps the last 3 builds and does nothing (and says so) when the tree is unchanged.

```
npm run deploy:local       test, build, switch, verify
npm run deploy:status      version, release, hash, deployed time, port, pid, health
npm run deploy:stop        stop the server
npm run deploy:watch       redeploy after 20 s without edits, only when the hash changed and the tests pass
npm run deploy:rollback    go back to the build before the current one
```

Port: `--port <n>` or `TRACE_DEPLOY_PORT` (default 4200; refused if another program holds it). Everything lives in the git-ignored `deploy/` (`server.pid`, `server.log`, `LAST-FAILURE.txt`). Details, the launchd example for starting the watcher at login, and the rules for what counts as "the build" are in [docs/DEPLOY-LOCAL.md](docs/DEPLOY-LOCAL.md).

**Build badge.** The top bar shows `v1.0.0 · 3f9c2a1 · R0 · deployed 12 min ago` (hover for the exact time; "dev build" for `npm start`). The version is `package.json`'s plus the first 7 characters of a content hash over the deployable files, so it changes exactly when the build's content does. The release id comes from a `RELEASE` file (for example `R0`) or, if there is none, the newest release in `CHANGELOG.md`. An already-open page shows **New build available: reload** when the server runs a different build. The studio's badge is hidden below 1500 px, so the top bar also has a small **dot** that is always visible: a green dot links to `/about`; when the server reports a different build it becomes an amber, pulsing **New build available: reload** button (both have a tooltip and an accessible name, and are reachable with the keyboard).

**Minor releases.** `CHANGELOG.md` may hold minor releases under a release: `## R0 — 2026-09-27` followed by `### R0.1 — 2026-09-27` (bullets under it belong to the minor). The `RELEASE` file may say `R0.1`; the build info then has `release: "R0.1"`, `major: "R0"`, `minor: "R0.1"` (both `null` when the id is not `R<n>` or `R<n>.<m>`), the badge shows `R0.1`, and the About page shows each release with its minors nested (the newest expanded). The order is R0 < R0.1 < R0.2 < R1.

To put the badge on another page served by this server (the demo shell will), two lines:

```html
<span id="build"></span>
<script type="module">import { mountBuildBadge } from "/ui/build-badge.mjs"; mountBuildBadge(document.getElementById("build"));</script>
```

It reads `/api/build`, links to `/about`, and uses the theme tokens from `/theme.css`.

**Rollback keeps your contracts.** A contract you uploaded (or replaced with "Backend ships the fix") in the running app lives in that build's folder; `npm run deploy:rollback` copies it into the older build before switching and says which examples it kept, so a rollback never brings back an older contract over yours. If that copy fails, nothing is switched.

**About page.** The badge opens `/about`: build details (version, release, full hash, deployed "x ago" with the exact time, port, uptime, Node, tests at deploy), **What's new** (`CHANGELOG.md`: newest release open, older collapsed, searchable), **Changes in this build** (files added, modified and removed compared with the build that ran before), and the **deploy history**. `GET /api/about` returns the same data as JSON; `/api/build` and `/api/health` are the small ones. A release is complete only when `CHANGELOG.md` and `RELEASE` are both updated (the convention is at the top of `CHANGELOG.md`).

## Real Subframe pages

`subframe-app/` is a Vite + Tailwind project set up with the Subframe CLI against the *Project Max V2* Subframe project, with the design system synced to `src/ui-v2/`. The three Portfolio Health pages are pulled from Subframe (via the MCP server) as real TSX in `src/pages/`. Run `cd subframe-app && npm run dev -- --port 5180`, then open `#redesigned`, `#figma-1` or `#figma-2`. The `examples/portfolio-*` examples are still hand-marked plain-JSX versions of these pages; the tool now reads the Subframe TSX directly (see *Importing real Subframe pages*); highlighting on the real render is not done yet.

## Importing real Subframe pages

`src/import/` (entry `src/import/index.mjs`) reads a real Subframe TSX page and gets it ready for the pipeline. It uses Construct's AST package when `CONSTRUCT_ROOT` points at a Construct checkout, and its own Babel code otherwise, with the same results (see [docs/CONSTRUCT-REUSE.md](docs/CONSTRUCT-REUSE.md)); it needs no model and no network, and adds no dependency.

```js
import { suggestMarkers, applyMarkers, extractParts } from "./src/import/index.mjs";
const suggestions = suggestMarkers(tsx);                       // [{id, kind, loc, text, reason, strength, risk, name, question}]
const marked = applyMarkers(tsx, suggestions.filter((s) => s.strength === "strong").map((s) => s.id));
extractParts(marked);                                          // same shape as extract(); extract() now calls it
```

- **Extraction** (`extract()`) now handles TypeScript, member tags (`Table.Row`, `MetricCard.Value`), fragments, self-closing tags and text written as `{"..."}`, `{'...'}` or a plain template literal. Elements inside props (`leftSlot={<>...</>}`) are found for values and actions; a list's rows and a row's fields are still read from child elements only, as before. The 11 examples extract byte-identically (golden hashes in `src/import/import.test.mjs`). Text passed as a `prefix`/`suffix` string prop (`suffix="M"`) is folded into the element's own text (`textOf`), so `$280` plus `suffix="M"` extracts as `$280M`, matching what the component renders (fixed T18.11; previously the suffix was dropped).
- **Suggestions** are yes/no questions, sorted by position, each with `strength` (`strong`/`weak`) and a `risk` when weak. dyn: money/number, dates, percents, ▲/▼ deltas, "N of M" (a number inside a sentence, and any other text in a list row, is weak); a standalone sentence outside any list, styled or tagged as a heading (`h1`-`h6`, a `text-h1`..`text-h6` className) or as body copy (`text-body-N`), is a weak "headline/narrative" suggestion unless a divider line sits next to it (that pattern is a plain section title, e.g. "Category overview"). list: `Table.Row`/`<tr>` children, or 3+ siblings with the same structure. action: `Button`/`IconButton`/`button`/`a` with an `onClick` or `type=submit`, or any element with a `clickable` prop and no inner button doing the same job (a `<Table.Row clickable={true}>` with no `onClick` anywhere in it). Two elements with identical text in an identical container elsewhere on the page (Subframe sometimes exports the same section twice) are treated as a duplicate: only the first occurrence's actions stay strong. Weak on purpose: nav numbering (`01` outside a list), versions, years, static counts ("4 of 14 selected"), anything in a sidebar/breadcrumb/tab/menu, chip rows, stat strips, skeletons, Cancel/toggle buttons, search boxes.
- **Apply** adds `data-dyn` / `data-list` / `data-action` (and `name` for a form field) as exact text splices, so formatting outside the touched tags is unchanged and no prettier pass is needed. A whole-element dyn annotates the element (Subframe components pass extra props to their top element); a number inside a sentence is wrapped in `<span data-dyn>`. Ids are positions in that exact source, so re-run `suggestMarkers` after any edit. Marker names are derived (column header, nearest label) and are only names; rename them freely.
- **Running the pipeline on the result**: point `feature.json` `page` at the `.tsx` file. The Page file it generates keeps the type annotations (prettier uses `babel-ts` for `.ts/.tsx` pages).

Measured on the three real pages against the hand-marked `portfolio-*` examples (strong suggestions accepted; details and the remaining false positives in the task report):

| | figma-1 | figma-2 | redesigned |
|---|---|---|---|
| dyn precision (strong) | 49/51 exact, 51/51 with partial | 50/50 | 41/43 exact, 43/43 with partial |
| dyn recall (strong / strong+weak) | 48/89 = 0.54 / 0.94 | 49/89 = 0.55 / 0.94 | 38/65 = 0.58 / 0.95 |
| list precision, recall | 1/1, 1/1 | 1/1, 1/1 | 1/1, 1/1 |
| action precision, recall | 2/4, 2/3 | 2/4, 2/3 | n/a, 0/3 |
| parts extracted, marked TSX vs hand | 9 values + 7 row fields vs 24 + 12 | 8 + 7 vs 24 + 12 | 7 + 6 vs 13 + 12 |
| pipeline (`--auto`, no saved answers): parts / matched to API / open | 16 / 4 / 17 vs 36 / 15 / 24 | 15 / 5 / 15 vs 36 / 15 / 24 | 13 / 4 / 10 vs 25 / 7 / 21 |

Text that is data but has no pattern (headlines, category names, badges outside a list) is not found by the strong rules; the weak "text in a list row" rule finds the row ones. Rows written with `clickable` instead of an `onClick` give no row action.

## Examples

Each has its own `README.md`.

| Example | Scenario | Asked | Try |
|---|---|---|---|
| `products` | Everything matches. | 0 | Auto; edit a price and watch it re-run. |
| `categories` | The original CRUD example with one value the API can't give. | 1 | Answer TODO, or build a controller placeholder. |
| `invoices` | Ambiguous field, unmatched column, sort tie, aggregate tie, missing value, unknown verb. | 6 | Skip some; run Auto and read the hints; try `--ai`. |
| `contacts` | Placeholders: joined name, controller value, new endpoint, own handler. | 4 | "something else — build a placeholder…". |
| `roster` | Ties: two columns and two totals tied on the same fields. | 4 | Answer, or make the fields differ in `feature.json` (Watch on) and the ties close; try `--ai`. |
| `orders` | Missing API: no status field, no PUT/DELETE, a form input the API lacks. | 3 | `cp examples/orders/fixed.openapi.json examples/orders/openapi.json` with Watch on (the prepared fix, an OpenAPI file): everything closes at once. |
| `deals` | Complex: eight transforms on one page (text, compact money, percent, date, count, sum, average, min, max, sort) plus a join, a tie, a missing column and endpoint, form gaps and an unknown verb. | 10 | Press Auto and read the tree; then `--ai` with its `story.md`. |
| `portfolio-figma-1`, `portfolio-figma-2`, `portfolio-redesigned` | **Real pages**: the three *Portfolio Health* pages from Subframe against the Category Health Report contract (`GET /api/category-health/portfolio`, an envelope). Shows contract-vs-design mismatches: row order, a maturity scale, forbidden `L2`/`L3` badges, equal-value false matches. | 24 / 24 / 21 open | Press Auto, then open the API contract panel. |
| `products-no-contract` | **No API contract**: the `products` page with no openapi file, to show the honest empty state and the upload. | 0 | Press Auto, read the notice; upload `examples/products/openapi.json`; run again. |
| `metrics` | Values only (no list): count, sum, average, min, max, percent, plus one uncomputable date. | 1 | Read it to see the built-in transforms. |

## Output

`demo-app/src/features/<feature>/` (for `categories`):

| Layer | File | What was generated |
|---|---|---|
| Route | `route/CategoriesRoute.jsx` | entry point, delegates to the controller |
| Controller | `controller/CategoriesController.jsx` | wires workflow + domain to page props and handlers; holds controller placeholders |
| Workflow | `workflow/categories.workflow.js` | XState machine: loading / ready / creating / updating / removing / failed |
| Service | `service/categories.service.js` | one fetch function per endpoint; placeholder calls for endpoints that don't exist yet |
| Domain | `domain/categories.domain.js` | the discovered transforms: count, sum, max, formatting, sort order, form → API types; field-join placeholders |
| Page | `page/CategoriesPage.jsx` | the designed JSX, rewritten to read props |
| Component | `component/CategoryRow.jsx` | the list row template |
| — | `mocks/categories.mock.js` | in-memory CRUD mock API, seeded from your example data |
| — | `domain/categories.domain.test.js` | tests: the design values are the expected output |
| — | `REPORT.md`, `REPORT.html` | every match, question, layer decision, gap, open item and AI decision; the HTML draws the tree and layers |
| — | `status.json` | open items and what would close them |

Next to the inputs, a run maintains `answers.json` (your answers), `decisions.json` and `ai-cache.json` (AI provenance and cache, only with `--ai`).

## CLI reference

```
node src/cli.mjs <feature-dir> [--out <dir>] [--yes | --ask | --ask-all | --auto] [--watch] [--ai [--ai-task task=provider:model]]
node src/cli.mjs <examples-dir> --all ...      every example in the folder
node scripts/apis-to-openapi.mjs <example-dir>   convert an old `apis` list in feature.json to openapi.json
node src/server.mjs [--port 4177] [--strict-port] [--no-open] [--examples <dir>] [--out <dir>]
```

`--yes` takes the first option of every question (not meaningful for correctness; for smoke runs), `--ask` forces the prompts, `--auto` never asks, `--watch` re-runs on change (implies `--auto`).

## Extending

- **New formatter or aggregate:** add it to `src/transforms.mjs`. Every future page can then match it.
- **New action verb:** add it to `VERBS` in `src/match.mjs`.
- **New AI provider:** add it to `src/ai/provider.mjs` (one `chat({system, user, schema, maxTokens})` function).

## Current limits (prototype)

- One list and one form per page; the list must be a top-level key of the response (`"list": "categories"`), not nested deeper. Page values can be matched to scalars of the envelope, but a placeholder built from several envelope fields is limited to expressions over `data.<path>`. No user-driven filtering, sorting, pagination or search.
- The Hook layer is never generated. Values outside the list are matched against aggregates of the list only; a separate "summary" endpoint isn't matched.
- The layer structure and file names are my own guess; they aren't taken from Construct's repository layout.
- Pages need the `data-*` markers by hand. The contract is imported from OpenAPI/Swagger, but only what the matcher uses: examples, and the schema for the shape of a missing example. Required fields, enums, nullable, error responses and auth are read from the file by nobody yet. Only local `$ref`s are followed, code is generated only for endpoints with no path parameter or one as the last segment (others are listed, not generated), and a response with no example gives no data to match (see above).
- Validation, error and empty states, permissions and other behaviour that no source states are not generated.
- Only tried on twelve examples (one of them without a contract), three of them from real Subframe pages against a draft contract. The AI layer has only been run on one 8B model.

## Change notes: the API contract (OpenAPI/Swagger)

- The contract is the feature folder's `openapi.json` / `openapi.yaml`; `feature.json` no longer lists `apis`. Migrated with `scripts/apis-to-openapi.mjs`; generated code unchanged.
- A run without a contract is allowed and honest; a missing example is a named gap, never a guess.
- Review fixes: the two hints that pointed at `apis` in `feature.json` now point at the OpenAPI file (only the hint text of `deals` and `orders` reports changed); the `orders` fix is `fixed.openapi.json`; `/api/openapi` decodes the upload once (multi-byte characters are safe) and answers 400 or 413 instead of throwing. In the merged server it is dispatched after the central guard (`src/http-guard.mjs`) and reads its body only through the guard's bounded JSON reader.
- R1.1: endpoints with more than one path parameter (or one that is not last) are imported and listed; the generator still calls only one trailing `:param`, so they are marked `wired: false` and get no generated code.
