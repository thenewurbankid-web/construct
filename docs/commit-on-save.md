# Commit on save: every Cockpit save becomes a commit

Saving in the Cockpit writes a **real git commit**, on a branch the session created, with a message
Construct builds itself — impact counts from `analyzeImpact`, prose from `summarizeUnit`. No model
is involved at any point, so the message costs nothing, never drifts, and works with the network and
the provider both down.

Split, and why: **message assembly is deterministic and lives in core** (`packages/engine/commitMessage.mjs`,
open source); **the trigger and its UI live in `ui/`** (`ui/server/src/autoCommit.mjs`,
`ui/client/features/git-session/`). One-way dependency — core never imports `ui/`.

Code: `packages/engine/commitMessage.mjs`. Tests: `test/commitMessage.test.mjs`,
`ui/server/src/autoCommit.test.mjs` (real git repositories), `ui/e2e/tests/commit-on-save.spec.js`.

## The message

```
CON-a3f7-0007: checkout: update ProductsPage and CheckoutController

2 features, 5 layers, 7 files
  checkout: page, controller, hook
  billing:  domain, service

Changed
  features/checkout/pages/ProductsPage.tsx (page) — Lists the catalogue with its filters.
  ...

Summary
  Feature "checkout": 9 files, 66 LOC, 7/7 layers; 0 workflow machine(s); 0 error(s).

Wider impact: 8 other file(s) import what changed, in 1 other feature(s): reporting.

Warnings
  SHARED-COMPONENT (warning): features/shared/components/CurrencyLabel.tsx is used by 3 other feature(s).

Construct-Session: a3f7
Construct-Serial: 7
Construct-Impact: 2 features, 5 layers, 7 files
Construct-Summary: deterministic (construct summarize + impact); no LLM
```

**The counts describe what the save wrote**, not the blast radius: they come from the impact report's
`direction: "seed"` rows. The rest of the same report becomes the `Wider impact` line and the
warnings, where it is informative rather than misleading. (`analyzeImpact` always adds the seeds' own
dependencies as `direction: "down"` context rows, so counting `report.features` verbatim would claim
a save touched files it never opened.)

## The first line: `<prefix>-<session-id>-<serial>`

| Part | Whose | Notes |
|---|---|---|
| `CON` | yours | any reference (for example a ticket key), your initials, or empty |
| `a3f7` | ours | a short random hash made when the session branch is created — **not** a timestamp, because parallel agents start within the same second |
| `0007` | ours | monotonic **within the branch**, derived from that branch's own commit subjects |

There is no counter file and no allocator, so **nothing exists for two sessions to race on**. The
serial is matched on the session id rather than the prefix, so changing your prefix mid-session does
not restart the numbering.

## The session branch

`<prefix>/<slug>-<session-id><suffix>`, e.g. `cockpit/billing-invoice-layer-a3f7`. Created on the
**first save**, not when the Cockpit opens, so browsing leaves no empty branches behind — and by then
we know what was touched, so the name can describe the work. The slug, first match wins:

1. the plan or note title (`planTouches`, #286);
2. the feature and unit first touched;
3. the feature alone, when one save touched several units;
4. the date, only if nothing above can be determined.

**The name is fixed once created.** Later saves may touch other features; renaming mid-session breaks
anything already pointing at the branch. The name says where the session started; the commits say the
rest. Reopening the Cockpit on an existing session branch continues its serial, because the id is
recovered from the branch name and confirmed against the branch's own commits.

## Granularity: three modes, all yours

| Mode | Behaviour |
|---|---|
| `coalesce` (default) | saves inside one window (30s by default, configurable) become a single commit |
| `every-save` | each save is its own commit — a faithful audit trail, and a lot of commits |
| `manual` | saves stay uncommitted until you press Commit; the same message format applies |

The window runs from the **first** pending save and is not extended by later ones, so a long editing
burst still commits on a bounded schedule instead of never. Auto-commit is **on by default**, and the
off switch is real: with it off the Cockpit never touches git.

## A dirty working tree at session start

You are **asked**, not guessed about — and the question shows what it found, grouped by feature and
layer using the same impact computation:

> 2 file(s) in billing (domain, service), 1 file(s) in checkout (page) — carry onto this session's
> branch, or stash?

- **Carry** commits them alongside the session's first commit, listed under *Carried in from before
  this session* and **never counted** in the impact block, so the counts stay honest.
- **Stash** puts them in `git stash` with a labelled entry, and the Cockpit tells you which one.

The answer can be remembered per project, so answering the same way forever is not a chore.

## Consequences, stated deliberately

- **Serials interleave in `main`** after a session branch merges, and are not globally ascending.
  That is correct: a serial identifies a commit *within its session*, not a global position.
- **Rewriting history renumbers**, and a cherry-picked commit keeps a serial that no longer matches
  its new branch. The serial is a label, not an identity.
- **Nothing is pushed.** Commits are local; pushing stays an explicit action.
- **A commit is never allowed to fail a save.** Not a git repository, no git binary, an impact report
  that cannot be built — each degrades to a reported status, and the file is still written.
- **Only the files the Cockpit wrote are staged** (`git add -- <paths>`, never `git add -A`), so a
  save cannot sweep up unrelated work sitting in the same tree.

## API

```js
import {
  buildCommitMessage, commitImpact, deriveSlug, newSessionId,
  nextSerialFrom, parseSerial, serialLabel, sessionBranchName, slugify,
  COMMIT_MODES, DEFAULT_COMMIT_CONFIG, commitMessageApiManifest,
} from './packages/engine/commitMessage.mjs';

const serial = nextSerialFrom(subjectsOnThisBranch, { sessionId });
const built = buildCommitMessage(root, {
  changedFiles: ['features/billing/domain/billingRules.ts'],
  preexisting: [],            // carried in from a dirty tree; listed, never counted
  changes: { 'features/billing/domain/billingRules.ts': 'update' },
  sessionId, serial, prefix: 'CON',
  plan, planTitle,            // optional (#286)
});
built.message; // subject + body, ready for `git commit -F -`
```

Every function is pure, returns `{ok:false, error}` rather than throwing, and never writes anything.

## REST (ui/server)

| Route | Purpose |
|---|---|
| `GET /api/git/session` | config, repo/branch, pending saves, the window's remaining time, the dirty-tree question, recent commits |
| `POST /api/git/config` | `{enabled, mode, coalesceMs, messagePrefix, branchPrefix, branchSuffix}` |
| `POST /api/git/dirty-answer` | `{answer: 'carry'\|'stash', remember}` |
| `POST /api/git/commit` | commit what is pending now |
| `POST /api/git/plan` | `{plan, planTitle}` — name the branch after the work |

Every pages-editor save and every committed workflow edit also returns an `autoCommit` block
alongside its usual response.
