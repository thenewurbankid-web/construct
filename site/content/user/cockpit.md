The Cockpit is a browser front end for the same building blocks the CLI runs. It lets you watch and steer what Construct does instead of typing each command. It lives in the repository under `ui/`. Worked, screenshot-led examples are in the [Cockpit examples](@user-guide/examples/cockpit-plan-and-run/).

## Start it

```bash
cd ui/server && npm install && npm start      # backend on http://localhost:4000
cd ui/client && npm install && npm run dev    # frontend on http://localhost:3000
```

Open <http://localhost:3000>. The backend only accepts requests from `http://localhost:3000`; if you serve the frontend elsewhere, start the backend with `UI_CLIENT_ORIGIN` set to that address.

By default it binds to `127.0.0.1` with no login. To expose it, or to require a login, see [Sign-in allowlist and commit on save](@user-guide/examples/cockpit-sign-in-and-commits/): a non-loopback host refuses to start without a GitHub login and an allowlist.

Pick the project the Cockpit works on with the project switcher in the top bar (or **Settings**). The directory is held in memory, so restarting the backend resets it.

## The frame

Every screen sits in one shell: a **Browser** pane on the left, the **stage** in the middle and a **Tools** pane on the right. `Ctrl K` opens the command palette, `Ctrl J` the bottom drawer (Diagnostics from `construct validate`, Logs, and Processes), `Ctrl B` and `Ctrl Alt B` hide the side panes. Below 900 px wide only one pane shows at a time. There is a light and a dark theme.

## The four modes

| Mode | What you do there |
|---|---|
| **Explore** | Read what exists: the **Pages Editor** (element tree, click-to-source, prop flow, saved edits checked against your rules), **Workflows** (each state machine as a diagram with a plain-English narrative, scenarios and health) and **Tests** (coverage of every route through a flow, locked generated tests, clones, the step editor). |
| **Plan** | Turn a ticket into a plan you can read, see its impact, run it as a bot in its own branch, and approve each changed file. The Dashboard (create, refactor, research and import forms) also lives here. |
| **Build** | The guided import wizard: name a route, answer questions, review the proposed plan and approve it before anything is written. |
| **Review** | Compare local branches against a base: what each change means, five indicators from your own rules, and findings split into mechanical fixes and decisions. |

Other screens: **Local Model** (manage the local Ollama model used for small scoped steps), **Settings** (project directory and which AI provider each optional capability uses) and **Help** (the in-product guide and the CLI reference).

## How a model is handled in the UI

Choosing a provider in Settings never triggers a call by itself. A step calls a model only when you tick an explicit box on that form, or when a plan step says its executor is a local model, and then it uses the provider Settings names for that capability. Whole-feature planning in the Build wizard is restricted to a hosted provider, not a local model, and the wizard always asks for your approval before writing files.

## Examples

Each screen above has a worked example with real screenshots: [plan, run and approve](@user-guide/examples/cockpit-plan-and-run/), [review](@user-guide/examples/cockpit-review/), [tests](@user-guide/examples/cockpit-tests/) and [sign-in and commits](@user-guide/examples/cockpit-sign-in-and-commits/).
