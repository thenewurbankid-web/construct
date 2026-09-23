**Problem.** An AI agent edits your files directly, and you only find out what it touched afterwards, in a change you did not ask for. Rolling it back means untangling it from your own work.

## Do this

Open **Features** in the left rail (the `/plan` route lands there too), open the **Notes** tab in the Browser pane and describe the change in your own words, or name a feature, file or route. The middle shows what the change will touch; the **Plan** tab in the Tools pane lists the steps, each marked *Deterministic*, *Local model* or *You*. Press **Run plan**.

This page shows the Cockpit only. The same tools are available from the [command line](@user-guide/examples/cli-impact-and-review/) and as a [Core API](@user-guide/examples/core-plans-and-impact/).

### 1. Describe the change, see what it touches

You can press **Suggest units from the note text**. That is a plain text match, no model, and every suggestion is shown as a guess (`inferred`, with a confidence) for you to confirm or untick. The rules your project enforces are listed beside the text, so the limits are visible while you plan.

**Analyse impact** then shows what the change reaches: features, files, and warnings such as "the seeds live in 2 features but the impact reaches 1 more". Each row is marked `derived` (worked out from your code) or `inferred` (reached only through a guess).

![What a change touches: 3 features and 21 files, with cross-feature and public-API warnings and derived or inferred marks on every row](@img/cockpit-plan-impact.webp)

### 2. Build the plan and run it

Add steps from the catalogue, or add the read-only steps the analysis suggests. Every step names a real Construct command and who does it. A plan that names a command Construct does not have is refused, with the list of real ones.

**Run plan** starts one bot. It works in its own copy of the repository, on its own branch, and every step that succeeds becomes a commit there. The **Processes** drawer narrates the run and lets you pause or cancel. A failed step stops the plan and its half-written files are reset. Cancelling or failing leaves your own files as they were.

![A plan of two steps and the Processes drawer showing the run in progress, with a line per step and Pause and Cancel buttons](@img/cockpit-plan-run.webp)

## You get

When the run finishes, **Files this process changed** lists every file the bot wrote, with the exact difference. There is no "approve all": you approve or reject each file by name.

![Processes drawer after a finished run: each changed file with its diff and its own Approve and Reject buttons](@img/cockpit-approval.webp)

The gate refuses, with a reason, anything it should not apply:

- a file outside what the plan said it would touch;
- a protected path, a symlink, or a region marked frozen;
- a file you have changed yourself since (your work is never overwritten);
- a difference that is not the one you were shown (approval quotes the fingerprint of what was on screen).

After applying, the project is checked again and any new violation is reported. Your decision, who made it and when, is recorded.

## Why it matters

You review a small, exact change instead of untangling a surprise, and nothing reaches your project until you say so.

| You get | Where to see it |
|---|---|
| A plan you can read before anything runs | step 2: each step names its command and who does it |
| What a change touches, worked out from your code, with guesses labelled | `derived` and `inferred` in step 1 |
| Your own files untouched until you approve | the bot's own copy and branch |
| A decision per file, on the exact difference | "You get" above |

Checked against commit `d23283f` on 2026-09-23. Screenshots come from the project's own Playwright runs of these screens.
