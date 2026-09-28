# Deploying Trace locally

Goal: the latest build is always running at http://localhost:4200, and the running app says which build it is and when it was deployed.

## Commands

| Command | What it does |
| --- | --- |
| `npm run deploy:local` | Test, copy, health-check, switch, restart, verify. Rolls back by itself if the new build is unhealthy. |
| `npm run deploy:status` | Version, release, hash, deployed time (exact and relative), tests at deploy, port, pid, health, kept builds, last failure. Exit code 0 only when the server answers. |
| `npm run deploy:stop` | Stops the server. The build stays; `deploy:local` starts it again. |
| `npm run deploy:watch` | Foreground watcher: deploys now if the running build is not the latest, then again 20 s after the last edit, when the hash changed and `npm test` passes. |
| `npm run deploy:rollback` | Switch to the build that ran before the current one (recorded in the build's `previousVersion`). |

Port: `--port <n>` (pass it after `--`: `npm run deploy:local -- --port 4300`) or the environment variable `TRACE_DEPLOY_PORT`. Default 4200. Port 4177 is the dev server's and is refused. If another program holds the port the deploy stops before changing anything and says what holds it. The server is started with `--strict-port`, so it never slides to the next free port.

## What a deploy does

1. Hash the deployable tree and compare with the running build. Same hash and healthy: print "already deployed" and stop. Same hash but not running: start it.
2. Run `npm test`. On a failure: keep the old build running, write `deploy/LAST-FAILURE.txt`, exit 1.
3. Copy the tree to `deploy/<version>/` (re-hashed after the copy; if a file changed meanwhile the deploy stops), copy the production `node_modules` (everything `package-lock.json` does not mark `"dev": true`: `three` and `esbuild` are dev dependencies, only `npm run build:hero` needs them, the built hero is in `src/`), write `build-info.json` and `manifest.json`.
4. Start the new build on a temporary port and check `/api/health` and `/api/build` (the hash must match). If that fails the copy is deleted and nothing else changes.
5. Move the `deploy/current` symlink atomically, stop the old server, start the new one on the fixed port, check again. If that fails: switch back, restart the previous build, write `LAST-FAILURE.txt`, exit 1.
6. Keep the newest 3 builds (never the running one or the one it rolls back to).

## What counts as "the build"

An allow-list, so scratch files never trigger a redeploy: `src/`, `examples/`, `docs/*.md`, `package.json`, `package-lock.json`, `ai.config.json`, `README.md`, `CHANGELOG.md`, `RELEASE`. Not part of it: `node_modules`, `.git`, `deploy/`, `demo-app/`, screenshots (`*.png`), logs, and the state a run writes into each example (`answers.json`, `answers.history.jsonl`, `decisions.json`, `ai-cache.json`): a redeploy carries that state over from the running build.

**The API contract is source, not state.** An example's `openapi.json` / `openapi.yaml` / `openapi.yml` ships in the build (editing one in the source tree makes a new build). A redeploy keeps the running app's copy only when it was changed or uploaded there: each build folder has a `manifest.json` with the hash of every file it shipped, and a running `openapi.*` whose name or bytes differ from that manifest is the user's and is carried into the new build (as the example's only openapi file); one that still matches is replaced by the new build's copy.

