# Security notes

Trace runs on your own machine and can write files and spend model tokens, so the server does not trust what a request says. This page lists the rules, the two settings in `ai.config.json` that widen them on purpose, and what a new route must do.

## The request guard (`src/http-guard.mjs`)

`server.mjs` calls `checkRequest(req, port)` once, before any routing, and reads every body through `readJsonBody`. The rules:

| # | Rule | Applies to | Refusal | Why |
| --- | --- | --- | --- | --- |
| 1 | `Host` must be `localhost`, `127.0.0.1` or `[::1]` with this server's own port | every request, including static pages and streams | 403 | DNS rebinding: a hostile name that resolves to 127.0.0.1 |
| 2 | a present `Origin` must be exactly `http://<that host>` | every method except GET and HEAD | 403 | a page on another site cannot drive the API |
| 3 | `content-type` must be `application/json` | every method except GET and HEAD | 415 | a plain `<form>` or a `text/plain` POST cannot send it, and anything else needs a browser preflight |
| 4 | the body must be a JSON object, at most 2 MB | routes that read a body | 400 (bad JSON, not an object, aborted upload), 413 (too large) | a bad or huge body never crashes the server |
| 5 | an exception in a route answers 500 with `{ "error": ... }` | all | 500 | the process keeps running |

**Every new route must go through `checkRequest`.** In practice: add the route inside the existing request handler in `src/server.mjs` (or a route module it calls) after the `checkRequest` line, never register a second `http.createServer`, never read `req` directly (use `readBody`, which is `readJsonBody`), and never dispatch a path before the guard. Then add the path to `POST_ROUTES` or `GET_ROUTES` in `src/server.test.mjs`: one test reads the route sources and fails when a path is registered without a line there, and the tests after it assert that every listed route refuses a foreign Origin, a foreign Host and a non-JSON body, and never reaches a model.

## What a request may choose for an AI call

A request can choose **a model name and nothing else**.

- In `ai.tasks` of `/api/run`, `/api/mail-chat`, `/api/suggest`, `/api/part-chat` and every other route that calls a model, only a task's `model` survives, and only if it matches `^[A-Za-z0-9][\w.:/@+-]{0,99}$`.
- `provider`, `baseUrl`, headers and API keys come only from the server's own files: the built-in defaults, `ai.config.json`, and an example's `ai.json`. The CLI (`--ai-task`) and the bench are trusted callers and may still set the provider.
- A base URL must be `http` or `https` with no user or password in it; anything else is dropped.
- Redirects are not followed, so a redirect can never carry a key to another host.

Which model names a request may pick depends on where the task goes:

| Where the task goes | A request may pick |
| --- | --- |
| a local provider (`ollama`, `jev`), or an OpenAI-compatible server on this machine (loopback) | any well-formed model name (using a local model costs nothing) |
| `anthropic`, or an OpenAI-compatible server that is not on this machine | only a model the server config already names (the `default` and any task) or lists under `allowedModels` |

## `allowedModels` (in `ai.config.json`)

The models a request may choose for a paid provider, per provider. Default: none listed, so a request can only re-pick models the config already names.

```json
{
  "default": { "provider": "anthropic", "model": "claude-haiku-4-5-20251001" },
  "allowedModels": {
    "anthropic": ["claude-haiku-4-5-20251001", "claude-sonnet-4-5"],
    "openai": ["my-hosted-model"]
  }
}
```

With that file, the Options menu (or an API client) can switch a task between those two Claude models, and a request for `claude-opus-4-1` is ignored: the task keeps the configured model. Entries that are not strings are ignored. The key is the provider name (`anthropic`, `openai`). It only widens the list of names; it never lets a request change the provider or the address.

## `keyHosts` (in `ai.config.json`)

The hosts an API key may be sent to. Default: none, plus the fixed rules:

- `ANTHROPIC_API_KEY` goes **only** to `https://api.anthropic.com`. Any other host is refused with an error before anything is sent; there is no setting that changes this.
- `OPENAI_API_KEY` (for an OpenAI-compatible server) goes to a loopback host (`localhost`, `127.x.x.x`, `[::1]`) or to a host listed in `keyHosts`. For any other host the request is sent without a key.

```json
{
  "default": { "provider": "openai", "model": "my-hosted-model", "baseUrl": "https://llm.example.com/v1" },
  "keyHosts": ["llm.example.com"]
}
```

Entries are lower-case `host` or `host:port` values, compared with the URL's host, which includes the port only when it is not the scheme's default (`llm.example.com`, `llm.example.com:8443`). Only the server's own `ai.config.json` is read for `keyHosts`; an example's `ai.json` and any request cannot add to it.

## Other things worth knowing

- The expression a model drafts for a placeholder is never run as JavaScript: `src/ai/safe-eval.mjs` parses it and interprets an allow-list (limits: 200 characters, 10,000 steps); the inspector's Stub route uses the same evaluator.
- The mail and part-chat fact checks are regex based and miss invented names or claims; see [MAIL-CHAT.md](MAIL-CHAT.md).
- Tests for all of this: `src/http-guard.test.mjs`, `src/server.test.mjs`, `src/ai/config.test.mjs`, `src/ai/safe-eval.test.mjs`.
- Install scripts: the only dependency with an install script is `esbuild` (a dev dependency that checks its platform binary). It is approved in `package.json` under `allowScripts` (see the README, Quick start); nothing else is allowed to run install scripts.
