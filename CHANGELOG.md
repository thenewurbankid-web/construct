# Changelog

All notable changes to Construct are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). The version policy is
in [docs/VERSIONING.md](docs/VERSIONING.md). Numbers in brackets are pull
request or issue numbers.

## [Unreleased]

Open pull requests, not merged yet.

### Cockpit
- Run a generated QA test from the Cockpit as a process, with failures told apart by cause ([#389], issue #305).
- Confine the Cockpit to one workspace folder (`CONSTRUCT_WORKSPACE_ROOT`) and start with no project open ([#390], issue #365).

## [0.8.0] - 2026-09-20 (planned baseline)

First tracked baseline. It collects everything shipped since the project began.
The package version fields are not changed by this entry.

### CLI
- `construct create`, `refactor`, `research` groups over the flat commands; `IMPORT-001` build-order enforcement ([#25]).
- `construct import`, including `--plan` batches, optional `--llm` fill, and the guided `--route` wizard ([#26], [#27]).
- Adopt Construct in a subdirectory of an existing project with `--dir` ([#22]).
- `frozen:` globs for externally authored UI, with write refusal and the wrap-don't-duplicate rules ([#171]).
- `construct create service --openapi`: OpenAPI to RTK Query, no model ([#115], [#118]).
- `construct summarize`: structured, model-free summaries of any unit ([#235]).
- `construct research workflow`: state machines explained in plain English ([#203]).
- `construct research impact`: blast radius of a change, each entry marked derived or inferred ([#294]).
- `construct review <base> <head>`: PR health between two refs ([#344]).
- `construct template list|show|instantiate` for named plans, loaded from a folder you supply ([#353]).
- Per-step and total timing on generation and import commands ([#169]).
- Generators and refactor produce valid identifiers for hyphenated names ([#219], [#220]); a controller without its page is refused by name ([#280]).
- `--llm` fill hardened, with an Ollama provider and per-capability routing ([#107], [#179]).

### Cockpit
- Web UI over create, refactor, research and import, plus the import wizard chat (Module 5).
- Cockpit shell: light and dark themes, panes, top bar, tab host, Diagnostics and Logs drawer, command palette, narrow layout ([#246], [#253], [#256], [#257], [#258]).
- Pages editor: JSX tree, props inspector, prop-flow diagram, Monaco source view, external-change diff, scope and binding panel, live preview with click to source, click to navigate ([#105], [#228], [#231], [#233], [#237], [#345]).
- Flyde-style visual composer for the snippet editor ([#132]).
- Workflows: render real XState machines, edit states, transitions, context, actions and guards, plain-English panels ([#172], [#178], [#241]).
- Project gate with an allowlisted directory browser ([#239]).
- Processes drawer with list, detail, controls and live logs; approve or reject a bot's artifacts ([#343], [#347]).
- Plan mode: ticket, impact, plan review and edit, run ([#355]).
- Review mode: pull requests by feature and layer, findings, blast radius, cancellable analyses, keyboard navigation ([#350], [#357], [#363]).
- Files and Flow switch in the Browser pane ([#349]).
- Tests tab: scenario coverage, clone to edit a locked test, step document and edit panel, empty and stale states ([#356], [#361], [#364]).
- Commit on save with a deterministic, impact-counted message ([#327]).
- AI Toolkit: Ollama detection, model pull, model picker ([#108]).
- In-product Help with tutorials ([#168], [#170]); popovers close consistently ([#360]).
- Accessibility pass over every screen and theme ([#262]).

### Core
- `src/ast/`: all parsing on typescript-estree, in one package ([#95], [#177]).
- Context envelope pipeline and zero-model generators ([#118]).
- Framework targets: `nextjs` and `react-spa`, with per-framework route adapters ([#342]).
- One exceptions module and one layer classifier ([#222]).
- Plan schema with ordered steps that reference real flows ([#293]).
- Process runtime model: lifecycle, per-step status, provenance log, artifacts, control ([#322]).
- Bot runner for the process engine ([#329]) and the approval gate for bot artifacts ([#340]).
- PR health engine ([#344]).
- Locked, per-scenario Playwright spec generation that emits `data-testid` and `data-flow-state` ([#352]).
- Rules: workflow dead-end and unreachable-state checks, `MODULE-001` on the AST, `DRY-001` thin-controller fix, tests-dir lint ([#339], [#354]).
- Workflow narrator: plain-English machine explanation, scenarios, health findings ([#203]).

### Security
- The UI server restricts CORS and WebSocket origins; it was allow-all ([#143]).
- GitHub OAuth login: every API route and the WebSocket require a session, with an allowlist of logins ([#310]).
- Non-local binds are refused without login.

### Docs and site
- Docs site on GitHub Pages: user guide and developer docs ([#201], [#226]).
- Site rebuilt problem-first, nine CLI, Cockpit and Core examples in place of tutorials and walkthroughs ([#362]).
- Demo guides and the Demo Style Guide ([#202]); `docs/` for the execution model, impact analysis, PR health, unit summaries and design ([#242], [#272]).
- Design module: concept mocks and specs ([#242], [#309], [#323], [#336], [#358], [#377]).
- Project board and resource-guard tooling (`tools/dev/heavy.sh`) ([#200], [#255]).

[#22]: https://github.com/thenewurbankid-web/construct/issues/22
[#25]: https://github.com/thenewurbankid-web/construct/issues/25
[#26]: https://github.com/thenewurbankid-web/construct/issues/26
[#27]: https://github.com/thenewurbankid-web/construct/issues/27
[#95]: https://github.com/thenewurbankid-web/construct/pull/95
[#105]: https://github.com/thenewurbankid-web/construct/pull/105
[#107]: https://github.com/thenewurbankid-web/construct/pull/107
[#108]: https://github.com/thenewurbankid-web/construct/pull/108
[#115]: https://github.com/thenewurbankid-web/construct/issues/115
[#118]: https://github.com/thenewurbankid-web/construct/pull/118
[#132]: https://github.com/thenewurbankid-web/construct/pull/132
[#143]: https://github.com/thenewurbankid-web/construct/pull/143
[#168]: https://github.com/thenewurbankid-web/construct/pull/168
[#169]: https://github.com/thenewurbankid-web/construct/pull/169
[#170]: https://github.com/thenewurbankid-web/construct/pull/170
[#171]: https://github.com/thenewurbankid-web/construct/pull/171
[#172]: https://github.com/thenewurbankid-web/construct/pull/172
[#177]: https://github.com/thenewurbankid-web/construct/pull/177
[#178]: https://github.com/thenewurbankid-web/construct/pull/178
[#179]: https://github.com/thenewurbankid-web/construct/pull/179
[#200]: https://github.com/thenewurbankid-web/construct/pull/200
[#201]: https://github.com/thenewurbankid-web/construct/pull/201
[#202]: https://github.com/thenewurbankid-web/construct/pull/202
[#203]: https://github.com/thenewurbankid-web/construct/pull/203
[#219]: https://github.com/thenewurbankid-web/construct/pull/219
[#220]: https://github.com/thenewurbankid-web/construct/pull/220
[#222]: https://github.com/thenewurbankid-web/construct/pull/222
[#226]: https://github.com/thenewurbankid-web/construct/pull/226
[#228]: https://github.com/thenewurbankid-web/construct/pull/228
[#231]: https://github.com/thenewurbankid-web/construct/pull/231
[#233]: https://github.com/thenewurbankid-web/construct/pull/233
[#235]: https://github.com/thenewurbankid-web/construct/pull/235
[#237]: https://github.com/thenewurbankid-web/construct/pull/237
[#239]: https://github.com/thenewurbankid-web/construct/pull/239
[#241]: https://github.com/thenewurbankid-web/construct/pull/241
[#242]: https://github.com/thenewurbankid-web/construct/pull/242
[#246]: https://github.com/thenewurbankid-web/construct/pull/246
[#253]: https://github.com/thenewurbankid-web/construct/pull/253
[#255]: https://github.com/thenewurbankid-web/construct/pull/255
[#256]: https://github.com/thenewurbankid-web/construct/pull/256
[#257]: https://github.com/thenewurbankid-web/construct/pull/257
[#258]: https://github.com/thenewurbankid-web/construct/pull/258
[#262]: https://github.com/thenewurbankid-web/construct/pull/262
[#272]: https://github.com/thenewurbankid-web/construct/pull/272
[#280]: https://github.com/thenewurbankid-web/construct/pull/280
[#293]: https://github.com/thenewurbankid-web/construct/pull/293
[#294]: https://github.com/thenewurbankid-web/construct/pull/294
[#309]: https://github.com/thenewurbankid-web/construct/pull/309
[#310]: https://github.com/thenewurbankid-web/construct/pull/310
[#322]: https://github.com/thenewurbankid-web/construct/pull/322
[#323]: https://github.com/thenewurbankid-web/construct/pull/323
[#327]: https://github.com/thenewurbankid-web/construct/pull/327
[#329]: https://github.com/thenewurbankid-web/construct/pull/329
[#336]: https://github.com/thenewurbankid-web/construct/pull/336
[#339]: https://github.com/thenewurbankid-web/construct/pull/339
[#340]: https://github.com/thenewurbankid-web/construct/pull/340
[#342]: https://github.com/thenewurbankid-web/construct/pull/342
[#343]: https://github.com/thenewurbankid-web/construct/pull/343
[#344]: https://github.com/thenewurbankid-web/construct/pull/344
[#345]: https://github.com/thenewurbankid-web/construct/pull/345
[#347]: https://github.com/thenewurbankid-web/construct/pull/347
[#349]: https://github.com/thenewurbankid-web/construct/pull/349
[#350]: https://github.com/thenewurbankid-web/construct/pull/350
[#352]: https://github.com/thenewurbankid-web/construct/pull/352
[#353]: https://github.com/thenewurbankid-web/construct/pull/353
[#354]: https://github.com/thenewurbankid-web/construct/pull/354
[#355]: https://github.com/thenewurbankid-web/construct/pull/355
[#356]: https://github.com/thenewurbankid-web/construct/pull/356
[#357]: https://github.com/thenewurbankid-web/construct/pull/357
[#358]: https://github.com/thenewurbankid-web/construct/pull/358
[#360]: https://github.com/thenewurbankid-web/construct/pull/360
[#361]: https://github.com/thenewurbankid-web/construct/pull/361
[#362]: https://github.com/thenewurbankid-web/construct/pull/362
[#363]: https://github.com/thenewurbankid-web/construct/pull/363
[#364]: https://github.com/thenewurbankid-web/construct/pull/364
[#377]: https://github.com/thenewurbankid-web/construct/pull/377
[#389]: https://github.com/thenewurbankid-web/construct/pull/389
[#390]: https://github.com/thenewurbankid-web/construct/pull/390
