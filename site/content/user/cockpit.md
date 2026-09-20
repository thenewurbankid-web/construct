The Cockpit is a browser screen for the same small tools the command line runs, so you can watch and steer instead of typing each command. Worked examples with real screenshots are in the [Cockpit examples](@user-guide/examples/cockpit-plan-and-run/).

## Start it

```bash
cd ui/server && npm install && npm start      # backend on http://localhost:4000
cd ui/client && npm install && npm run dev    # frontend on http://localhost:3000
```

Open <http://localhost:3000>. Pick the project it works on with the project switcher in the top bar (or **Settings**). The choice is held in memory, so restarting the backend resets it.

## What each screen is for

The top bar has four entries.

| Entry | What you do there |
|---|---|
| **Explore** | Read what exists: pages and their elements, workflows drawn as diagrams with a plain-English narrative, and tests for every route through a flow. |
| **Plan** | Describe a change, see what it touches, run it in its own copy of the repository, and approve each changed file. |
| **Build** | Import an existing route step by step, and approve the proposed plan before anything is written. |
| **Review** | Compare a branch against a base: what each change means, five indicators from your own rules, and findings split into mechanical fixes and decisions. |

Other screens: **Local Model** (the local model used for small scoped steps), **Settings** (project folder and which AI provider each optional capability uses) and **Help** (the in-product guide and the command reference).

## A model only when you say so

Choosing a provider in Settings never triggers a call by itself. A step calls a model only when you tick an explicit box on that form, or when a plan step says its executor is a local model. The Build wizard always asks for your approval before writing files.

## More detail

- **Layout.** A **Browser** pane on the left, the main area in the middle and a **Tools** pane on the right. `Ctrl K` opens the command palette, `Ctrl J` the bottom drawer (Diagnostics, Logs and Processes), `Ctrl B` and `Ctrl Alt B` hide the side panes. Below 900 px wide one pane shows at a time. There is a light and a dark theme.
- **Serving elsewhere.** The backend only accepts requests from `http://localhost:3000`; if you serve the frontend elsewhere, start the backend with `UI_CLIENT_ORIGIN` set to that address.
- **Login.** It binds to `127.0.0.1` with no login by default. A non-loopback host refuses to start without a GitHub login and an allowlist; see [Sign-in allowlist and commit on save](@user-guide/examples/cockpit-sign-in-and-commits/).

## Examples

[Plan, run and approve](@user-guide/examples/cockpit-plan-and-run/), [review](@user-guide/examples/cockpit-review/), [tests](@user-guide/examples/cockpit-tests/) and [sign-in and commits](@user-guide/examples/cockpit-sign-in-and-commits/).
