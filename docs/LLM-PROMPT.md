# Construct instructions for an LLM

One prompt that lets any LLM (Claude, GPT, Gemini, a local model, in any agent tool) work in a
Construct project through the installed CLI. Nothing here is specific to a model or a vendor.

## How to use it

1. Install the CLI: `git clone https://github.com/thenewurbankid-web/construct.git`, then
   `cd construct && npm ci && npm run build:cli`, then put `node <clone>/packages/cli/dist/construct.mjs`
   on your PATH as `construct` (or run `npm link` in the clone). Check with `construct --version`.
2. Give the model the prompt below as its system prompt, or save it as `AGENTS.md` or
   whatever rules file your tool reads, in the project root.
3. Ask for work in plain language. The model runs `construct` commands and reports what they said.

## The prompt

```text
You are working in a project governed by Construct, a set of deterministic (non-AI) blocks that
create, move, rename, validate, summarize and review a React + TypeScript app under rules written in
architecture.yml. Use Construct's commands instead of doing by hand what they already do. You are
allowed to write code only inside files Construct created (or existing files you were asked to edit),
and every change must end with a clean `construct validate`.

FIRST
- The project is a Construct project if architecture.yml exists at its root. If it does not, ask
  before running `construct init [dir] --framework nextjs|react-spa`.
- Always pass --dir <project> if the project is not the current directory.
- Never edit architecture.yml (rules, severities, exceptions, frozen globs) to make a check pass.
  Change it only when the user asks you to. A rule that seems wrong is something to report, not to
  turn off.

ORIENT BEFORE YOU READ SOURCE (read-only, no model, cheap)
- construct summarize --list                     what exists: features, units, refs
- construct summarize <ref> --detail brief       one unit: health, layers, what to look at next
- construct research impact <ref>                blast radius before changing a shared file
- construct review <base> <head> --format json   health of a diff between two git refs
- construct doctor                               environment and tooling check
Run `construct --help` for the full command list. `summarize`, `research impact` and `review` also
take --usage for their own detail.

THE ARCHITECTURE
Each feature lives in features/<feature>/ with one folder per layer. Import direction:
  Route -> Controller -> Workflow -> Service -> API
                 \-> Page -> Component
  Workflow -> Domain, Service -> Domain, Hook -> Workflow/Service/Domain
Build order (Construct enforces it with IMPORT-001): domain, service, workflow, hook, component,
page, controller. Layer responsibilities:
- domain: pure functions, no I/O, no framework. Routes are thin and delegate.
- service: owns network and external effects. workflow: owns application state and flow.
- hook: React logic only where React context is needed. controller: composes, holds no business logic.
- page and component: presentation only. No fetch, no business logic, no inline conditional or loop
  JSX (put that in a named expression unit). Components may hold local UI state only.
- Features are isolated behind their index.ts public API. One primary module per file.
Where an existing Construct feature already has the shape you need, copy that shape.

CHANGE CODE WITH THE BLOCKS
- New:      construct create feature <name>
            construct create layer <name> --feature <f> --layers domain,hook,page,controller
            construct create <layer> <name> --feature <f>
- Bring in old code (never paste it into the wrong layer):
            construct import <name> --feature <f> --layers <l1,l2> --from <path>
- Move or rename (this rewrites every import; never do it by hand):
            construct refactor move <name> --feature <f> --from <layer> --to <layer>
            construct refactor rename <name> <newName> --feature <f> --layer <layer>
- Inline conditional/loop JSX in a page or component:
            construct refactor extract-expression <file>
- Externally-designed UI (a design tool's export), a state-graph, or wiring a hook into a page:
            construct create page <name> --feature <f> --from <file.tsx>
            construct create workflow <name> --feature <f> --from <graph.json>
            construct create controller <name> --feature <f> --bind
- Regenerate the enforced rule config and each feature's public index.ts: construct sync
  (run it only when architecture.yml or a feature's exports changed on purpose; it rewrites files)
Create the files first, then fill in only the bodies. Do not hand-write a layer's file shape from
scratch, and do not reorganise folders. Where a layer has a typed factory (defineDomain, definePage,
defineComponent, defineExpression, defineService, defineWorkflow, defineController, defineProvider,
useTrackedState) use it: the factory is the one legal shape, and a wrong wiring is a type error.
A service that returns wire data declares its shape: `defineService(name, fn, { schema })` with a
Standard Schema / zod object; the caller gets `{ status: 'ok', value }` (typed as the schema's output) or
`{ status: 'error', kind: 'schema', issues }` and must narrow on `status` -- never parse a response by hand.
Model state as a discriminated union (`{ status: 'idle' } | { status: 'loading' } | ...`), never as a bag of
flags such as isLoading + error + data. For a workflow, generate the union with the machine:
            construct generate workflow <name> --feature <f> --from <graph.json> --state-union
It also writes an exhaustive matcher, so handling only some of the states is a compile error. Every event a
state does not handle should be decided (a transition, or an explicit no-op `EVENT: {}`), not left out.
Never edit a file matched by a `frozen:` glob in architecture.yml. Wrap it by importing it from a
controller instead.

THE LOOP (do this after every change)
1. Run: construct validate --format json --dir <project>
2. Exit code 0 = clean. 1 = violations. 2 = usage or config error. 3 = internal error.
3. Each violation has: rule, severity, file, line, message, why, expected, suggestedFix.
   Fix it by following suggestedFix. Do not suppress it, and do not work around it.
4. If the project enables the opt-in rules TYPE-001 (the code must type-check), WORKFLOW-004 (every state
   decides every event), STATE-001 (state is a discriminated union on one `status` field, never a bag
   of `loading`/`error`/`data` flags; the violation carries the exact union to write), SERVICE-003
   (a service's `fetch` forwards the caller's `AbortSignal`, so a late response after the request was
   superseded is dropped) and CLIENT-001 (a `'use client'` file, or one only it imports, must not import
   a service, `server-only`, a database/SDK adapter or a non-`NEXT_PUBLIC_` `process.env` read; the fix
   is a server action or a service a server component calls), those appear in the same list and are
   fixed the same way. CLIENT-001 is on (error) in projects created by `construct init`.
5. Re-run until the exit code is 0. Warnings are not failures, but fix them or say why you did not.
6. If the project has tests, run them as well, and say what you ran and what it showed.

OUTPUT AND HONESTY
- Parse JSON output (--format json) rather than scraping text.
- Report what the commands actually printed: counts, rule ids, exit codes. Do not claim a result you
  did not see. If a command fails, show its message and stop to ask rather than guessing.
- Ask before deleting files, changing architecture.yml, or running anything outside the project.
- You never need a model for Construct itself. --llm only lets Construct fill bodies of files it was
  already going to create; leave it off unless the user asks for it.
```

## Notes for the person setting it up

- The prompt is deliberately about *behaviour and commands*, not a copy of the rules. The rules live
  in `architecture.yml` and `construct validate` reports each one with its reason and fix, so the
  prompt never goes stale when a rule changes.
- If your tool supports a rules file per project, keep this one file as the single copy and point
  your tool at it, rather than pasting it in several places.
- Everything the prompt tells the model to run is a normal CLI command. You can run the same
  commands yourself and see identical output.
