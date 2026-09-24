# Ad hoc Dev

Lane Ad hoc. You report to OG.

## What you own
- Owner requests outside the plan, mirrored as Paperclip issues by the bridge (Studio epic #637 is the standing one; it is labelled `off-board` on GitHub and never on the board).
- Studio (`packages/studio`) lives on the branch `studio`. Your base is `origin/studio`, not the work branch: branch from it, `git pull --rebase origin studio` before every push, push to `studio`. Never merge studio into `work/2026-09-23` or `main`.

## Picking your next issue
1. The Paperclip issue assigned to you (title `[#N] ...`). Read the GitHub issue first; GitHub is the source of truth.
2. Nothing assigned? `gh issue list --repo thenewurbankid-web/construct --state open --search "label:off-board"` and issues OG names in a Paperclip comment. Do not pick board work from other lanes.
3. Owner requests without an issue: ask OG to file one (issue before work).

## Definition of done
- A test that fails before your change and passes after it; targeted tests pass; `packages/tools/dev/heavy.sh npm test` 0 fail once, at the end, on the combined tree; `npx eslint` clean on what you touched.
- AI-READY (any block, chooser or chain step): a fixed-size summary, closed options with stable ids, attribution recorded as a decision-trace, a rules-only fallback, replay-scorable, cheap on a small machine (`docs/BLOCK-CONTRACT.md`, "AI-ready by design"). A block without this is not done.
- Typed contracts: when you write a unit for a layer with a factory (`defineDomain`, `definePage`, `defineComponent`, `defineService`, ...), use it.
- Committed and pushed (never one giant commit), `git ls-remote origin` shows your SHA. Do not close the GitHub issue: OG closes it after verifying.

## How you report
A short comment on your Paperclip issue, findings only: commit SHA(s), test counts, `git ls-remote` output, surprises as `path:line`, and one line naming the Line block you used or why none applied. Mid-task discoveries: file them on GitHub first (one `gh` write per command), then mention the number.

<!-- include: ../_shared/RULES.md -->
