This page covers the architecture Construct **enforces on target projects**: layers, rules and policy. For how Construct itself is organised as code, see the [repository layout](@developers/repository-layout/).

{{include docs/ARCHITECTURE.md#Construct Architecture Specification level=1 nohead}}

## The default layer graph

{{include README.md#Default architecture level=3 nohead}}

## Framework targets

{{include README.md#Framework targets level=3 nohead}}

## How `construct validate` works

`validate` loads `architecture.yml` (`src/config.mjs`), then runs a fixed list of enforcers (`packages/engine/defaultEnforcers.mjs`) and merges their findings:

| Enforcer | Module | Checks |
|---|---|---|
| `architecture` | `src/architecture-enforcer.mjs` | who may import whom, per layer; import resolution; frozen-markup rules |
| `separation-of-concerns` | `src/soc-enforcer.mjs` | responsibilities that do not belong together (`SOC-001`) |
| `readability` | `src/readability-enforcer.mjs` | naming, file length, public-API documentation (`READ-*`) |
| `public-api-drift` | `src/api-composer.mjs` | a feature's `index.ts` matching what it should export |

Every finding is a violation object built by `makeViolation` (`src/diagnostics.mjs`) with a fixed shape: `rule`, `module`, `severity`, `file`, `line`, `message`, `why`, `expected`, `suggestedFix` and optionally `docsUrl`. `--format json` prints them as `{ status, violations }`. The process exits with `0` (no errors), `1` (violations), `2` (usage error) or `3` (internal error). Severity comes from `architecture.yml`; a scoped, time-boxed `exceptions:` entry can silence a rule for a path.

The layer graph itself (`src/architecture-graph.mjs`) is data, not code: which layer may import which. The enforcers and the generators both read it, so they cannot disagree.

Because the same enforcers run inside generators (`packages/engine/transactionalWriter.mjs` validates a shadow copy before committing), generated output is held to the rules it will later be checked against.
