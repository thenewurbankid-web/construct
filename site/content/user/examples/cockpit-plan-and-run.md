**Problem.** You hand a ticket to an AI agent and it edits your working tree directly. You find out what it touched after the fact, in a diff you did not ask for, and rolling back means untangling it from your own changes.

**What the Cockpit does about it.** The Plan screen turns a ticket into a plan you can read before anything runs. The blast radius is computed from your code and your rules, not guessed. Running the plan hands each step to a bot that works in its own git branch and worktree. Nothing reaches your project until you approve it, one file at a time, looking at the exact diff.

This page shows the Cockpit only; the same building blocks are available from the [CLI](@user-guide/examples/cli-impact-and-review/) and as [Core APIs](@user-guide/examples/core-plans-and-impact/). The top bar has four modes: **Explore**, **Plan**, **Build** and **Review**. Plan is where this starts.

## 1. Write the ticket, see the impact

Describe the change in your own words, or name a feature, file or route. Pick the units it is about, or press **Suggest units from the ticket text**: that is a plain text match, no model, and every suggestion is shown as a guess (`inferred`, with a confidence) for you to confirm or untick. The rules your project enforces are listed as chips beside the ticket so the constraints are visible while you plan.

**Analyse impact** then shows what the change reaches: features, layers, files, and warnings such as "the seeds live in 2 features but the impact reaches 1 more". Each row is marked `derived` (reached by pure graph computation from a unit you chose) or `inferred` (reached only through a guess).

![Plan screen showing the impact of a ticket: 3 features and 21 files, with cross-feature and public-API warnings and derived or inferred provenance on every row](@img/cockpit-plan-impact.webp)

## 2. Build the plan, run it

Add steps from the catalogue, or add the read-only steps the impact suggests. Every step names a real Construct command and says who executes it: **Deterministic**, **Local model** or **You**. A model appears only where a step says so. A plan that names a command Construct does not have is refused with the list of real ones.

**Run plan** starts one bot. The bot runs in its own git worktree, on its own branch, and every step that succeeds becomes a commit there. The **Processes** drawer narrates the run and lets you pause or cancel. A failed step stops the plan, and the failed step's half-written files are reset. Cancelling or failing leaves your working tree exactly as it was.

![Plan screen with two steps and the Processes drawer showing the run in progress, with a line per step and Pause and Cancel buttons](@img/cockpit-plan-run.webp)

## 3. Approve each file yourself

When the process finishes, **Files this process changed** lists every file the bot wrote, with the exact diff. There is no "approve all". You approve or reject each file by name.

![Processes drawer after a finished run: each changed file with its diff and its own Approve and Reject buttons](@img/cockpit-approval.webp)

The gate refuses, with a reason, anything it should not apply:

- a file outside what the plan declared it would touch;
- a protected path, a symlink, or a region marked frozen;
- a file you have changed yourself since (your work is never overwritten);
- a diff that differs from the one you were shown. Approval quotes the fingerprint of the diff on screen, so what lands is exactly what you saw.

After applying, the project is validated again and any new violation is reported. Your verdict, who gave it and when, is recorded.

## What you can rely on

| You get | Evidence above |
|---|---|
| A plan you can read before anything runs | step 2, each step names its command and executor |
| Impact worked out from your code, with guesses labelled | `derived` vs `inferred` in step 1 |
| Your working tree untouched until you say so | the bot's own branch and worktree |
| A decision per file, on the exact diff | step 3 |

Checked against commit `081150b` on 2026-09-20. Screenshots come from the project's own Playwright runs of these screens.
