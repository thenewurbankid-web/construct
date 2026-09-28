# Rules catalog (#549, part of #542's "Rules 3" epic)

`construct rules list` and `GET /api/rules` are two read-only views over the same data source:
every rule `construct validate` can report, with its default and effective severity. This is the
data source for #395's Cockpit Rules screen (per-project severity toggle composer); it does not
build that screen.

## Data source

`packages/core/rules-catalog.mjs`:

- `RULE_METADATA` -- a hand-maintained table, one entry per rule id, of `module`
  (`architecture` | `separation-of-concerns` | `readability`), `layers` (which layer(s) it applies
  to, `[]` for project-wide rules), `scope` (`buffer`: needs only the one file's own source;
  `project`: needs the whole project graph or an external process like `tsc`), `why`, `expected`
  and `fix` (a suggested-fix hint, or `null` where none exists).
- `catalogRules()` -- every rule above merged with its `defaultSeverity` from `DEFAULT_RULES`
  (`packages/core/config.mjs`), sorted by id. No project's `architecture.yml` applied.
- `listRules(root)` -- `catalogRules()` with `severity` resolved against `root`'s
  `architecture.yml`, if any (an override there wins over the built-in default). Called with no
  `root`, every rule comes back at its built-in default severity.

Detection logic (the enforcers that actually fire each rule) stays in `architecture-enforcer.mjs`,
`soc-enforcer.mjs` and `readability-enforcer.mjs`; this catalog is additive, read-only metadata for
*listing* a rule, not for enforcing it. See #545 ("Rules 2") for the separate, gated migration of
detection logic itself.

## CLI: `construct rules list`

```
construct rules list [--json] [--dir <path>]
```

Prints every rule as a tab-separated table (`id`, `module`, `layers`, `scope`, `severity`, `why`)
by default, or the full JSON shape (`{ ok: true, rules: [...] }`) with `--json`. `--dir` resolves
severity against that project's `architecture.yml`; with no `--dir`, every rule prints at its
built-in default severity.

## API: `GET /api/rules`

Returns `{ ok: true, rules: [...] }`, the same shape as `--json`, resolved against the open
project's `architecture.yml` (`ui/server/src/rulesApi.mjs`, a thin adapter over `listRules`).

## Rule shape

```ts
{
  id: string,               // e.g. "PAGE-001"
  module: string,           // "architecture" | "separation-of-concerns" | "readability"
  layers: string[],         // e.g. ["page"]; [] for a project-wide rule
  scope: 'buffer'|'project',
  defaultSeverity: string,  // from DEFAULT_RULES, before any override
  severity: string,         // defaultSeverity, or architecture.yml's override
  why: string,
  expected: string[],
  fix: string|null,
}
```
