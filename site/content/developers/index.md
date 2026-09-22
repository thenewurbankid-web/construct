Construct is a Node.js (ESM) command-line tool plus a browser front end. The core is a set of small, deterministic modules with one entry point each. This section is for people who build on them, extend them or contribute changes.

## Where to start

| If you want to... | Read |
|---|---|
| understand how the pieces fit | [Architecture](@developers/architecture/) and the [repository layout](@developers/repository-layout/) |
| know exactly when a model is or is not involved | [Execution model](@developers/execution-model/) |
| chain generator steps with machine-readable state | [Context Envelope and pipeline](@developers/context-envelope/) |
| read or edit TypeScript/JSX programmatically | [The AST package](@developers/ast/) |
| reuse an existing block instead of writing one | [Building blocks](@developers/building-blocks/) |
| look up a command, flag or rule id | [CLI reference](@developers/cli-reference/), [Rule reference](@developers/rules-reference/) |
| add a rule, a layer or an LLM provider | [Extending Construct](@developers/extending/) |
| run the tests or send a change | [Testing](@developers/testing/), [Contributing](@developers/contributing/) |

## Design principles

- **Deterministic blocks first.** A capability is a small function or command that gives the same output for the same input. A model is called only where a deterministic block genuinely cannot do the job, only when the user opts in, and always through one module (`src/llm.mjs`).
- **One entry point per block.** Each area exposes a single module (`packages/ast/index.mjs`, `src/engine/pipeline.mjs`, `src/config.mjs`, ...) so it can be reused by the CLI, the UI backend and scripts.
- **Examples over instructions.** One layer's real output becomes the next layer's concrete example: the generated stub plus its layer constraint is what a model is shown when asked to fill it in.
- **The rules check everything.** Generated code, model-written code and hand-written code go through the same enforcers, so a wrong result is caught immediately instead of shipping.

## Licensing and scope

Construct is MIT licensed. This documentation covers what is in the repository and works today; it does not describe planned features.
