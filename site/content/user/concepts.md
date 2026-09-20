Construct is a set of small commands that each do one mechanical job on a React and TypeScript app. Five ideas explain all of them.

**1. Small tools, same answer every time.** Every command gives the same result for the same input and tells you what it did. Where an AI model helps (writing the body of a function, proposing how to split an old page), you must ask with `--llm`, and the command reports how many model calls it made. See [Using an AI model, optionally](@user-guide/how-to/use-an-llm/).

**2. A feature is a folder that owns one part of your app.** Its logic, state, screens and network calls live under `features/`. Other features reach it only through its `index.ts`, so parts of your app do not tangle.

**3. Inside a feature, every file has one job.** Each file is one of eight parts, and the allowed direction of dependencies is fixed, so you always know where code belongs.

| Part | Its job |
|---|---|
| **Route** | The entry point for a URL. It hands off to a controller. |
| **Controller** | Connects the app's behaviour to what is shown. |
| **Workflow** | The flow and state of a task, as a state machine. |
| **Hook** | React-aware logic, only where React needs it. |
| **Domain** | Pure business rules. No network, storage or screen. |
| **Service** | Talks to the outside world: APIs and anything with side effects. |
| **Page** | Turns props into markup. No logic. |
| **Component** | Reusable pieces of markup. |

**4. Rules you can read and change.** The conventions are rules with ids such as `PAGE-003` ("pages cannot import services"). `construct validate` reports each violation with the file and line, why the rule exists and how to fix it. Your `architecture.yml` sets each rule to `error`, `warning` or `off`, and can grant time-limited exceptions with a reason and an owner. See [Tune the rules](@user-guide/how-to/tune-rules/) and the [rule reference](@developers/rules-reference/).

**5. Every action leaves a record.** Each command ends with a line such as `[tool: scaffolded the file(s) above from templates] [llm: 0 calls]`. That line is the record of what happened and whether a model was involved.

## More detail

**Order is enforced.** Files import each other, so they are created in dependency order (`domain`, `service`, `workflow`, `hook`, `component`, `page`, `controller`), and rule `IMPORT-001` fails validation if a relative import points at a file that does not exist.

**Two targets.** Next.js App Router (the default) and client-routed single-page apps (`react-spa`). Only the route part differs. Set it with `project.framework` in `architecture.yml` or `construct init --framework`.

**Two ways to drive it.** The command line is the complete interface. The Cockpit is a browser front end over the same commands, for when you would rather click than type, or want to watch. It adds no logic and makes no model calls of its own.
