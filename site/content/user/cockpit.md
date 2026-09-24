The Cockpit is the browser app in the package: the same small tools [Construct](@user-guide/construct/) runs on the [command line](@user-guide/cli/), as screens you can watch and steer instead of typing each command. Worked examples with real screenshots are in the [Cockpit examples](@user-guide/examples/cockpit-plan-and-run/).

## Start it

```bash
cd ui/server && npm install && npm start      # backend on http://localhost:4000
cd ui/client && npm install && npm run dev    # frontend on http://localhost:3000
```

Open <http://localhost:3000>. Nothing is open yet: the **Open a project** screen lists the projects in your workspace (it cannot browse anywhere else), offers to reopen the last one you had open, and shows **Try the sample shop** when a folder named `shop` is there. Later, change project with the project switcher in the top bar. The choice is held in memory, so restarting the backend resets it.

## The five screens

A rail on the left lists the five screens. The arrow at its top collapses it to icons; the choice is remembered.

| Screen | What you do there |
|---|---|
| **Features** | Read what a feature is made of: pick one from the list to see its summary, routes, layers and files, workflows and tests. Above the details, **Create**, **Refactor**, **Research** and **Import** open the same forms the command line runs. The **Notes** tab beside the list is where you describe a change; the middle shows what it touches, and the **Plan** tab on the right builds the steps and runs them. |
| **Pages** | Every page of the project. Open one to see it in the live preview, with its node tree on the left and **Inspector**, **Scope**, **Source**, **Palette** and **Diff** on the right. |
| **Components** | Every component, documented from its own file: name, feature, path and props. Below that, the file as plain text; **Review** shows the diff and **Confirm** writes it, unless it breaks one of your rules. The workflow viewer (diagrams with a plain-English narrative) lives under this screen at `/workflows`. |
| **Git** | Your local branches compared against a base, riskiest first. Open one to read what each changed unit now does, the health indicators, and the findings split into mechanical fixes and decisions. |
| **Tests** | Every route through a feature's workflow and whether it has a test. Generated tests are locked; clone one to edit it as steps. |

**Settings** (project folder and which AI provider each optional capability uses), **Local model** (the local model used for small scoped steps) and **Help and shortcuts** (the in-product guide and the command reference) are in the profile menu at the right of the top bar, with the theme (Dark, Light or System) and Sign out.

## A model only when you say so

Choosing a provider in Settings never triggers a call by itself. A step calls a model only when you tick an explicit box on that form, or when a plan step says its executor is a local model. The Import Wizard always asks for your approval before writing files.

## Clone a private repository with your GitHub login

The **Open a project** screen also clones. Paste `owner/repo`, a link from the browser or a whole clone command line and press **Clone and open**; a public repository needs nothing else. For a private one you have two ways in, and the second is always there:

1. **Use my GitHub login.** When the person who runs your Cockpit has set it up, the clone form shows **Connect GitHub for private repositories**. It is a separate, one-time permission, apart from signing in: GitHub asks you to allow the Cockpit's GitHub app, then brings you back. From then on **Use my GitHub login** is the default, with a list of the repositories the app can read to pick from (the pick fills the address; nothing is cloned until you press **Clone and open**). **Settings** shows whether you are connected and as which account, and **Disconnect GitHub** (on the form or in Settings) takes it away at once.
2. **Paste an access token.** The token field stays as the fallback: a read-only fine-grained token, used once for that clone and never saved.

The connection is held only in the server's memory. It is never written to disk, a cookie, a log or a page, and it ends when you sign out, disconnect, or the server stops. It is used only for `github.com` addresses. If a clone says your connection cannot see a repository, the Cockpit's GitHub app is not installed on it: install it on that repository, and for an organisation's repository an organisation owner has to install or approve it. When the server has no such app set up, none of this appears and the token field works exactly as before.

## More detail

- **Layout.** A **Browser** pane on the left (under the rail), the main area in the middle and a **Tools** pane on the right; each screen fills the panes with its own tabs. The top bar holds the project switcher, the command palette, a **Processes** count and the local model status, the Browser and Tools toggles and the profile menu. The status bar at the bottom shows the last validate result. `Ctrl K` opens the command palette, `Ctrl J` the bottom drawer (**Diagnostics**, **Logs** and **Processes**, where you pause, cancel and approve a run), `Ctrl B` and `Ctrl Alt B` hide the side panes, `F6` moves focus to the next pane. Below 900 px wide one pane shows at a time. There is a light and a dark theme.
- **Serving elsewhere.** The backend only accepts requests from `http://localhost:3000`; if you serve the frontend elsewhere, start the backend with `UI_CLIENT_ORIGIN` set to that address.
- **Login.** It binds to `127.0.0.1` with no login by default. A non-loopback host refuses to start without a GitHub login and an allowlist; see [Sign-in allowlist and commit on save](@user-guide/examples/cockpit-sign-in-and-commits/).

## Where it fits

The Cockpit adds no behaviour of its own: every screen calls the same functions the command line calls, so a change made here is the same change made there. Unlike the framework and the command line, the Cockpit is not open source — see [what Line is](@user-guide/line/).

## Examples

[Plan, run and approve](@user-guide/examples/cockpit-plan-and-run/), [review](@user-guide/examples/cockpit-review/), [tests](@user-guide/examples/cockpit-tests/) and [sign-in and commits](@user-guide/examples/cockpit-sign-in-and-commits/).
