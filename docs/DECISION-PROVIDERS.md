# Decision providers: the decision model as a pluggable tool (#633, part of epic #616)

A chain of closed questions (the Requirement screen's open questions, the list-shape offer, a placement question, a chooser) can
be given a **suggestion**: one option, a short reason and a runner-up. The suggestion comes from a *decision provider*. The
built-in `rules` provider needs no model; `off` never suggests; a **plugin** is any small file that follows the contract below
(a keyword classifier today, a trained model such as jev later). A provider only suggests. It never executes a step, never
chooses for the person and never sees a path or a credential.

Modules (`packages/core/`, none touches the network):

| module | job |
| --- | --- |
| `decision-provider.mjs` | the seam: `suggest`, `askProvider` (a call with a verdict), `providerInput` (what a provider is handed), the built-in `rules` and `off`, the registry |
| `decision-plugin.mjs` | `validateProviderContract` and `loadDecisionPlugin`: load a plugin file with containment (shared with `construct traces replay --plugin`) |
| `decision-project.mjs` | `openDecision(root)`: the project's provider from `architecture.yml`, lazy plugin load, fallback, log lines; `suggestForQuestions` |
| `config.mjs` | `normalizeDecision`: the `decision:` setting |

## The contract

A plugin file default-exports one object:

```js
export default {
  name: 'jev',        // lowercase letters, digits, . _ - ; at most 40 characters; not rules or off
  version: '0.1',     // a non-empty string, at most 32 characters; recorded beside every suggestion in a decision trace
  suggest(summary) {  // sync or async
    return { option: 'entity', reason: 'A plural noun is usually data.', score: 0.82, runnerUp: 'state' }; // or null
  },
};
```

- **Input.** `suggest` receives ONE argument, the summary: `{ id, question, options: [{ id, label, enabled, why }], chosen }`,
  at most 5 options and 16 KiB. It is a deep-frozen COPY reduced to exactly those four fields (a card question, a placement
  question or a chooser summary alike), every path hidden (`[path]`), and a summary that holds a secret-shaped string is refused
  before any provider is called. It cannot change what it was given, and there is no second argument.
- **Output.** `{ option, reason, score?, runnerUp? }` or `null` (or nothing): `option` must be an ENABLED option id of that
  summary, `reason` a non-empty string (kept to 200 characters, one line), `score` a number from 0 to 1 (optional), `runnerUp`
  another enabled option (optional). Anything else the plugin returns (extra keys, functions) is dropped.
- **`null` is an honest "I do not know".** It is not a failure: there is simply no suggestion and no fallback.
- **It never executes anything.** What comes back is a suggestion; the answer is still the person's click (or the LLM's call),
  recorded as a decision trace with the suggestion attached and `accepted: true` (taken) or `false` (overridden).

Because ids of options are stable (`docs/BLOCK-CONTRACT.md`, "AI-ready by design"), a plugin written today keeps working, and
`construct traces replay --provider <name>` scores it on what people really chose before it is trusted further.

## The project setting

In `architecture.yml`, top level:

```yaml
decision:
  provider: jev           # rules (default) | off | a plugin's name
  plugin: tools/jev.mjs   # a file inside the project (relative); only read when the provider is named and is not rules/off
  timeoutMs: 3000         # wait for a plugin at most this long (100 to 30000, default 3000)
```

`provider: rules` and `provider: off` never load a file, even if `plugin` is set. Naming only `plugin` means "that plugin".

**Strict checks.** The plugin path must be relative, must end in `.mjs`, `.js` or `.cjs`, and its real path (symbolic links
resolved) must stay inside the project: an absolute path, a `..` that leaves, or a link that points out is refused and never
imported. The file is loaded lazily, at the first suggestion, and only when named. The export is checked against the contract
before it is called.

**Fallback.** A plugin that cannot be loaded, is not allowed on this server, throws, is slower than `timeoutMs`, or answers
something that is not an enabled option and a reason is REPLACED by the `rules` provider for that question, and the response
says so (`fellBackFrom`). After one such failure in a request the plugin is not called again in it, so a slow model costs one
timeout, not one per question. Every load and every fallback is one line, path-free and secret-free, that can be logged and
kept beside a trace:

```
decision: loaded provider "jev" version 0.1 from the plugin file named in architecture.yml
decision: provider "jev" failed (timeout: no answer within 3000 ms); the rules provider answered instead
```

Plugin answers are cached per project, provider, version and summary, so a client that replays the whole chain on every request
asks the model once per question.

## Trust: a plugin is code

An imported module runs in the server's or the CLI's process with its permissions. Construct cannot sandbox it: the wall around
a plugin is the summary it is handed (frozen, path-free, secret-free) and the validation of what it returns, not isolation of
its code. Therefore:

- `construct decide` and `construct traces replay` run a plugin your own `architecture.yml` names, like any script you run in
  your own project.
- The Cockpit server imports a project's plugin only when it was started with `CONSTRUCT_DECISION_PLUGINS=on`. Otherwise a
  project you merely opened (a cloned repository) cannot get code run by naming a file in its settings: the rules provider
  answers and the response says why. The Playwright config turns it on for the test server.
- Construct does not fetch, install, update or download a plugin, and none is bundled.

## `construct decide`: the tool an LLM calls

```
construct decide --summary <file|-> [--provider <name>] [--format json] [--dir <path>]
construct decide --requirement "<sentence>" [--provider <name>] [--format json] [--dir <path>]
```

Read-only, deterministic with the built-in providers, no model unless the project names a plugin, and it writes nothing (not
even a trace). `--summary` takes a chooser or open-question summary as JSON from a file or stdin (`-`) and prints the
suggestion. `--requirement` runs `parseRequirement` and `placeCard` and prints, for each open question and offer, the provider's
suggestion and reason (while a word of the card is still unknown, the card's own questions are listed and nothing is placed).
`--provider` overrides the setting for one call. Notes about loads and fallbacks go to stderr; stdout stays one document.

```
$ construct decide --summary summary.json --format json
{
  "ok": true,
  "provider": { "name": "rules", "version": "1" },
  "requested": "rules",
  "fellBackFrom": null,
  "notes": [],
  "suggestion": { "option": "entity", "reason": "first available step", "runnerUp": "ui-part" }
}
```

Exit code 0 for an answer (a `null` suggestion included), 2 (`USAGE_ERROR`) for a missing or doubled input, an unreadable or
malformed summary (not JSON, not a summary, more than 5 options, over 16 KiB, a secret in it) or a sentence that cannot be read;
with `--format json` an error is `{ "ok": false, "error": { "code": "USAGE_ERROR", "message": "..." } }`. A suggestion never
applies itself: to act on it the caller answers the question the way a person does (the Requirement screen, or the flow's own
command).

## In the Cockpit

`POST /api/requirement/read` adds `suggestions` (per open question and offer id: `{ option, reason, runnerUp, score?, provider:
{ name, version }, fellBackFrom? }`) and `decisionProvider` (`{ name, version, requested, fellBackFrom, notes }`). The screen marks
the suggested option "suggested by rules" (or the plugin's name) with its reason; taking it is one click and choosing another is
one click. The answer is recorded through the decision-trace adapters (`docs/DECISION-TRACES.md`) with the suggestion attached
and `outcome.accepted: true|false`; with `provider: off` nothing is suggested and no suggestion is recorded.

## What is not here

Bundling or downloading a model, training, exporting traces for training (#647, #645), MCP exposure (#649), an `ignored`
outcome (a suggestion nobody looked at), and running a plugin in an isolated process. A plugin registered with
`registerDecisionProvider` from code still works and is used by name.
