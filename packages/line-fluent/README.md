# @line/fluent

Tooling that turns JavaScript into Smith's Atomic English and checks it: the answer contract (C2), the gate runner
(C3), the comparator (C4) and grammar completions (C5). One folder per task: `contract/`, `gate/`, `compare/`,
`grammar/`. Contracts and tasks: `docs/line/FLUENT-PLAN-2026-10-15.md`. Private (construct-private only).

## Atom generator (T5.1, `generator/`)

One C1 entry -> C2 answer (request builder, runner, gate) -> a pending proposal; only `approve` writes the catalog.

```
node packages/line-fluent/generator/cli.mjs generate "Array.prototype.flatMap" [--fixtures f.json | --real [--model m] [--url u]] [--retries n] [--out dir]
node packages/line-fluent/generator/cli.mjs approve packages/line-fluent/generator/proposals/Array-prototype-flatMap.json [--catalog path]
```

Without `--fixtures` or `--real` the rules-only model answers (reuse a candidate atom, else not-expressible). `--real`
calls the local student model (Ollama). `approve` refuses proposals that failed the gate, add no atom, or name a
taken atom id. The gate today is schema + grammar; equivalence and types plug into `defaultGate(checks)`.