The version is `<package.json version>+<first 7 chars of the hash>`. The hash is a sha1 over the sorted list of (relative path, sha1 of the file's bytes), so it does not depend on modification times, on where the checkout lives, or on git (this project is not tracked). `builtAt` (the deploy time) is metadata only: it is not in the hash and nothing generated depends on it.

## Releases and minor releases

`RELEASE` holds the release id (`R0`), or a minor release id (`R0.1`) for a small deliverable between two main releases. `CHANGELOG.md` has one `## R0 — <date>` section per release and, under it, optional `### R0.1 — <date>` sub-sections (newest first) with their own bullets; the next main release is `R1`. `build-info.json` records `release`, `major` and `minor`; the deploy history lists `release` as written. Order: R0 < R0.1 < R0.2 < R1 (`compareReleaseIds` in `src/changelog.mjs`).

## Where things are (all under `deploy/`, git-ignored)

- `<version>/`: one directory per kept build: the tree, `node_modules`, `build-info.json` (version, release, hash, files, builtAt, tests at deploy, previousVersion, changesSincePrevious), `manifest.json` (path to content hash).
- `current`: symlink to the running build's directory.
- `state.json`: which build is current, the port, and `pinnedHash` (set by `deploy:rollback`).
- `server.pid`, `server.log`: the detached server. `LAST-FAILURE.txt`: why the last deploy was refused or reverted (removed after the next good deploy).
- `state/demo-app-src/`: code the running app generates. It lives outside the builds so a redeploy does not lose it.

The running app writes saved answers, AI decisions and AI caches into its own copy of `examples/`. A deploy seeds them from the source examples and then lets the previous build's copies win, so work done in the running app survives a redeploy. Decision to check: if you edit an `answers.json` in the source and want the running app to take it, delete that file in `deploy/current/examples/<name>/` first, or use Reset in the app.

## Rollback and the watcher

`deploy:rollback` goes back one build and sets `pinnedHash` to the source tree's hash. **Uploaded contracts are carried over:** before switching, the running build's user-changed `openapi.*` files (the same rule as a redeploy, checked against that build's `manifest.json`) are copied into the older build, replacing that example's shipped file, and the message names the examples. The older build's `manifest.json` is left as it was, so its copy of that file reads as the user's and is kept again by the next redeploy. If the copy fails, nothing is switched and the running build keeps running (`carry-failed`). The copy is atomic per file (copied to a temp name beside its target, checked byte for byte, then renamed over it; the example's other `openapi.*` are removed only after that), so a failure at any step never leaves the older build without a contract.

**An upload during the switch is not lost.** A redeploy or rollback copies the uploaded contracts, then stops the running server; an upload landing in between would be written into the build about to be discarded. Two layers close it: (1) a lock, `deploy/contracts.lock` (the holder's pid and time), is held from before the copy to after the restart, and while it exists the running server answers `POST /api/openapi` and `POST /api/demo/apply-fix` with `503` and `Retry-After: 15` (the page shows "try again in a few seconds"); a lock whose process is gone or that is older than 10 minutes is ignored, so a crashed deploy cannot block uploads. (2) After the old server is stopped the contracts are copied a second time, which picks up a write that was already in flight when the lock appeared; if that second copy fails the previous build is started again (`carry-failed`) and nothing is lost. Reads and every other route keep working during the lock. The check runs after the central guard (`src/http-guard.mjs`), never instead of it, and adds no route. Answers and other run state are not carried by a rollback (they are seeded at deploy time from the previous build). `deploy:watch` skips that tree until a file changes, so it does not undo your rollback. An explicit `deploy:local` always deploys the latest tree. The watcher also never loops: a tree whose deploy failed is not retried until its content changes, and files under `deploy/` and `node_modules/` are ignored.

## Keeping it running across logins (macOS, you install it)

Nothing here installs anything. `scripts/com.trace.deploy.plist.example` is a LaunchAgent that runs `deploy:watch` at login and restarts it if it exits.

1. Run `npm run deploy:local` once (it creates `deploy/`, which the agent writes its log into).
2. Copy the example to `~/Library/LaunchAgents/com.trace.deploy.plist`.
3. Replace every `REPLACE_ME`: the absolute path of `node` (`command -v node`), of `scripts/deploy-local.mjs`, of the repository, and the directory of `node` in `PATH` (the deploy runs `npm test`).
4. `launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.trace.deploy.plist`
5. Check with `npm run deploy:status`; the agent's output is in `deploy/watch.log`.

Remove it with `launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.trace.deploy.plist`. Stop the watcher before `deploy:stop`, or `KeepAlive` will restart the watcher (the watcher does not restart a server you stopped until the source changes, but it starts one on its next launch).

## The page and the API

- Badge in the studio's top bar: `src/ui/build-badge.mjs`. About page: `/about` (`src/ui/about.html`, `src/ui/about.mjs`).
- `GET /api/health` (used by the deploy), `GET /api/build` (running build), `GET /api/about` (build, uptime, Node, port, tests at deploy, parsed changelog, changes since the previous build, deploy history).
- `CHANGELOG.md` format and the release convention: see the comment at the top of that file.
- Tests: `src/build-info.test.mjs`, `src/changelog.test.mjs`, `src/build-routes.test.mjs`, `src/deploy/deploy.test.mjs` (planner and watcher with faked effects), `src/ui/build-badge.test.mjs`, `src/ui/about.test.mjs`.
