# Line: product, goal and mission

Every agent working on Line reads this first. It is set by the owner and overrides older notes that disagree.

## Mission
Show the world a better way to code than vibe coding: planned, checked and explained. This is a serious product, not a side project.

## Product
Line is a generator framework with enforced architecture, like JHipster. It is not an AI tool.
- **Construct** is the framework. It sets the architecture and enforces it (`construct validate --profile line`), and owns the writer and the building blocks.
- **Cockpit** is the main product: a visual app for no-code editing, plus spot code editing in the browser (change one fragment without seeing the whole file). It keeps Cockpit's frame and uses Trace's demo style.
- **CLI and MCP** let people's own agents drive Line. They come second to Cockpit.
- Trace (page-to-API wiring) and Morpheus (shapes to components) belong to Cockpit, in `~/Repositories/construct`.

## Goal
A developer opens Cockpit, starts a new Line project or imports an existing app, and builds features from library items, with every change checked and explained. Line is for new projects; the Import flow brings existing apps in (partially inside one folder, or fully into a new Line app).

## How Line works (non-negotiable)
- Static first. AI acts as linters and helpers that improve the static tools, and only where measurement shows it helps (static → Qwen options → jev picks → one Qwen review, each step on only if it meets its target).
- Every action, clicked or typed, is a step in a plan in a session. With no active plan, Line asks for the goal. Agents (and Line's own AI) drive only through the plan API, never by calling tools directly.
- One shared module per concern across every app: @mx/reason (AI decisions), @mx/plan (plans and the tool registry), Construct's writer (all writes), Construct's summarize block on Smith (all English), Trace's matcher, Construct's rules.
- Library and feature: the library holds complete components, pages, workflows and fixtures; every feature item is based on one library item; a feature uses the library, never another feature; every feature page belongs to one feature; the feature's spec lives in its folder.
- Users see plain English first; technical details sit in a collapsed disclosure.
- Two modes: Auto (fills in what passes the checks) and Trace (highlights the controls for each step; with Auto, a simulated mouse and keyboard act it out).
- To make AI better, we recommend local, project-specific tools (local embeddings, per-project memory and small local models such as GateLM) over prompt and context engineering. Developers do not have to manage any of this: Line builds and maintains the project's embeddings, memory and local models by itself, from plans and feedback. The controls exist for those who want them, but nothing requires them. No more instruction files, prompt files or skills for developers to write and maintain: Line replaces them with its own tools, rules and project-specific models. Memory is local and per project, and users control it. Embeddings run on English requests and typed structure, never on code.
- Production standards: evidence before claims, real users early, focus over feature sprawl, no code outside git, tests and type checks clean.

## Where the details are
- Decisions and status: `docs/handoff-2026-10-10-line.md` in this repo.
- Architecture rules: `docs/line-architecture.md` on construct branch `line/ca1`.
- Progress: https://claude.ai/artifact/MeBjHC1CW7ZHHc4M95t7AN
