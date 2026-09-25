Construct runs on a modest laptop. What you can do depends on how much memory, how many processor cores and how much free disk the machine has, and Construct tells you exactly where your machine stands instead of failing halfway.

## Check your machine

```bash
construct doctor
```

`construct doctor` reads your machine and prints the tier it meets, why, what is switched on and off and why, and the exact command that fixes each missing optional item. It changes nothing, uses no network beyond a 2 second look for Ollama on your own machine, and starts no model. It exits with 0 whatever it finds, except when your Node is too old or the machine cannot be read (exit 1). Add `--format json` for the same report as data.

## The three tiers

<!-- tiers:start -->
| Tier | For | Cores | Memory | Free disk |
|---|---|---|---|---|
| **Lite** | the command line only: summarize, validate, chains and plans, no Cockpit, no model | 2 | 4 GB | about 1 GB |
| **Cockpit use** | the prebuilt Cockpit, or a hosted one used from a browser, on top of the command line | 2 | 8 GB | about 2 GB |
| **Contributor** | building and testing this repository: the full test suite, the Cockpit build, Playwright | 4 | 8 GB workable, 16 GB comfortable | about 6 GB |
<!-- tiers:end -->

A machine that reports a little less memory than its label (a "16 GB" laptop often shows 15 GB, because the system keeps some) still counts: a tier's memory need is met at nine tenths of the number. Construct needs Node 20 or newer at every tier.

- **Lite** is enough to install Construct, create and check a project, summarize it, run chains and plans, and let a language model drive the command line. Nothing here starts the Cockpit or loads a model.
- **Cockpit use** adds the browser app, either the prebuilt one or a hosted one you open from a browser. You never build the Cockpit yourself at this tier.
- **Contributor** is for working on Construct itself: the full test suite, the Cockpit build and the browser tests. With less than the comfortable amount of memory, run one heavy job at a time (`packages/tools/dev/heavy.sh npm test` waits for the machine to be free enough before it starts).

## What a small machine switches off

On a Lite machine, or anything below it, every choice is made by the rules that ship with Construct. No plugin is loaded, no model is downloaded and nothing is slowed down waiting for one: the command line says "rules only" and the reason, and carries on. The features that need more than the command line are decided from the machine, not from a model:

| Feature | Needs |
|---|---|
| Model-backed proposals (a project's decision plugin) | Cockpit use or above |
| The Cockpit | Cockpit use or above |
| Playwright proofs (a screen proved in a browser) | Cockpit use or above, and a Playwright browser |
| Studio voice | Cockpit use or above, ffmpeg and a local voice |

Each one has a rules-only fallback that always works.

## Optional tools

`construct doctor` checks for these and prints the fix line when one is missing: ffmpeg and ffprobe (Studio video), a Playwright browser (`npx playwright install chromium`), Ollama (a local model server, looked for at `http://127.0.0.1:11434`), python3 (only for cloning your own voice) and the voice models. None of them is required for the command line.

## What the commands cost

Measured by `packages/tools/dev/benchmark.mjs`, which starts each command as a fresh process and records its time and its largest use of memory. The same script fails a build when a command goes past its budget. The numbers below are copied from its output.

<!-- measured:start -->
| Command | Cold start | Peak memory | Budget (time and memory) |
|---|---|---|---|
| construct --version | 50 ms | 45 MB | 0.6 s and 120 MB |
| construct validate (small project) | 480 ms | 135 MB | 3 s and 400 MB |
| construct summarize (small project) | 460 ms | 130 MB | 3 s and 400 MB |
| construct decide --requirement | 190 ms | 75 MB | 0.6 s and 150 MB |
| Cockpit server, start until it answers | 320 ms | 95 MB | 10 s and 400 MB |
<!-- measured:end -->

The small project is the `architecture-valid-react-spa` fixture, so a large project takes longer; the numbers show what starting Construct costs, not what your project costs.
