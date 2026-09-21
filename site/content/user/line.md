Line is the name of the whole package: one framework, two ways to drive it, and this documentation covering all of it. Everything here belongs to one of the three parts below.

## The three parts

| Part | What it is | Start here |
|---|---|---|
| **Construct** | The framework. Your project's rules in a file, the small tools that keep to them, and the plain JavaScript functions those tools are built from. | [What Construct is](@user-guide/construct/) |
| **Cockpit** | The browser app. The same tools as screens you can watch: explore what exists, plan a change, run it in a branch, approve each file, review and test. | [Using the Cockpit](@user-guide/cockpit/) |
| **Command line** | The terminal. One command per job, for your shell, your scripts and CI. It has no name of its own: the command is just `construct`. | [Using the command line](@user-guide/cli/) |

## How they fit together

Construct holds all the behaviour. The Cockpit and the command line are two faces of it: the Cockpit adds no logic and makes no model calls of its own, and the command line is the complete interface. Underneath both is the same set of exported functions, called the **core API** — JSON in, JSON out — so a script, a build step or a bot reaches exactly what you reach by clicking or typing.

Nothing calls an AI model unless you ask for it. On the command line that means the `--llm` flag; in the Cockpit it means ticking the box on the form in front of you. Every action ends with a line saying what ran and how many model calls it made.

## Which parts are open source

The core library and the command line are open source under the MIT licence. The Cockpit and the curated ready-made pipelines are not, and the open packages never depend on them. That boundary is deliberate: anything you automate against the core stays open.

## Where to go next

- New here? [Getting started](@user-guide/getting-started/) has a working project in 60 seconds.
- Want the model behind it? [The five ideas](@user-guide/concepts/), one sentence each.
- Want proof? [Examples](@user-guide/examples/): the problem, the exact command or screen, the exact result — kept apart for the command line, the Cockpit and the core API.
