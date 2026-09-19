Construct is a set of small commands that each do one mechanical job on a React + TypeScript app: create files in the right place, move them, check them against your rules. This page explains the handful of ideas behind them.

## Blocks, not magic

Every command is deterministic: the same input gives the same result, and it tells you what it did. There is no hidden step where a model decides what to build. Where an AI model is useful (writing the body of a function, proposing how to split an old page into features), you have to ask for it explicitly with `--llm`, and the command reports how many AI calls it made. See [Using an AI model, optionally](@user-guide/how-to/use-an-llm/).

## Features

A **feature** is a folder under `features/` that owns one part of your app: its logic, state, screens and network calls. Other features can only use it through its `index.ts`, which is its public API. This keeps the parts of your app from tangling together.

## Layers

Inside a feature, every file belongs to one **layer**, and each layer has one job:

| Layer | Its job |
|---|---|
| **Route** | The entry point for a URL. It hands off to a controller and does nothing else. |
| **Controller** | Connects the app's behaviour to what is shown on screen. |
| **Workflow** | The flow and state of a task, written as an XState state machine. |
| **Hook** | React-aware logic, only where React context is really needed. |
| **Domain** | Pure business rules. No network, storage or screen access. |
| **Service** | Talks to the outside world: APIs, SDKs, anything with side effects. |
| **Page** | Turns props into markup. No logic. |
| **Component** | Reusable pieces of markup. |

The allowed direction of dependencies is fixed, so you always know where code should live:

```text
Route -> Controller -> Workflow -> Service -> API
              +-----> Page -> Component

Workflow -> Domain
Service  -> Domain
Hook     -> Workflow / Service / Domain
```

## Rules and `architecture.yml`

The conventions above are not advice; they are **rules** with ids such as `PAGE-003` ("pages cannot import services"). `construct validate` checks your code against them and reports each violation with the file and line, why the rule exists, what was expected and how to fix it.

Your project's `architecture.yml` is the policy. Every rule is `error` (validation fails), `warning` (reported only) or `off`. You can also grant time-limited **exceptions** for specific paths, with a reason, an owner and an expiry date. See [Tune the rules](@user-guide/how-to/tune-rules/). The full list of rules is in the [rule reference](@developers/rules-reference/).

## Order is enforced

Files import each other, so they have to be created in dependency order. Construct does that for you (`domain`, then `service`, `workflow`, `hook`, `component`, `page`, `controller`), and a rule (`IMPORT-001`) fails validation if any relative import points at a file that does not exist. You cannot end up with a silently broken import.

## Two targets

Construct supports Next.js App Router (the default) and client-routed single-page apps (`react-spa`). Only the route layer differs; everything else is identical. Set it with `project.framework` in `architecture.yml` or `construct init --framework`.

## Two ways to drive it

The **command line** is the complete interface. The **Cockpit UI** is a browser front end over the same commands, for when you would rather click than type, or want to watch what is happening. It adds no logic of its own and makes no AI calls of its own.

## Every action leaves a record

Each command ends with a line such as `[tool: scaffolded the file(s) above from templates] [llm: 0 calls]`. There is no separate log to find: the line is the record of what happened and whether a model was involved.
