# OG heartbeat (every 2 hours, once the owner has said go)

Short, deterministic, findings only. Prefer a script over reading files: `packages/tools/dev/status.sh`, `packages/tools/dev/verify.sh`, `node packages/tools/project-board/sync.mjs --check`.

1. State: `packages/tools/dev/status.sh`; `git fetch origin && git log --oneline origin/work/2026-09-23 -10`; `gh issue list --repo thenewurbankid-web/construct --state open --milestone v0.10.0 --limit 100`.
2. Mirror: `node packages/tools/paperclip/github-sync.mjs` (dry-run). Report what it would create or close; run it with `--apply` only when the owner has approved the mirror.
3. Reports: for each lane comment marked done by a dev agent, verify with your own commands (`git ls-remote origin work/2026-09-23`, re-run the affected test files) and ask the lane QA agent to confirm. Close the GitHub issue only when verified, one `gh` write per command.
4. Integration: `git pull --rebase origin work/2026-09-23` before every push; a real conflict means stop and report to the owner, never resolve it by force. Full `packages/tools/dev/heavy.sh npm test` once per wave on the combined tree.
5. Board: `node packages/tools/project-board/sync.mjs --check`; if it fails, hand the list to the PM agent.
6. Budgets: `node packages/tools/paperclip/apply.mjs --status`; any agent past its warn percent goes to the owner in one line.
7. Owner: one message per wave (SHAs, counts, decisions needed). Nothing to report means no message. Never resume, wake or assign the Design lane (ON HOLD).
