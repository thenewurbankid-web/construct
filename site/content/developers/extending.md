Construct is designed to be extended by adding small blocks, not by changing existing ones. Each recipe below names the real files involved; check [Building blocks](@developers/building-blocks/) first in case one already exists.

## Add a rule

1. **Declare it** in `DEFAULT_RULES` in `src/config.mjs`: `'MY-001': { severity: 'error', name: 'What it enforces' }`. That makes it configurable in `architecture.yml` and gives it "did you mean" suggestions for typos.
2. **Check it** in the enforcer that owns the concern (`architecture-enforcer.mjs`, `soc-enforcer.mjs` or `readability-enforcer.mjs`). Read the configured severity from `config.rules[id]`, honour `off` and `exceptions:` (the architecture enforcer's `pushViolation` does both), and report with `makeViolation` from `src/diagnostics.mjs`. Every violation needs a `why` and, where possible, `expected` and `suggestedFix`: the message is aimed at a person or model who has to fix it.
3. **Test it** in `test/` with a fixture project that violates the rule and one that does not.
4. **List it**: the [rule reference](@developers/rules-reference/) is generated from `DEFAULT_RULES`, so it appears automatically.

A whole new enforcer is one more `{ name, validate(root) -> { violations } }` entry in `src/engine/defaultEnforcers.mjs`; the registry merges the results.

## Add or change a layer template

Generated files come from templates in `src/generators.mjs`. Each layer has a template, a folder, a file-name convention (`layerFileBaseName`) and a constraint string (`LAYER_CONSTRAINTS`) that is shown verbatim to any model asked to fill the file. Generation order is `LAYER_ORDER`.

A project can override a layer's template without touching Construct, using `templates: { <layer>: <path> }` in its `architecture.yml`. After changing a template, run the tests: generated code is validated against the enforcers and a template that produces an invalid file fails.

## Add an LLM provider

Providers live in the `PROVIDERS` map in `src/llm.mjs`: a name mapped to `async (prompt, options) => string`. Add an entry and `--llm <name>` accepts it; nothing else changes, because every model call in Construct goes through `callLlm`. Throw `ConstructError` for failures. Replies written into files also pass through `src/llm-fill.mjs`, which requires them to parse before they are written. Keep providers out of everything except this module so the rest of the tool stays repeatable.

## Add a deterministic block

Give it a single entry point, JSDoc, tests, and a row in `docs/capabilities.md` (which appears on the [Building blocks](@developers/building-blocks/) page). If it reads or writes TypeScript/JSX, build on `packages/ast` rather than a new parser. If it must touch several files, stage them through `createTransaction` so a failure leaves nothing half-written.

## Add a CLI command

Commands are dispatched in `bin/construct.mjs` to functions exported from `src/cli.mjs`. Add the function, add its usage to `src/usage.mjs` (the [CLI reference](@developers/cli-reference/) is generated from it), and mention it in the README's command list.
