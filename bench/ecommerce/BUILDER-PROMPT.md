# Builder prompt: Line arm

Every Line-arm builder (qwen-7b, haiku, sonnet) gets exactly this text, with `{{SPEC}}` replaced by `SPEC.md`
(`node bench/ecommerce/driver/print-prompt.mjs line` prints it filled in). Since #889 the local builder
(`qwen-agent.mjs`) gets the spec's overview and a feature index in place of `{{SPEC}}`, and the current feature's
acceptance points in every `status` answer (`driver/spec-slice.mjs`). The budget is the same for all: 90 minutes
of wall time or 200 model turns, whichever comes first.

---

You are building a small e-commerce web app in an existing Line project. Line is a generator framework with an
enforced architecture: every change is a step in a plan, Construct checks it, and only a change that passes its checks
lands. Auto mode is on: a step that Construct planned clean is approved for you; a step Construct refuses does not land.

## Your only tool

`plan-cli` (environment: `BENCH_PROJECT`, `BENCH_LOG` and `BENCH_BUILDER` are set for you). Run it as
`node bench/ecommerce/driver/plan-cli.mjs <command>` (a local builder gets the same commands as tool calls). It is the
ONLY way to change the project: never write, move or delete a project file any other way, never run npm, git or an
editor on the project. Every call is recorded; a direct write counts as a human intervention and voids the run.

| Command | What it does |
| --- | --- |
| `tools` | the plan tools you can add, each with its JSON Schema |
| `status [feature]` | the plan: each step with its state and one sentence, and the acceptance points of the feature you work on (or of `feature`) |
| `add <tool> '<json-args>' --why "<one sentence>"` | add one step; Auto approves it when Construct planned it clean |
| `add --fix <ref> --why "<one sentence>"` | add a typed fix the last refused `add` offered (`f1` is the recommended one) |
| `run-next` | land the next approved step; returns its checks, findings and typed fixes when Construct refused it |
| `findings` | library items, features and their items, validate findings with their keys |
| `validate` | `construct validate --profile line`: error and warning counts and the findings |
| `read <path>` | one project file and its `contentHash` |
| `ls <dir>` | the entries of one project folder |
| `rules <tool> [file]` | the 2-4 rules a step of that tool must keep for that file, each with an example (the first `add` of each tool and kind shows them too) |

## How a Line project is laid out

- `library/` holds complete, shared items by kind: `components/` (Button, TextField, Card, Dialog, Select, Checkbox,
  Toast; Radix UI and Tailwind), `pages/` (ListPage, DetailPage, FormPage), `workflows/` (listDetail, checkout),
  `fixtures/products.json` (the 12 products), and you may add `services/`, `domains/` and `usecases/`.
- `features/<name>/` holds one feature: its `spec.md` and items by kind (`pages/`, `components/`, `workflows/`,
  `fixtures/`, `services/`, `domains/`, `usecases/`).
- Every feature component, page, workflow and fixture is based on exactly one library item of the same kind: its first
  line is `// @line-base <kind>/<Name>` (for example `// @line-base pages/ListPage`). Services, domains and usecases need
  no base.
- A feature imports from the library, its own folder, and another feature only through that feature's public index (`import { X } from '../../other'`, exported from `features/other/index.ts`), never from a file inside it. Something two features need goes
  in the library.
- `app/` is the Next.js app router: `app/layout.tsx` (the root layout, which renders the library's `AppLayout` and
  which `line.setLayoutSlot` writes for you) and one route entry per page, which `line.addRoute` writes for you.

## The tools you will use most

- `line.createFeature {name, story, points}`: a new feature with its spec.md (copy the feature's story and points
  from the spec below).
- `line.baseOn {libraryId, feature, name}`: a new feature item based on a library item (a page, component or workflow).
- `line.setCode {file, code, contentHash?}`: the whole code of one library or feature file. To replace an existing
  file, `read` it first and pass its `contentHash`; to create one, leave `contentHash` out.
- `line.addRoute {route, page}`: serve a feature page at a route (`"/"`, `"/cart"`, `"/products/:id"`).
- `line.setLayoutSlot {slot, components}`: show library or feature components on every page, in the app shell's
  `header`, `nav` or `footer` slot.
- When Line refuses a step, it says what was wrong, the rule, and the choices, each with an id and the exact step it
  adds, the recommended one first:

  ```
  Refused (UNKNOWN_ITEM): "catalog/ListPage" is not a feature page file.
  Rule: a step names a file or item that exists in the library or a feature.
  Choices, recommended first:
    f1: line.addRoute {"route":"/","page":"features/catalog/pages/ListPage.tsx"}
    f2: line.addRoute {"route":"/","page":"features/product/pages/DetailPage.tsx"}
  To apply one, send {"fix":"f1"}.
  ```

  Send the id you pick: `add --fix f1` (a tool call: `plan_add {"fix": "f1", "why": "..."}`). You may also write the
  step out yourself as a normal `add`. When there is nothing to pick, it ends with "A correct call: ..." instead.
- When `run-next` says a step needs a fix, its answer lists the choices the same way (its fixes, a retry, and leaving
  it as it is); send `{"fix": "f1"}`. The plan does not run other steps until you do.

Work in small steps: add one step, run it, read what Construct says, correct, go on. Client components need
`'use client';` as their first statement after the `// @line-` comment lines.

## When to stop

Stop when every acceptance point below is done, or when the budget ends (90 minutes or 200 turns). Before you stop,
run `validate`. Then write a short summary: what you built, which points you think pass, and every time Line stopped
you from doing something you needed (what you tried, the tool or rule, and what you did instead).

## The spec

{{SPEC}}
