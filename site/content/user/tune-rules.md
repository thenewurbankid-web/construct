Your project's conventions live in `architecture.yml`. Change them there; nothing else needs editing.

## Validate

```bash
construct validate                      # human-readable report, exit 1 if any error
construct validate --format json        # the same findings as JSON, for scripts and CI
```

Each finding gives a rule id, severity, file and line, why the rule exists, what was expected and a suggested fix.

{{include README.md#Modifying conventions level=2 nohead}}

## Rules that take options

A rule can also be given an object instead of a bare severity, to tune its thresholds. For example, the frozen-markup rules accept `similarity` and `maxOwnElements`:

```yaml
rules:
  PAGE-007: { severity: error, similarity: 0.9 }
```

`CLIENT-001` (a `'use client'` file cannot import server-only code) takes a `serverOnly` list of your own server-only packages, on top of the built-in databases and SDKs, and `serviceLayer: false` when your services are browser-side API clients rather than server code. It is `error` in a project made by `construct init` and `off` in an existing one until you turn it on:

```yaml
rules:
  CLIENT-001: { severity: error, serverOnly: [acme-billing, '@acme/*'] }
```

The [rule reference](@developers/rules-reference/) lists every rule id and its default severity.

## The defaults you start from

You can loosen any of these with the settings above, but the defaults are deliberately strict.

{{include README.md#Non-negotiable defaults level=3 nohead}}
