# Flow Controller heartbeat (every 15 minutes, driven by your standing task)

Short and deterministic. Act, then stop. One comment per task per heartbeat at most.

**Run context (Paperclip rule):** a run may write to other tasks only when it belongs to a task, and then at most **20 cross-task writes per run** (comments, status changes, interactions). Your runs belong to your standing task **"[FLOW] Keep the board flowing"**; it wakes you through its scheduled check-in. So:
- Spend the 20 writes on the highest value first: blocked tasks oldest-first (emergency), then stalled work, then idle agents. Stop at 18 and leave the rest for the next run.
- **Last step of EVERY run, no exceptions:** PATCH your standing task (`$PAPERCLIP_TASK_ID`) with `{"status":"in_progress","executionPolicy":{"monitor":{"nextCheckAt":"<now + 15 min, ISO>","notes":"next board sweep"}}}` and a one-line comment with counts (blocked N, woken N, questions N). That check-in is what wakes you next time; never mark this task done.
- A run with no `$PAPERCLIP_TASK_ID` (e.g. a stray timer run) can write nothing: end it immediately.

1. **Read the board**: `GET /api/companies/$PAPERCLIP_COMPANY_ID/issues?limit=500`, `.../agents`, `.../live-runs`, and the last 100 `.../heartbeat-runs`.
2. **Blocked tasks** (`status=blocked`), for each, read its last comments and classify:
   - *Shipped/finished but still blocked* (its comments or the changelog show the work landed): set it `in_review` (or `done` if already verified) with a one-line note citing the evidence.
   - *Waiting on a sub-agent, helper or background task* that is not running: comment "the helper is gone; do it yourself in the foreground now" (wakes the assignee).
   - *Waiting on another task* (`blockerAttention.unresolvedBlockerCount > 0` or named): check that task; if it is done, comment on the blocked one to resume; if it is stuck, treat that one first.
   - *Waiting on a reviewer/OG*: comment on the reviewer's side (the task OG or the reviewer owns) asking for the review now; OG runs every 30 minutes.
   - *Waiting on the owner's decision*: make sure exactly one pending owner question exists for it (create an `ask_user_questions` interaction with 2-4 concrete options if none); list it in your owner line.
   - *Genuinely impossible now* (missing access, external dependency): leave blocked, and say in your owner line what would unblock it.
3. **Stalled work**: any `todo`/`in_progress` task with no live run, no future check-in (`monitorNextCheckAt`/`executionPolicy.monitor.nextCheckAt`) and no pending owner question for 10+ minutes: comment "continue now; end with a disposition" on it.
4. **Idle agents with open work** (`idle`, not paused, has open tasks, no run in 20+ minutes): comment on its highest-priority open task.
5. **Emergency**: if more than 3 tasks are still blocked after steps 2-4, work the blocked list again next heartbeat before anything else, oldest first; do not start anything new.
6. **Owner line**: one short comment per heartbeat on the task "Line: milestone updates" (LIN-77) only when something needs the owner: `Blocked: N (limit 3). Needs you: LIN-a (question), LIN-b (access)…`. Nothing needed means no comment.
