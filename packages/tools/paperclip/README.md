# Paperclip setup as code

Our multi-agent setup (the company "Line", its agents, budgets and goals) as reviewable files, applied to a local
[Paperclip](https://github.com/paperclipai/paperclip) (MIT, docs at https://docs.paperclip.ing). It replaces the ad hoc
session crons: work is event-driven (an issue assigned to an agent) instead of clock-driven, and OG is the only agent
with a timer.

| File | What |
| --- | --- |
| `company.json` | The company, goals, the org (14 agents), adapter config, the ONE budget table (`budgets`), heartbeats, the GitHub-to-lane mapping. Comments live in `$comment` keys. |
| `agents/<key>/AGENTS.md` | Each agent's instructions bundle (lane, paths, how to pick the next issue, definition of done incl. AI-READY, how to report). `agents/og/HEARTBEAT.md` is OG's cycle. `agents/_shared/RULES.md` is included into every AGENTS.md at apply time so each uploaded bundle restates the repo rules. |
| `apply.mjs` | Makes Paperclip match `company.json`. Dry run by default. |
| `github-sync.mjs` | Mirrors open GitHub issues of milestone v0.10.0 into Paperclip issues. Dry run by default, reads GitHub only. |
| `lib.mjs`, `mock-paperclip.mjs`, `paperclip.test.mjs` | Shared helpers, a mock API on ports 49600-49649, tests (`node --test packages/tools/paperclip`). |

Node built-ins only (`fetch`); runs on Node 22 (the repo default) and 24 (what Paperclip itself needs, `/home/developer/.local/node-24/bin`).

## Safety model

- Every agent is created **paused**, with the timer heartbeat **off**, `canCreateAgents` false, and `budgetMonthlyCents > 0`
  (budget policy: warn at 80 percent, hard stop pauses the agent). `apply.mjs` refuses a `company.json` that would
  start something on its own, use Fable, or leave a budget at 0.
- `apply.mjs` never resumes, wakes or invokes an agent and never enables a heartbeat. An agent you resumed is reported as
  `LIVE` and left alone; `--pause-all` pauses every configured agent again and switches its timer off.
- `claude_local` agents run with `engine: cli` (required by Paperclip for confinement), `filesystemScope: workspace`
  and `networkScope: allowlist` (api.anthropic.com, github.com, api.github.com, registry.npmjs.org,
  objects.githubusercontent.com), bubblewrap (`/usr/bin/bwrap`, present on this host), a `git_worktree` workspace per
  run from `origin/work/2026-09-23` (`origin/studio` for the ad hoc agent), model `claude-sonnet-5`, effort medium, bounded
  `maxTurnsPerRun` and `timeoutSec`. `dangerouslySkipPermissions: true` is explicit: it is the platform default for
  non-interactive runs, so confinement, budgets, paused-by-default and each AGENTS.md are the guardrails.
- Budgets are soft caps in cents per agent per month (spend is unknown for a subscription login). Edit the `budgets`
  table in `company.json`, then re-run `apply.mjs --apply`.
- Both scripts refuse a non-loopback `--api` unless `--allow-remote`, print no secret (anything token-shaped or
  taken from a secret-named environment variable is masked), and never delete anything.
- **Pilot TODO (not yet exercised by a real run):** confirm the sandbox sees git, node, `gh` and the shared `node_modules`
  through `filesystemExtraPaths`; that `/tmp/construct-heavy.lock` (heavy.sh) works inside it; and whether an agent needs
  `127.0.0.1:3100` in `networkAllowlist` to comment on its Paperclip issue (left out on purpose: the brief lists five hosts).

## Run it

```bash
node packages/tools/paperclip/apply.mjs                 # dry run: prints what it would create or change, writes nothing
node packages/tools/paperclip/apply.mjs --apply         # creates the company, goals, PAUSED agents, bundles, budget policies
node packages/tools/paperclip/apply.mjs --status        # every agent: status, timer, budget, spent, last run
node packages/tools/paperclip/github-sync.mjs           # dry run of the issue mirror
node packages/tools/paperclip/github-sync.mjs --apply   # create/close mirror issues (Paperclip only; needs the company)
```

Options: `--api http://127.0.0.1:3100`, `--config <file>`, `--repo-root <dir>` (default in `company.json` `paths.repoRoot`),
`--pause-all`. Re-running `--apply` is a no-op when nothing drifted; drift (title, adapter config, budget, instructions,
goals) is patched, never duplicated. Mirror issues are created in `backlog`: moving one to `todo` is the go for that work.

## Resume ONE agent as a pilot

Nothing runs until you say so. Pick one agent (say `construct-dev`), look up its id with `--status` or
`curl -s http://127.0.0.1:3100/api/companies/<companyId>/agents`, assign it one mirrored issue (move the issue from `backlog`
to `todo` in the UI, or `curl -X PATCH http://127.0.0.1:3100/api/issues/<issueId> -H 'content-type: application/json' -d '{"status":"todo"}'`), then resume it:

```bash
curl -s -X POST http://127.0.0.1:3100/api/agents/<agentId>/resume
```

Watch the first run in the UI (http://127.0.0.1:3100), check the worktree, the sandbox and the budget. To give OG its
2-hour timer once you are happy: `curl -s -X PATCH http://127.0.0.1:3100/api/agents/<ogId> -H 'content-type: application/json' -d '{"runtimeConfig":{"heartbeat":{"enabled":true,"intervalSec":7200}}}'`
(this is `heartbeatAtGo` in `company.json`; `apply.mjs` leaves an enabled timer alone).

## Everyone active, safely (owner rule, 2026-09-25)

The owner wants every agent in every team active, and free agents taking future work or helping another team, always
(`agents/_shared/RULES.md`, "Never idle"). This host has 15 GB RAM and no swap and each Claude run is about 500 MB, so
"active" means every agent is resumed and available, while `claude-gate.sh` (the adapter `command`) lets at most
`PAPERCLIP_MAX_CLAUDE` (default 3) Claude runs start machine-wide and none below 3 GB of free memory; the rest wait for a slot.
Raise the number only after watching `free -m` during a busy hour.

Activation order (each step checked before the next, and the go is the owner's): `apply.mjs --apply` (pushes the gate and the rules to the
paused agents), `github-sync.mjs --apply` (mirrors the open issues into `backlog`), move one issue per lane to `todo`,
resume ONE agent as the canary and watch its first run (worktree, sandbox, `gh`, `heavy.sh`, its push), then resume the rest in
stages of two, OG last with its heartbeat. Pause everything with the command below at any time.

## Pause everything

```bash
node packages/tools/paperclip/apply.mjs --apply --pause-all     # pauses every configured agent, timers off
# or one agent:  curl -s -X POST http://127.0.0.1:3100/api/agents/<agentId>/pause
```

Stopping Paperclip itself stops every run (see below). Hard stops: an exhausted budget pauses the agent by itself.

## The master key

Paperclip encrypts its stored secrets with a local master key under `~/.paperclip` (the instance's data directory,
`~/.paperclip/instances/default`). This tooling never reads it. **Back it up** (with the instance's `db` backups in the same
tree) somewhere off this machine before you rely on the setup: losing it loses every stored secret, and
`GET /api/health` currently warns that no database backup exists yet.

## Stop and restart Paperclip

It runs on the owner's Node 24, loopback only, `local_trusted` mode (no auth), embedded Postgres, data in `~/.paperclip`.
Stop it with Ctrl-C in the terminal that runs it (or `kill <pid>` of its node process; never `kill -9` while a run is
active) and start it the way it was installed (`npx paperclipai run`, from a shell whose PATH starts with
`/home/developer/.local/node-24/bin`). Port 3100 is Paperclip's; 3000 and 4000 belong to the hosted Cockpit, do not touch them.
After a restart run `apply.mjs --status`: every agent should still be paused.

## How it replaces the session cron jobs

| Before (session crons) | Now |
| --- | --- |
| A timer wakes a session that looks for work | Work is event-driven: an issue assigned to a lane agent (from `github-sync.mjs`, in `todo`) is the only trigger |
| One orchestrator session polls everything | OG, the only agent with a timer (every 2 hours, once you say go), runs `agents/og/HEARTBEAT.md`: state, mirror, verify reports, integrate, board, budgets |
| Token spend visible only after the fact | Per-agent monthly budgets with warn 80 percent and hard stop |
| Trusting the agent to stay in its lane | Worktree per run, bubblewrap filesystem and network confinement, AGENTS.md rules |

GitHub issues (thenewurbankid-web/construct, board project 1) stay the ticket source of truth; the bridge only reads them.
The lane mapping (board Module and Sub-module to lane) is `laneMapping` in `company.json`.
