<!-- Draft sub-issue. Title: "[Demo] As a bot or teammate I want a plain-language summary of any part of the project". Parent: the Cockpit guide. -->

# [Demo] As a bot or teammate I want a plain-language summary of any part of the project

**As a** teammate (or an AI agent working on the project), **I want** a short, structured summary
of any feature, file, workflow, route or rule, **so that** I can decide what to open or change
without reading the source, and get the same answer every time.

## CLI

```
construct summarize <ref> [--kind K] [--detail brief|standard|full] [--include a,b] [--format json|markdown] [--dir D]
construct summarize --list [--kind K]
construct summarize --usage
```

A reference is `kind:id` or just a name or path. Kinds: project, feature, layer, file, component,
hook, service, domain, page, controller, workflow, export, route, package, rule, envelope,
generator. `brief` is about 500 tokens (orient), `standard` about 2,000 (work on it), `full` about
8,000 (about to change it).

Real runs on the demo project (a `people` feature with a page and two components, and a `shop`
feature with a checkout workflow). Output is trimmed where marked.

1. List what exists:

   ```
   $ construct summarize --list --kind feature
   { "schemaVersion": 1, "ok": true, "kind": "feature", "count": 3,
     "units": [ ... "feature:core", "feature:people", "feature:shop" ... ] }
   ```
   (whitespace and per-unit `path`/`name` fields trimmed)

2. Ask about a feature, brief, as Markdown:

   ```
   $ construct summarize people --detail brief --format markdown
   # feature: people

   Feature "people": 3 files, 26 LOC, 2/7 layers (missing domain, service, workflow, hook, controller); 0 workflow machine(s); 1 error(s), 0 warning(s); 0 test file(s).

   Health: **issues** (completeness 0.29)

   - info: No domain layer yet.
   ...
   - error: features/people/: Feature "people" is missing expected folder(s): controllers, workflows, hooks, domain, services.
   ...
   ## Next

   - `construct summarize layer:people/domain` — Missing layer "domain"
   - `construct summarize rule:SLICE-001` — A rule this feature violates

   _schemaVersion 1, ~479/500 tokens, truncated_
   ```
   (sections in between trimmed)

3. Ask about one workflow file (standard):

   ```
   $ construct summarize workflow:features/shop/workflows/CheckoutWorkflow.tsx --detail standard --format markdown
   # workflow: CheckoutWorkflow.tsx

   Workflow features/shop/workflows/CheckoutWorkflow.tsx: Workflow state machine exporting CheckoutContext, CheckoutEvent, CheckoutWorkflow. 3 export(s), 42 LOC, imported by 0 file(s).
   ...
   - **summary**: The "checkout" flow has 3 steps. It starts in *idle* and can end in *done*.
   - **findings**: info: In *submitting*, "failure" only applies under a condition (it has error) and there is no fallback, so if none holds, nothing happens.
   ```
   (trimmed)

4. A wrong reference returns a structured error, exit code 2, never a guess:

   ```
   $ construct summarize /nope
   { "schemaVersion": 1, "ok": false,
     "error": { "code": "UNIT_NOT_FOUND", "message": "No unit matches \"/nope\".", "candidates": [],
                "hint": "Run `construct summarize --list` to see what exists." } }
   ```
   (a name that matches several units returns `UNIT_AMBIGUOUS` with the candidates instead)

5. A bigger target, for scale:

   ```
   $ construct summarize package:src/engine --detail brief --dir .
   ... "summary": "Package src/engine: 26 file(s), 3801 LOC" ... "budget": { "maxTokens": 500, "estimatedTokens": 298, "truncated": false }
   ```

6. Same input, same output: two runs of `construct summarize people --detail standard` produced
   byte-identical output (`cmp` reported no difference; 4,226 bytes).

## UI

The same summaries are available to any tool over read-only HTTP endpoints from the Cockpit backend,
scoped to the current project:

```
GET /api/units?kind=feature
GET /api/units/summary?ref=people&detail=brief&include=layers
GET /api/features                       (alias)
GET /api/features/:name/summary         (alias)
```

Real response for the second call (trimmed):

```
{"schemaVersion":1,"ok":true,"kind":"feature","id":"people","ref":"feature:people",
 "summary":"Feature \"people\": 3 files, 26 LOC, 2/7 layers (missing domain, service, workflow, hook, controller); ...",
 "sections":{"layers":{"present":["component","page"],"missing":["domain","service","workflow","hook","controller"],
   "fileCounts":{"component":2,"page":1}}},
 "health":{"status":"issues", ... "completeness":0.29}, "links":{...}, "next":[...],
 "budget":{"maxTokens":500,"estimatedTokens":415,"truncated":false}}
```

An unknown reference returns HTTP 404 (400 for an invalid kind, 409 for an ambiguous name). There
is no dedicated summary screen in the Cockpit yet, so this story has no screenshot; the surface
today is the CLI and these endpoints.

## What you'll see

A short English summary, a health status (ok / warnings / issues), what is missing, and a "Next"
list of exact follow-up commands, all sized to the detail level you asked for.

## Benefit

- **Who benefits:** an AI agent or a teammate who needs to orient in unfamiliar code; whoever
  pays for the AI's tokens.
- **What problem it removes:** reading many files (or letting a model guess) just to learn what a
  part of the project is and whether it is healthy.
- **Evidence:** `src/engine` is 26 files and 3,801 lines; its brief summary is an estimated 298
  tokens. The `people` feature (3 files, 26 lines) is about 415 estimated tokens for the whole
  brief including health findings and next steps, so on a project this small the saving is
  small: the value is the health status and next steps, and the guarantee that budgets are
  enforced. Zero AI calls; identical output on two runs (proved above).

Verified on `9ed0948` (2026-09-19) against `main`.
