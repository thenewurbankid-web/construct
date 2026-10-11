# Line test plan (pre-UAT)

Every kind of test Line should have, where it lives and why. "Where" names the package or app; tests sit next to the code they cover unless noted.

| # | Test kind | Where | Why |
|---|---|---|---|
| 1 | Contract tests (zod schemas, typed in/out) | every package's contract file: @mx/plan, @mx/reason, GateLM, Morpheus, Trace, Construct core/engine | Modules can be swapped or mocked safely; no single point of failure |
| 2 | Mock parity tests (the same contract suite runs against the mock and the real module) | each package's tests/contract suite | Keeps mocks honest, so parallel work and fallbacks stay valid |
| 3 | Unit tests on pure functions | everywhere | Fast, exact checks of each atom |
| 4 | Property tests (fast-check) | Smith atoms; atom normalizer (idempotent, fingerprint unchanged by renames and operand order); @mx/plan ops (versions only grow, replay gives the same plan); Construct jsxEdit (only the edited range changes, parse → print round trip) | Cover every input shape at once instead of picking examples |
| 5 | Behaviour tests (cb1) | component edits (Morpheus render or Construct previewFiber + fired interaction); Trace pages (render with fixture data); workflows (replay events through processMachine); atoms (behavioural fingerprints); imports (characterization); every plan step (before/after behaviour snapshot) | A step counts only if what it does is right, not just its types |
| 6 | Rule tests with fixes (ca2) | Construct packages/core/profiles/line: per rule a passing fixture, a failing fixture, and "apply the typed fix, validate passes" | Every constraint is enforced and every error can correct itself |
| 7 | Golden output tests | Construct generators, Morpheus emit, Trace emit, summarizer sentences | Generated code and text change only on purpose |
| 8 | Accuracy evals with targets | @mx/reason ladder per step (static, options + pick, review); Trace eval gate; held-out sets; nightly | Each AI or static step stays on only if it meets its target; regressions fail the build |
| 9 | AI block tests with a fake model | @mx/reason, @mx/plan driver, GateLM filler | Static rejects invalid Qwen options; the jev cloze format is exact; the ledger records every decision; results are repeatable |
| 10 | Plain-English tests | summarizer; a check over every user-facing string in Cockpit and chat | Every message is a full sentence with no raw ids or code names; technical detail only in Details |
| 11 | Fallback tests (cm1) | each module: local model down, memory corrupt, plan store unreadable, writer refusing, registry missing a tool | Line degrades to the static path with a clear message instead of failing |
| 12 | Concurrency tests | @mx/plan (version conflicts, two drivers on one plan); Construct transactionalWriter (crash mid-write leaves no half file) | People and agents can work at the same time safely |
| 13 | Boundary and security tests | writer refuses outside the workspace; agents cannot call registry tools directly; agent MCP lists only plan tools; no network except local models; embeddings never receive code | The non-negotiable rules hold under attack or mistakes |
| 14 | Integration tests | click → goal question → plan step → registry → writer → validate → behaviour test; chat → AI block → plan → run; Import agent on a fixture app; a feature with two pages wired | The pieces work together, not only alone |
| 15 | End-to-end tests (Playwright, one per UI feature, Cockpit's rule) | ui/e2e: chat-first screens, goal question, Plan strip, spot edit, Trace mode highlight, Auto + Trace simulated cursor, Import flow | What users do in Cockpit works in a real browser |
| 16 | Effort budget tests | ui/e2e | Each question or remaining fix takes at most two clicks or two line edits; counted automatically |
| 17 | Speed and token budget tests | ledger timings per step; default path uses no cloud tokens | Static stays fast; users' tokens are spent only when needed |
| 18 | Visual tests | Cockpit screens in Trace's style, light and dark, phone width without sideways scroll | The style holds as screens change |
| 19 | Accessibility tests (axe + keyboard) | ui/e2e | Everyone can use Cockpit |
| 20 | Migration safety tests | Import: files outside the chosen folder are byte-identical before and after (hashes) | Partial migration never touches the rest of the user's project |
| 21 | Memory tests | local per-project memory: never sent out, project A never retrieved in project B, deleting an entry removes it from retrieval, export and import round trip | Memory stays private, separate and under the user's control |
| 22 | Claude loop tests | minimal case extraction is deterministic; the context pack stays within its size; every fix adds a test made from the case | Claude's work stays small, cheap and proven |
| 23 | Spec and traceability tests | generated Line spec matches the registry and rules; every rule in LINE.md maps to a Construct rule id or a test | Docs and enforcement never drift apart |
| 24 | Mutation tests (Stryker) | Construct rules, Smith atoms, @mx/plan checks | Proves the tests actually catch bugs |
| 25 | Flaky test detection | CI: rerun failures, quarantine and fix with an owner (first: GateLM's timing-sensitive verify tests) | A red build always means a real problem |
