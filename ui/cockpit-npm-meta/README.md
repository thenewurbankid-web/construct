# @line/cockpit

Construct's Cockpit: a self-hosted, GitHub-login-gated UI over the
Construct CLI/engine. Compiled build only -- no `.ts`/`.tsx` source ships
in this package.

## Install / run

```bash
npx @line/cockpit
# or
npm install -g @line/cockpit && cockpit
```

Opens two processes on loopback: the Express+ws server on `:4000`, the
Next.js client on `:3000`. Visit http://localhost:3000.

For a shared/non-loopback host, set GitHub login before running:

```bash
CONSTRUCT_GITHUB_CLIENT_ID=... CONSTRUCT_GITHUB_CLIENT_SECRET=... \
CONSTRUCT_ALLOWED_LOGINS=yourgithublogin \
CONSTRUCT_SESSION_SECRET=$(openssl rand -hex 32) \
CONSTRUCT_WORKSPACE_ROOT=/path/to/projects \
npx @line/cockpit
```

`NEXT_PUBLIC_API_BASE`/`NEXT_PUBLIC_WS_BASE` are compiled into the client
bundle at build time and this published package is built for
`http://localhost:4000` -- the client and server this launches must be
reachable at that same host:port pair (loopback, or a TLS/reverse proxy
that forwards `localhost:4000` transparently). For a different public host,
build from the repo source instead (`docs/DEPLOY.md`), which lets you pass
`PUBLIC_HOST`/`SCHEME` at build time.

## What's in this package

- `ui/server/dist/` -- `ui/server` bundled with esbuild (3 compiled entry
  points: the Express app + the two forked worker scripts it uses for test
  runs and PR-health analysis). No `.mjs` source files of ui/server's own
  ~80 modules, no `*.test.mjs`.
- `ui/client/standalone/` -- `ui/client`'s Next.js production server
  (`output: 'standalone'`): `server.js` + its own pruned `node_modules`,
  static assets and `public/`.
- `src/`, `bin/` -- Construct's core CLI/engine, vendored as-is. `ui/server`
  calls straight into it (`create`/`refactor`/`research`/`importCommand`,
  test running, PR-health, component description, ...) by relative import,
  same as it does in the repo itself -- see the "Exceptions" section below
  for why this is still here instead of being an ordinary npm dependency.
- `launch.mjs` -- the `cockpit` / `npx @line/cockpit` entry point: starts
  both compiled processes together.

## Exceptions / known limitations

- **`src/`/`bin/` are vendored, not an npm dependency, for now.** Several
  core modules resolve sibling files relative to their own file location at
  runtime (`packageRoot` in `src/cli.mjs`, `REPO` in
  `src/engine/testRunner.mjs`, `BIN` in `src/engine/botRunner.mjs`,
  `WORKER_URL` in `src/engine/describeComponent.mjs`). Bundling them into
  `ui/server/dist/` would collapse each of those onto one location and
  break them (they each assume a different original depth) -- see
  `ui/server/scripts/build.mjs` in the repo for the full reasoning. Once
  construct's own epic #480 (steps 5-7) publishes core as
  `@line/construct-core`, this package can depend on it normally and drop
  the vendored copy. Not a license concern: core is itself headed for a
  public MIT release under that same epic.
- **One build target per publish.** See the `NEXT_PUBLIC_*` note above --
  rebuild (don't just restart) to change the public host/scheme.
- **Test running and PR-health analysis** fork real child processes and,
  for test running, expect a Playwright install reachable the way
  `src/engine/testRunner.mjs`'s `findPlaywright` looks for it -- see that
  module if a fresh install doesn't have it.

## Registry

Published to GitHub Packages (private, restricted), not public npm --
`npm install @line/cockpit` requires `.npmrc` pointing `@line` at
`https://npm.pkg.github.com` with a token that has `read:packages` on
`thenewurbankid-web/construct`.

## License

UNLICENSED -- proprietary, Construct Cockpit UI (`ui/client`, `ui/server`)
is not open source (see the repo's open-core policy). The vendored
`src/`/`bin/` (Construct's core CLI/engine) remains under the root repo's
own MIT license independently of this package's license.
