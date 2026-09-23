**Try it in 60 seconds** (needs Node.js 20 or newer)

```bash
git clone https://github.com/thenewurbankid-web/construct.git && cd construct && npm install && npm link
construct init my-app && cd my-app && construct create feature billing
construct validate
```

**You should see:** the files it created, `[llm: 0 calls ...]` (nothing was guessed), and a check that exits 0. The check may show two warnings that a starter feature's public API has no description. Those are reminders, not failures.

**Next:** [open the browser Cockpit](@user-guide/cockpit/), or read on to see what just happened.

## What just happened

**1. Install.** `npm link` puts the `construct` command on your path. `construct doctor` prints your Node and npm versions and confirms the checking tools are available.

**2. Create a project.** `construct init my-app` writes an `architecture.yml` (the rules for your project), an `AGENTS.md` and a small starter feature called `core`. It targets a Next.js App Router app by default; for a client-routed single-page app use `construct init my-app --framework react-spa`. Then, inside the project:

```bash
npm install
construct sync
construct validate
```

A fresh project passes. `validate` exits with a non-zero status only when something is an **error**.

**3. Add your first feature.** A **feature** is a folder that owns everything for one part of your app. Add a slice of it in one command:

```bash
construct create layer Invoice --feature billing --layers domain,hook,page,controller
```

Every command lists the files it wrote and how many AI calls it made. Unless you pass `--llm`, that number is zero and every file is a plain template you fill in yourself. Construct builds the parts in dependency order whatever order you list them in, so imports resolve. If you skip one a later file needs, `validate` says exactly which file is missing.

**4. Look around.** Both commands are read-only:

```bash
construct research summarize --feature billing --format compact
construct research workflow billing
```

`summarize` describes a feature in plain English from its code. `research workflow` explains any state machines in it.

**5. Open the Cockpit (optional).** Everything above also works from a browser. Start the two halves in separate terminals:

```bash
cd ui/server && npm install && npm start      # API on http://localhost:4000
cd ui/client && npm install && npm run dev    # app on http://localhost:3000
```

Open <http://localhost:3000>. The **Settings** page tells the Cockpit which project folder to work on. See [Using the Cockpit](@user-guide/cockpit/).

## Where next

- [The five ideas](@user-guide/concepts/) behind everything, one sentence each.
- The [how-to guides](@user-guide/how-to/) cover each task: creating, refactoring, importing, tuning rules.
- The [examples](@user-guide/examples/) show a problem, the exact command or screen, and the exact result, separately for the CLI, the Cockpit and the core API.

Checked against commit `d23283f` on 2026-09-23: the three quickstart commands were run in a fresh folder and printed the created feature, `[llm: 0 calls ...]` and two READ-003 warnings with exit code 0.
