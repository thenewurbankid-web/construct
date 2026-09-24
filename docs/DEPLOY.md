# Self-hosting the Cockpit (Docker)

Two images, one per process (`ui/server` Express+ws on :4000, `ui/client`
Next.js on :3000), wired by `docker-compose.yml` at the repo root — the same
two-process topology `tools/dev/run-hosted.sh` runs by hand. Both build from
one shared compiled step (see `ui/build.sh`, `ui/server/scripts/build.mjs`):
`ui/client` compiles with `next build` (`output: 'standalone'`), `ui/server`
is bundled with esbuild into `ui/server/dist/`.

This never touches `~/hosted-cockpit` or ports 80/443/3000/4000 there — run
it on your own host/ports.

## Quick start (local, no GitHub login)

```bash
git clone <this repo> && cd construct
CONSTRUCT_SESSION_SECRET=$(openssl rand -hex 32) docker compose up --build
```

Open http://localhost:3000. `CONSTRUCT_ALLOWED_LOGINS` is unset, so
`CONSTRUCT_GITHUB_CLIENT_ID/SECRET` unset means auth stays required-but-
unreachable for anything not loopback-only — for a real deployment, set the
GitHub OAuth vars below. `docker compose up --build` builds both images
(context `.`) and starts them; add `-d` to run detached.

## Real deployment (GitHub login, a public/reachable host)

```bash
export PUBLIC_HOST=cockpit.example.com     # or an IP
export SCHEME=https                        # http if you're not behind TLS
export WS_SCHEME=wss                       # ws if SCHEME=http
export CONSTRUCT_GITHUB_CLIENT_ID=...       # GitHub OAuth app
export CONSTRUCT_GITHUB_CLIENT_SECRET=...
export CONSTRUCT_ALLOWED_LOGINS=yourgithublogin
export CONSTRUCT_SESSION_SECRET=$(openssl rand -hex 32)
docker compose up --build -d
```

Register the OAuth app's callback URL as `${SCHEME}://${PUBLIC_HOST}:4000/auth/callback`
(or the path your TLS proxy forwards to :4000 — see `tools/dev/Caddyfile.hosted`
for the proxy pattern this mirrors; it fronts one HTTPS origin instead of
exposing :3000/:4000 directly, same idea applies here behind whatever proxy
you use).

`NEXT_PUBLIC_API_BASE`/`NEXT_PUBLIC_WS_BASE` are compiled into the browser
bundle at `next build` time (a Next.js convention, not a container runtime
setting) — `docker-compose.yml` passes them as build args from
`PUBLIC_HOST`/`SCHEME`/`WS_SCHEME`, so changing the host means rebuilding
the `client` image (`docker compose build client`), not just restarting it.

## Env vars

| Var | Required | Default | Purpose |
|---|---|---|---|
| `CONSTRUCT_SESSION_SECRET` | yes | — (compose refuses to start without it) | signs session cookies; `openssl rand -hex 32` |
| `CONSTRUCT_GITHUB_CLIENT_ID` / `_SECRET` | for login | unset | GitHub OAuth app credentials |
| `CONSTRUCT_ALLOWED_LOGINS` | for login | unset | comma-separated GitHub logins allowed in |
| `CONSTRUCT_GITHUB_REPO_CLIENT_ID` / `_SECRET` | no | unset | a second, dedicated GitHub App (or OAuth app) for cloning private repositories with the person's own GitHub login (see below). Both or neither; unset means the feature is off and invisible |
| `CONSTRUCT_GITHUB_REPO_CALLBACK_URL` | no | `CONSTRUCT_OAUTH_CALLBACK_URL` with `/auth/callback` replaced by `/auth/repo/callback`, else `http://localhost:<port>/auth/repo/callback` | where GitHub sends the browser back after the repository consent |
| `CONSTRUCT_GITHUB_REPO_SCOPE` | no | unset | only for an OAuth app (for example `repo`); a GitHub App ignores it and uses its own permissions |
| `CONSTRUCT_WORKSPACE_ROOT` | no | `/workspace` (set by compose) | the one folder projects open from, inside the `cockpit-workspace` volume |
| `PUBLIC_HOST` | no | `localhost` | host the client is reachable at (baked into the client build) |
| `SCHEME` / `WS_SCHEME` | no | `http` / `ws` | `https`/`wss` behind TLS |

`CONSTRUCT_WORKSPACE_ROOT` and process/test state (`~/.local/state/construct`)
persist in the named volumes `cockpit-workspace` and `cockpit-state` — clone
projects into the workspace from inside the running container
(`docker compose exec server sh`) or mount a host directory instead of the
named volume if you'd rather manage it directly.

