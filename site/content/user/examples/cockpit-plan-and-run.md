**Problem.** An AI agent edits your files directly, and you only find out what it touched afterwards, in a change you did not ask for. Rolling it back means untangling it from your own work.

## Do this

Open **Features** in the left rail (the `/plan` route lands there too), open the **Notes** tab in the Browser pane and describe the change in your own words, or name a feature, file or route. The middle shows what the change will touch; the **Plan** tab in the Tools pane lists the steps, each marked *Deterministic*, *Local model* or *You*. Press **Run plan**.

This page shows the Cockpit only. The same tools are available from the [command line](@user-guide/examples/cli-impact-and-review/) and as a [Core API](@user-guide/examples/core-plans-and-impact/).

### 1. Describe the change, see what it touches

Give the note a title and describe the change, then say which units it is about: press a feature name under **Which units does it touch?**, or press **Find related parts**. That is a plain text match against your project, no model, and every suggestion is shown as a guess (**Guess**, with a confidence) that only counts once you tick it. The rules your project enforces are listed beside the text, so the limits are visible while you plan.

The note saves itself as you type (**Saved on this machine**), and the address carries `?note=<id>`, so a reload lands on the same note with its plan. If you change the text after a plan was built, the plan is not rewritten: it is marked **Plan out of date** until you press **Keep this plan**. A failed save keeps your text on screen and offers **Retry**.

**Check impact** (available once at least one unit is picked or confirmed) then shows what the change reaches: features, files, and warnings such as "the seeds live in 2 features but the impact reaches 1 more". Each row is marked **Computed** (worked out from your code) or **Guess** (reached only through a unit you confirmed from a guess).

![What a change touches: 3 features and 21 files, with cross-feature and public-API warnings and Computed or Guess marks on every row](@img/cockpit-plan-impact.webp)

### 2. Build the plan and run it

Add steps from the catalogue (**Add a step from the catalogue...**, then **Add**), or press **Add N read-only steps from the impact** to take the read-only steps the analysis suggests. The **Blocks** tab beside **Notes** lists every mechanical block Construct can run: **Run this block** adds that block's example as one step of this plan and starts nothing. Every step names a real Construct command and who does it, and its card shows the exact command line and what it touches. A plan that names a command Construct does not have is refused, with the list of real ones, and **Run plan** stays off until the whole plan is valid.

**Run plan** starts one bot. It works in its own copy of the repository, on its own branch, and every step that succeeds becomes a commit there. The **Processes** drawer narrates the run and lets you pause or cancel. A failed step stops the plan and its half-written files are reset. Cancelling or failing leaves your own files as they were. Running also marks the note as ran and keeps it as history: change it afterwards and the change lands in a copy.

![A plan of two steps and the Processes drawer showing the run in progress, with a line per step and Pause and Cancel buttons](@img/cockpit-plan-run.webp)

## You get

When the run finishes, **Files this process changed** lists every file the bot wrote, with a hash and **Show diff** for the exact difference. **Review changes** opens the gate: each file with its diff and its own **Approve** and **Reject**. There is no "approve all": you approve or reject each file by name.

![Processes drawer after a finished run: each changed file with its diff and its own Approve and Reject buttons](@img/cockpit-approval.webp)

The gate refuses, with a reason, anything it should not apply:

- a file outside what the plan said it would touch;
- a protected path, a symlink, or a region marked frozen;
- a file you have changed yourself since (your work is never overwritten);
- a difference that is not the one you were shown (approval quotes the fingerprint of what was on screen).

A plan built in the Cockpit can be approved this way too: as soon as a step's arguments are complete its card says `writes <file>`, and that declared file is what lets the review offer **Approve**. A step that is not complete declares nothing, and nothing is guessed.

After applying, the project is checked again and any new violation is reported. Your decision, who made it and when, is recorded.

## Why it matters

You review a small, exact change instead of untangling a surprise, and nothing reaches your project until you say so.

| You get | Where to see it |
|---|---|
| A plan you can read before anything runs | step 2: each step names its command and who does it |
| What a change touches, worked out from your code, with guesses labelled | **Computed** and **Guess** in step 1 |
| A note and plan that survive a reload | **Saved on this machine** and `?note=` in step 1 |
| Your own files untouched until you approve | the bot's own copy and branch |
| A decision per file, on the exact difference | "You get" above |

Checked against commit `b6f4032` on 2026-09-26. Screenshots come from the project's own Playwright runs of these screens.
