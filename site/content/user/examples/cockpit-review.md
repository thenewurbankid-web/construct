**Problem.** A pull request is a pile of changed lines. Reviewing it means rebuilding, in your head, which feature each line belongs to, what depends on it, and whether it broke a rule your project already had.

The **Git** screen reads two git refs and shows what the change means: the changed units grouped by feature and layer, what each one now does, and five indicators computed from your own `architecture.yml`. No model, no network, no GitHub login: local branches are first-class.

This page shows the Cockpit only. The same report from a terminal is in the [CLI examples](@user-guide/examples/cli-impact-and-review/); the engine behind it is in the [Core examples](@user-guide/examples/core-review-tests-commits/).

## Do this

### 1. Pick a branch

**Git** in the left rail (the `/review` route) lists the current project's local branches compared against a base (`main` by default; change it under **Compared against** in the Browser pane), riskiest first: branches with more indicators needing attention, then more findings. **Newest** re-orders by date and **Re-analyse all** runs the analysis again. The **What the badges mean** tab on the right explains every badge (scope, rule regressions, unexplained changes, public API, flow changed, and the two calm ones, **No plan** and **Nothing found**).

### 2. Read what the change does

Open a branch. The **Changed units** tab in the Browser pane groups the changed files **By feature**, **By layer** or as plain **Files**; the stage says in one line what each changed unit now does, read from the code and not from the description; the **Health** tab in the Tools pane shows the indicators. The analysis runs as a process: it is listed in the Processes drawer, where it can be paused or cancelled (**Cancel this analysis**), and the branch list stays usable while it runs.

![Review of a branch: five files changed across two features, what each unit does, and the health indicators for scope, unexplained changes and rule regressions](@img/cockpit-review-change.webp)

The five indicators:

| Indicator (card title, list badge) | What it tells you |
|---|---|
| Declared vs actual scope (Scope) | what the plan declared versus what the change touched (grey "Not measured" when there is no plan, which is normal) |
| Unexplained changes | changed files with no import path to the rest of the change |
| Rule regressions | violations that are new on this branch; existing ones are counted as a number, never blamed on it |
| Public surface (Public API) | exports that stopped or started being public, and who imports them |
| What the flow now does (Flow changed) | which routes through a workflow appeared or disappeared, in plain English |

### 3. Findings: fix by machine, or decide

The **Findings** tab beside **Health** splits every finding into two groups that are never mixed: ones a Construct command can fix mechanically, shown with the exact command, and ones that need a human decision. Review is read-only: it shows the command and never runs it.

![Findings tab: two of three findings can be fixed mechanically, each with its command, and one needs a decision](@img/cockpit-review-findings.webp)

Pick a plan from **Compare with a plan** (the plans of processes you ran in this project) and the scope check compares what that plan declared with what changed. If something goes wrong the screen says what happened and what to do next; a repository with no other branch says so; a change larger than 200 files shows a summary and which checks still ran.

## You get

| You get | Evidence above |
|---|---|
| Review that knows your rules | rule regressions, new versus pre-existing |
| Meaning, not lines | "what this change actually does" |
| Mechanical and human findings kept apart | the Findings tab |
| No writes | read-only; the command is shown, not run |

## Why it matters

You review what a change means and decide on a short list, instead of rebuilding the picture from changed lines.

Checked against commit `6d5ef23` on 2026-09-24. Screenshots come from the project's own Playwright runs of these screens.
