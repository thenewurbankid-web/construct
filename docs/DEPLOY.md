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
| `CONSTRUCT_WORKSPACE_ROOT` | no | `/workspace` (set by compose) | the one folder projects open from, inside the `cockpit-workspace` volume |
| `PUBLIC_HOST` | no | `localhost` | host the client is reachable at (baked into the client build) |
| `SCHEME` / `WS_SCHEME` | no | `http` / `ws` | `https`/`wss` behind TLS |

`CONSTRUCT_WORKSPACE_ROOT` and process/test state (`~/.local/state/construct`)
persist in the named volumes `cockpit-workspace` and `cockpit-state` — clone
projects into the workspace from inside the running container
(`docker compose exec server sh`) or mount a host directory instead of the
named volume if you'd rather manage it directly.

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