## Private repositories with a GitHub login (optional, #638)

Sign-in (above) only proves who someone is (`read:user`). To let a signed-in person clone a private repository without pasting a token, register a **second, separate** app. Nothing changes for sign-in, and without these variables the clone form's token field works exactly as before.

Register a GitHub App (preferred; an OAuth app also works, the code is a standard authorization-code exchange and the app's permissions decide what can be read):

1. GitHub, Settings, Developer settings, GitHub Apps, New GitHub App. Name it, for example, "Line Cockpit repos". Homepage URL: the Cockpit URL. Callback URL: `<Cockpit origin>/auth/repo/callback`. Untick Webhook.
2. Permissions: Repository, Contents = Read-only (Metadata read-only is implied). Nothing else. Leave "Expire user authorization tokens" on: the server refreshes them itself before they run out. Where can it be installed: Any account (needed for an organisation's repositories).
3. Generate a client secret. Put `CONSTRUCT_GITHUB_REPO_CLIENT_ID` and `CONSTRUCT_GITHUB_REPO_CLIENT_SECRET` in the server's environment file (mode 600; for the hosted Cockpit, `~/.construct-hosted.env`). Never paste them in chat, an issue or a commit.
4. Install the app on the repositories the Cockpit should be able to clone. For an organisation's repository an organisation owner has to install or approve it; without that the repository stays invisible to the connection, and the clone says so.

How it behaves: **Connect GitHub for private repositories** (clone form or Settings) sends the browser to GitHub and back to `/auth/repo/callback` (a `state` bound to the session, single use, valid ten minutes). The resulting user access token (and refresh token, if the app issues expiring ones) is held only in the server's memory, per signed-in login: never on disk, in a cookie, a job record, a log line, an error or any response. It lives no longer than its own expiry or the Cockpit session, is refreshed server-side before it expires, and is zeroed on sign-out, on **Disconnect** (which also asks GitHub to revoke it) and when the server stops. A clone or update uses it only for `github.com` addresses, handed to the clone process through the same one-shot `GIT_ASKPASS` pipe as a pasted token, so it never appears in a command line or environment. Routes: `GET /api/github/status`, `GET /api/github/repos` (names and visibility only), `POST /api/github/disconnect`, `GET /auth/repo/start`, `GET /auth/repo/callback`; a clone or pull takes `useLogin: true` instead of `token` (never both).

## What's built, and a known limitation

`ui/server/dist/` is `ui/server`'s own ~80 files bundled into 3 compiled
entry points (`index.mjs` + the two forked worker scripts) — no `.mjs`
sources or `*.test.mjs` of ui/server's own code ship. It still imports the
repo's core (`src/`, `bin/`) by relative path, same as it does today
uncompiled (see `ui/server/scripts/build.mjs`'s header comment for exactly
why bundling those in would break several core modules' own
`import.meta.url`-relative file lookups). The Docker image ships that core
tree alongside `dist/` — acceptable here since the image is built from a
private checkout and never published anywhere (per #480); once epic #480's
steps 5-7 split core into its own published `@line/construct-core` package,
`ui/server` can depend on it as a normal npm dependency instead and `dist/`
becomes fully self-contained.

## Verifying this without Docker

This document's instructions were written and the images' Dockerfiles were
authored by a session with no `docker`/`podman` binary available (verified:
`which docker` empty, no `/var/run/docker.sock`) — so `docker compose build`
itself has **not** been run here. What *has* been verified, on throwaway
ports, is the exact compiled output each image's `CMD` runs:

```bash
CONSTRUCT_WORKSPACE_ROOT=/tmp/some-workspace CONSTRUCT_SESSION_SECRET=$(openssl rand -hex 32) \
  CONSTRUCT_AUTH=off HOST=127.0.0.1 PORT=48401 node ui/server/dist/index.mjs
# -> GET /api/health returns {"ok":true,...} with real disk/git probes

PORT=48402 HOSTNAME=127.0.0.1 node ui/client/.next/standalone/server.js
# -> GET / and GET /dashboard return 200; static chunks served with
#    Cache-Control: public, max-age=31536000, immutable
```

Both ran the identical `node <entry>` command each Dockerfile's `CMD` uses,
against real HTTP requests. Building and running the actual images
(`docker compose up --build`) still needs to happen once on a host with
Docker before this is called fully proven end-to-end.
