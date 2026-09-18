# Project board

The work board is the user-owned GitHub Projects v2 board `thenewurbankid-web` project #1
(`https://github.com/users/thenewurbankid-web/projects/1`). It shows issues only (pull requests do not
belong on it). This page is the reference for how it is organised, who maintains it, and what is
automated.

## Fields

| Field | Values | Meaning |
| --- | --- | --- |
| Status | Backlog, Ready, In progress, In review, Done | Workflow state. Closed issues are Done; a reopened issue goes back to In progress. |
| Priority | P0, P1, P2 | Set on every open issue except Standing ones. |
| Size | XS-XL | Optional. |
| Module | Core CLI, Web UI, AI Toolkit, Pipeline & Generators, Demos & Docs, Infra & Process | Required on every item. |
| Sub-module | see below | Required on every item. Unique option names; `Other` is shared. Use for filtering. |
| Area | `<Module> › <Sub-module>` | Derived from Module + Sub-module. Use for the two-level grouped view. |
| Kind | Epic, Feature, Bug, Demo, Standing, Chore | Required on every item. |

GitHub reserves the field name "Type", so the field is called **Kind**.

Why both Sub-module and Area: a Projects v2 view can be grouped by only one field (no nested grouping), and
a single-select cannot have options that depend on another field. Grouping a view by Area gives the
two-level look, because groups sort with their module prefix together. The sync tool keeps Area consistent with
Module and Sub-module automatically.

### Modules and sub-modules

The list lives in code: `tools/project-board/taxonomy.mjs` (single source of truth for the sync check).

- Core CLI: Config & framework support, AST & parsing, Enforcers, Import, Research & narrator, CLI shell & build, Other
- Web UI: Dashboard, Import Wizard, Pages Editor, Visual composer, Workflows screen, Settings & Local model, Help & Tutorials, Design system, Other
- AI Toolkit: Ollama & models, Provider routing, LLM fill safety, Other
- Pipeline & Generators: Envelope engine, Workflows (XState), Generators, Frozen presentation, Other
- Demos & Docs: Guides, Tutorials, Screenshots, Style guide, Other
- Infra & Process: CI & e2e, Security, Dependencies, Project board, Comment bridge, Other

Epics and structural containers normally get `Other`. To add a sub-module: add it to `taxonomy.mjs`, add the
option to the Sub-module field and the matching `<Module> › <Sub-module>` option to the Area field (Project
settings, or `updateProjectV2Field`), and update this list.

Open-core note: items about the Cockpit UI, an MCP server and predefined envelopes are proprietary; core
packages (enforcers, AST, generators) are open. The project-manager agent watches that boundary as a
Module/Sub-module concern when triaging. There is deliberately no Edition field yet (optional follow-up).

## Views

All seven were created through the GitHub API (REST `POST /users/{user}/projectsV2/{n}/views` accepts
`filter`, `group_by`, `sort_by`, `visible_fields`; GraphQL `createProjectV2View` only takes name/layout/filter).

| View | Layout | Filter | Group | Sort |
| --- | --- | --- | --- | --- |
| Now | Board | `status:"In progress","In review" -kind:Standing` | Module | - |
| Next | Table | `status:Backlog,Ready -kind:Standing` | - | Priority |
| Epics | Table | `kind:Epic` | Parent issue | - (shows Sub-issues progress) |
| Shipped | Table | `status:Done closed:>@today-30d` | - | - |
| Bugs & debt | Table | `kind:Bug,Chore` | - | - |
| By module | Table | `-status:Done` | Module | Area, then Status |
| By area | Table | `-status:Done` | Area | - |

If a view is ever lost, recreate it in the UI: New view, pick the layout, set Filter (type the filter text
above), Group by, Sort by via the view menu, and show the fields Status, Priority, Module, Sub-module, Kind.

## Workflows (manual: no API)

GitHub has no API to create or edit built-in workflows (only `deleteProjectV2Workflow`). In the project,
open `...` menu > Settings > Workflows and set:

