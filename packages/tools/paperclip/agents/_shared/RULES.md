## Repo rules (non-negotiable; restated from CLAUDE.md, ~/.claude/CLAUDE.md, docs/DELEGATION.md)

You work in your own git worktree of `thenewurbankid-web/construct`. Read `CLAUDE.md`, `docs/DELEGATION.md` and `docs/BLOCK-CONTRACT.md` ("AI-ready by design") before your first change; they win over this file.

Branch and git
- Work only on `{{BASE_REF}}`: your worktree branch starts from it and lands on it (`git push origin HEAD:{{PUSH_BRANCH}}`). Never touch `main` (frozen at tag `stable-2026-09-23`).
- `git pull --rebase origin {{PUSH_BRANCH}}` before every push. Never force-resolve a conflict and never force-push: stop and report the conflict.
- Commit and push every shippable piece, one commit per piece, message `[#N] <summary>`. Uncommitted work is invisible.
- Fresh worktree setup: the `node_modules` symlink commands in `docs/DELEGATION.md`, as separate commands. Never `npm install` unless the issue says so.

Machine and secrets
- Heavy commands (`npm test`, Playwright, `next dev`, `npm ci`) run only through `packages/tools/dev/heavy.sh`. Single test files run directly (`node --test <file>`). Playwright: `--workers=1`, one dev server, no lingering process.
- Never touch the hosted Cockpit's processes or ports 3000 and 4000, and never read or write `~/.construct-hosted.env`. Use an unused port range for your own servers (47300-47999 are taken).
- Never write a token or secret to disk, into a file, a commit, an issue or a comment. If you see one in chat or output, say it is compromised and stop.
- GitHub writes (create, comment, close, PATCH) one per command, never chained. Reads with `gh` are free.

How you work
- Use Construct blocks first (`construct summarize`, `validate`, `create`, `refactor`, plan flows) before reading files or editing by hand; where none applies, keep its philosophy: small deterministic blocks over model reasoning, closed options, reviewable diffs, wrap permissively licensed OSS. A model plans and suggests; blocks execute. System 1 first: a rule or classifier before multi-step LLM reasoning.
- Verify with your own commands (`git ls-remote origin {{PUSH_BRANCH}}`, re-run the affected tests). A report is a claim until you have checked it.
- Report findings only: SHAs, test counts, `path:line`, no narration, no pasted logs, no screenshots. End with one line: which Line block you used, or why none applied.
- Model routing: use the default agent model (Sonnet 5, as configured). Never use Fable. Do not change your own model or adapter settings.
- Do not close a GitHub issue unless your lane definition below says so; state reflects reality (never close unfinished work). Comment only when it adds what state and commits do not show.

Safety
- You run inside a sandbox (workspace-only filesystem, allowlisted network). If a command fails because the sandbox blocks it, report which path or host and stop; do not look for a way around it.
- If your budget warning fires, finish the current piece, commit, push and report.
