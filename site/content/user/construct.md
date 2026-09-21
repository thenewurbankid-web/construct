Construct is the framework: the part that actually does the work. It holds your project's rules, the small tools that keep to them, and the functions those tools are built from. The [Cockpit](@user-guide/cockpit/) and the [command line](@user-guide/cli/) are just two ways to reach it.

## What it does for you

| It can | What that means | Guide |
|---|---|---|
| **Create** | A feature, one file, or a whole slice, in dependency order, with imports that resolve. | [Create features and files](@user-guide/how-to/create/) |
| **Check** | `construct validate` reports every rule break with the file, the line, why the rule exists and how to fix it. | [Validate and tune the rules](@user-guide/how-to/tune-rules/) |
| **Move and rename** | Relocate a file; every other file's import of it is updated. The file's own contents are never rewritten. | [Move and rename safely](@user-guide/how-to/refactor/) |
| **Understand** | Summarise a feature in plain English, explain its state machines, and work out what a change touches before you make it. | [Explain workflows in English](@user-guide/how-to/explain-workflows/) |
| **Review** | Compare two branches: what changed, what it means, and which findings are mechanical rather than a decision. | [Branch review example](@user-guide/examples/cli-impact-and-review/) |
| **Test** | One locked Playwright test per route through a workflow, and a run that says whether a failure is the test or the app. | [Flows and tests example](@user-guide/examples/cli-flows-and-tests/) |
| **Import** | Bring an existing page or route across, with a plan you approve before anything is written. | [Import an existing app](@user-guide/how-to/import/) |

## The rules live in your project

`construct init` writes an `architecture.yml`: the rules for this project, with ids such as `PAGE-003`. You set each one to `error`, `warning` or `off`, tune its options, and grant time-limited exceptions with a reason and an owner. Nothing is hidden in the tool — the [rule reference](@developers/rules-reference/) is generated from the same list `construct validate` reads.

Two project shapes are supported: Next.js App Router (the default) and client-routed single-page apps (`construct init --framework react-spa`). Only the entry point differs.

## A plan before anything runs

Bigger changes are described as a **plan**: a list of steps, each naming a real Construct action, its arguments and the files it will touch. A plan can be checked before it runs, turned into the exact commands it stands for, and asked what it touches. That is what makes a change reviewable in advance, in the Cockpit or in a script.

## The core API

Everything above is exported as plain JavaScript functions — JSON in, JSON out, no UI, no network, and errors come back as values rather than thrown. The command line and the Cockpit are thin wrappers over them, so a script or a bot can do exactly what a person does. Worked examples: [plans and impact](@user-guide/examples/core-plans-and-impact/) and [review, tests and commit messages](@user-guide/examples/core-review-tests-commits/). The inventory is in [Building blocks](@developers/building-blocks/).

## An AI model only when you ask

No command calls a model on its own. Pass `--llm <provider>` and the model fills in the body of files that were going to be created anyway — which files get created is always decided mechanically. Every command ends with a record line such as `[tool: scaffolded the file(s) above from templates] [llm: 0 calls]`. See [Using an AI model, optionally](@user-guide/how-to/use-an-llm/).

## Where to go next

- [All how-to guides](@user-guide/how-to/) for the task in front of you.
- [Examples](@user-guide/examples/): the problem, the exact command or screen, the exact result.
- [Architecture](@developers/architecture/) and [Extending Construct](@developers/extending/) if you want to add a rule or a command.