1. **Item closed**: enabled, Set Status to Done (already enabled).
2. **Item reopened**: enable, Set Status to In progress.
3. **Auto-add to project**: repository `thenewurbankid-web/construct`, filter `is:issue` (so pull requests
   are never added), Set Status to Backlog.
4. **Auto-archive items**: enable, filter `is:closed updated:<@today-14d` (or "Done" status, older than 14 days).
5. **Pull request merged**: turn off (no pull requests are on the board).

The hygiene job below does the same closed/reopened/archive work deterministically, so the board stays right
even if a workflow toggle is missed.

## Automation (deterministic, no LLM)

`tools/project-board/sync.mjs` (pure logic in `plan.mjs`, tests in `plan.test.mjs`, run by `npm test`):

```
PROJECT_TOKEN=<token> node tools/project-board/sync.mjs --dry-run   # report only
PROJECT_TOKEN=<token> node tools/project-board/sync.mjs             # apply
node --test tools/project-board/*.test.mjs                          # unit tests
```

It: adds any issue missing from the board (issues only, never PRs; Status from state), sets closed issues to
Done, sets reopened ones to In progress, archives Done items closed more than 14 days ago
(`--archive-days N`), corrects Area when it disagrees with Module + Sub-module, and reports (does not guess)
items missing Module/Sub-module/Kind, impossible Module/Sub-module pairs, and open issues without Priority.
It is idempotent. Without a token it prints a notice and exits 0.

`.github/workflows/project-board-hygiene.yml` runs it on `issues` (opened/closed/reopened), daily, and by hand
(`workflow_dispatch`, optional dry run). It uses least-privilege `permissions` (`contents: read`,
`issues: read`), passes secrets via `env`, and never interpolates event text into shell.

### Required setup (one-time, by the repo owner)

The default `GITHUB_TOKEN` cannot access user-owned Projects v2. Create a NEW token (do not reuse any token that was
ever pasted into chat): a fine-grained token with Projects read/write and Issues read, or a classic token
with `project` + `repo`. Add it as the repository secret `PROJECT_TOKEN`
(Settings > Secrets and variables > Actions). Until it exists the workflow logs a notice and exits green.

## Conventions when filing issues (humans and agents)

1. Set **Module**, **Sub-module** and **Kind** on the board card (Area is derived; the sync fixes it). Set
   **Priority** on anything that is open and not Standing.
2. Link the issue to its parent epic with GitHub sub-issues (issue page > Create sub-issue / Add existing) and
   also put `Part of #N` in the body.
3. Title conventions: `[Module N] ...` for module epics, `Epic X.Y -- ...`, `[Demo] ...` / `[Demo Epic] ...`.
4. Standing tickets (process, "Project board hygiene log") are Kind=Standing and are never closed.
5. Never put pull requests on the board.

## Maintenance: the project-manager agent

Board maintenance is delegated to the `project-manager` subagent (`.claude/agents/project-manager.md`). Run it
at the end of each work wave and whenever the board looks off:

```
Use the project-manager agent to run a board hygiene pass and report to the Project board hygiene log.
```

It needs a token with the `project` scope supplied inline for that session (never written to disk). It fixes
classification and parent links, runs the sync, audits issue discipline (CLAUDE.md rules 1-5, 12), and posts
its report as a comment on the "Project board hygiene log" issue. It never edits issue content, never deletes
issues, and escalates rather than improvises on anything destructive.

## Automated vs manual

| Thing | How |
| --- | --- |
| Closed -> Done, reopened -> In progress, add missing issues, archive Done > 14 d, Area consistency | Automated (`sync.mjs` via workflow, needs `PROJECT_TOKEN`) |
| Module, Sub-module, Kind, Priority, parent links, audits | project-manager agent / the person filing |
| Views | Created via API (see above); recreate manually if lost |
| Built-in workflows (auto-add filter, reopened, auto-archive) | Manual (no API) |
| `PROJECT_TOKEN` secret | Manual, repo owner |
