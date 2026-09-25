# @line/construct-mcp

Construct's deterministic blocks as [MCP](https://modelcontextprotocol.io) tools, over stdio. An LLM client (Claude Code, an IDE
agent, any MCP client) gets the same fixed-size summaries, closed options and validated plans a person gets in the Cockpit, so
automated work runs through repeatable machinery instead of tokens.

**Read-only and plan-only.** Every tool wraps an existing block; none has logic of its own. A tool that would change files returns
a plan preview and the files it would touch, and never applies it. Applying goes through the Cockpit's per-diff approval, or the
`construct` CLI with an explicit approve step. Nothing here writes a file, runs a command or opens a network connection.

Private package: published to the private registry (`publishConfig` in `package.json`, `UNLICENSED`). `@line/construct-core` and
the open packages never depend on it. Built on the official MCP TypeScript SDK v2 (`@modelcontextprotocol/server`, MIT) and `zod` 4
(MIT), plus the SDK's own core package; nothing else at runtime (the SDK client is a dev dependency, for the tests).

## Use it with Claude Code

```bash
claude mcp add construct -- node <path>/packages/mcp/bin/construct-mcp.mjs --root <project>
```

`<path>` is this checkout (or the installed package's directory), `<project>` the Construct project the tools should read. The root
is fixed when the server starts (`--root`, default the working directory) and is never a tool argument. From the private registry:
`npm i -g @line/construct-mcp`, then `claude mcp add construct -- construct-mcp --root <project>`.

Startup options: `--rate-limit <n>` calls per minute (default 30, a token bucket shared by all tools), `--max-output <bytes>` a
lower per-call output cap (the default and the maximum are 32 KiB). Environment: `CONSTRUCT_DECISION_PLUGINS=on` lets `decide`
load a decision plugin the project's `architecture.yml` names (off by default: the deterministic `rules` provider answers).

## Tools

All eight are annotated `readOnlyHint: true`. Every result is JSON text of `{ ok: true, ... }`, or `{ ok: false, error: { code, message } }`
with `isError: true`. Results are bounded (lists have fixed maximums and say `truncated`), and all paths in them are project-relative.

| Tool | What it wraps | Example call |
| --- | --- | --- |
| `requirement_parse` | `parseRequirement`: a sentence to a requirement card; words the lexicon does not know come back as closed questions of 2-5 options | `{ "text": "A user wants to see a list of products" }` |
| `placement_place` | `placeCard` then `planFromBlocks`: blocks, open questions and offers, a plan preview with the files each step touches, its `proof` and `wiring` | `{ "text": "A user wants to see a list of products", "answers": [{ "id": "q-shape", "option": "list" }] }` |
| `plan_validate` | `validatePlan` on a plan (plan v1 JSON), with what each step would touch | `{ "plan": { "version": 1, "ticket": { "source": "text", "title": "x" }, "steps": [] } }` |
| `decide` | the decision provider, as `construct decide`: a suggestion for one question summary or for every open question of a sentence | `{ "text": "A user wants to see a list of products" }` |
| `summarize` | `construct summarize`: per feature its lines of code, public API and files per layer, plus the compact paragraph | `{ "feature": "billing" }` |
| `validate` | `construct validate`: pass or fail, counts by severity and rule, the first findings with rule id, file, line, message and fix | `{ "limit": 5 }` |
| `machine_capabilities` | `classifyMachine` and `capabilities`: the tier (Lite, Cockpit use, Contributor) and what memory and cores allow | `{}` |
| `traces_stats` | `traceStats`: how many decisions were recorded, how often a suggestion was accepted, the outcomes | `{ "chooser": "app.unit" }` |

The intended order: `requirement_parse`, then `placement_place` (answer the closed questions in `answers`, call again with the same
text), then `plan_validate` on any plan the model wrote itself. `summarize` and `validate` describe the project before a file is read.

## Safety model

- **One root, fixed at startup.** No tool takes a path. A feature is a name (`../x`, `/etc`, `a/b` are refused as `PATH_OUTSIDE_ROOT`).
  A plan naming a path outside the project (an absolute path, `~`, `..` in a step's files or path arguments) is refused before it is checked.
  Before a tool reads the project, the tree is walked once for links: a symlink whose real path leaves the root refuses the call
  (`PATH_OUTSIDE_ROOT`), so nothing is read through it. Startup refuses a root that is not a directory, `/` or the home directory.
- **Nothing writes.** No file is created, changed or removed, no plan is applied, no command is run, no network is used. A test hashes the
  project and the state directory before and after every tool and a second test scans the source for any write, process or network API.
- **The one read outside the root**: `traces_stats` reads this project's own trace file in the per-user state directory
  (`CONSTRUCT_STATE_DIR`), read-only, and returns counts only: never a record, a path or a question text.
- **Path-free, secret-free output.** Every string of every result is cleaned: the root becomes `.`, the home directory `~`, any other absolute
  system path `[path]`, and a string shaped like a secret `[redacted]`. Errors carry a code and one sentence, never a stack trace.
- **Bounded.** Inputs: a sentence 2000 characters, 20 answers, a plan 64 KiB and 200 steps, a decision summary 16 KiB and 5 options. Output:
  32 KiB per call (a larger result is refused whole with `OUTPUT_TOO_LARGE`, never cut in the middle). Rate: 30 calls a minute by default
  (`RATE_LIMITED` with `retryAfterSeconds`).
- **Attribution.** Answers given to `placement_place` are returned in `decisions` as `by: 'llm'` with the MCP client's name as `provider`,
  exactly as the decision traces would record them. No tool records a choice in this slice: nothing is written to the decision traces, so
  `traces_stats` counts only what the Cockpit and the CLI recorded.
- **A decision plugin is project code.** With `CONSTRUCT_DECISION_PLUGINS=on` the plugin file named in the project's `architecture.yml` runs
  inside the server (contained to the project, 3 s timeout, fallback to `rules`). That is the one place a project's own code can run here;
  it is off unless the person who starts the server turns it on.

Error codes (`ERROR_CODES` in `src/limits.mjs`): `INVALID_INPUT`, `PATH_OUTSIDE_ROOT`, `RATE_LIMITED`, `OUTPUT_TOO_LARGE`, `NOT_FOUND`,
`PARSE_FAILED`, `ANSWER_REFUSED`, `PLACEMENT_REFUSED`, `PLAN_REFUSED`, `INVALID_SUMMARY`, `CONFIG_UNREADABLE`, `PROJECT_TOO_LARGE`, `TOOL_FAILED`.

## Cost

About 175 ms to answer `initialize` and `tools/list`, about 70 MB peak memory (the core blocks are loaded by the tool that needs them, not
at startup). Budget: under 1 s and 150 MB, asserted in `test/startup.test.mjs`.

## Out of scope in this slice

Write tools of any kind (applying a plan, `create`, `refactor`), resources and prompts, an HTTP transport, authentication (stdio only: the
client that starts the process is the only caller), recording an LLM's choices as decision traces (`by: 'llm'`), a `chooser_summary` or
`plan_from_blocks` tool separate from the two above, tool probes in `machine_capabilities` (ffmpeg, a browser, Ollama: `construct doctor`
does those), and Windows (untested).

## Develop

```bash
node --test packages/mcp/test/*.test.mjs      # the package's tests
node packages/mcp/bin/construct-mcp.mjs --help
```
