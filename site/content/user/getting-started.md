Construct runs from a checkout of its repository and needs **Node.js 20 or newer**. This page takes you from nothing to a validated project with your first feature in about five minutes.

## 1. Install

```bash
git clone https://github.com/thenewurbankid-web/construct.git
cd construct
npm install
npm link
```

`npm link` puts the `construct` command on your path. Check it works:

```bash
construct doctor
```

`doctor` prints your Node and npm versions and confirms that the rule engines are available.

## 2. Create a project

```bash
construct init my-app
cd my-app
npm install
construct sync
construct validate
```

`init` writes an `architecture.yml` (the rules for your project), an `AGENTS.md` and a small starter feature called `core`. By default it targets a Next.js App Router app; for a client-routed single-page app use `construct init my-app --framework react-spa`.

A fresh project passes validation. You may see a warning about the starter feature's public API having no description, which is a reminder, not a failure. `validate` exits with a non-zero status only when something is an **error**.

## 3. Add your first feature

A **feature** is a folder that owns everything for one part of your app. Create one, then add a slice of it in a single command:

```bash
construct create feature billing
construct create layer Invoice --feature billing --layers domain,hook,page,controller
```

Each command lists the files it wrote and how many AI calls it made. Unless you pass `--llm`, that number is zero and every file is a plain template you fill in yourself.

Check the result:

```bash
construct validate
```

Construct always builds layers in dependency order, whatever order you list them in, so imports resolve. If you skip one that a later file needs (a controller without its page, for example), `validate` says exactly which file is missing.

## 4. Look around

```bash
construct research summarize --feature billing --format compact
construct research workflow billing
```

`summarize` describes a feature in plain English from its code. `research workflow` explains any state machines in it. Both are read-only.

## 5. Open the Cockpit UI (optional)

Everything above also works from a browser. Start the two halves in separate terminals:

```bash
cd ui/server && npm install && npm start      # API on http://localhost:4000
cd ui/client && npm install && npm run dev    # app on http://localhost:3000
```

Open <http://localhost:3000>. The **Settings** page tells the UI which project directory to work on. See [Using the Cockpit UI](@user-guide/cockpit/).

## Where next

- [Core concepts](@user-guide/concepts/) explains features, layers and rules in plain language.
- The [how-to guides](@user-guide/how-to/) cover each task: creating, refactoring, importing, tuning rules.
- The [tutorials](@user-guide/tutorials/) show real command output and screenshots.
