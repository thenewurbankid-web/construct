// The one-shot CLI's top-level usage text (printed by packages/cli/construct.mjs
// when invoked with no command, or an unrecognized one). Pulled out into
// its own module — rather than left as a local const in the bin script —
// so anything else that wants to show the *real* CLI usage text (e.g. the
// UI's Help page, via a small read-only backend endpoint) can import the
// exact same string instead of hand-copying/duplicating it and risking
// drift from what `construct` with no args actually prints.
export const USAGE = `Construct

Run 'construct repl' for an interactive shell with detailed built-in help
('help', 'help <topic>') — no need to retype 'node .../construct.mjs' or
--dir on every line.

Four capabilities, one CLI:
  construct create ...    scaffold a feature, a layer, or a whole vertical slice
  construct refactor ...  mechanical, LLM-free moves/renames within the architecture
  construct research ...  read-only: summarize a feature, explain its workflows in English, compute a change's impact, or check environment/tooling
  construct import ...    scaffold layers for an existing, non-Construct file + a breadcrumb to it

  construct create feature <name> [--format json] [--dir <path>]
  construct create layer <name> --feature <feature> --layers <l1,l2,...> [--llm <provider> | --format json] [--dir <path>]
  construct create <layer> <name> --feature <feature> [--llm <provider> | --format json] [--dir <path>]
  construct create layer|<layer> <name> --feature <feature> --shape list|detail|form|dashboard|wizard [--entity <Entity>] [--fields id:string,name:string,...] [--source local|endpoint|openapi] [--steps details,review,done] [--states default|custom|skip-empty|skip-all]
    (a screen shape fills the units with real, typed code, deterministic, no model, so no --llm: list = the items of an entity with
    loading, empty and error states; detail = one item by id (the id prop or ?id=) with loading, not-found, ready and error states;
    form = a typed input per field, validation in a domain unit, a submit service, and editing, submitting, submitted and error states;
    dashboard = a titled overview: a row of tiles and up to three panels composed from one typed summary, with loading and error states;
    wizard = a multi-step flow run by an XState machine in the workflow layer (--steps a,b,c: two to six, default details,review,done;
    NEXT and BACK guarded by the step, SUBMIT only on the last), a component per step, and a submit service;
    --states says how a list, detail or dashboard shows its states (#622): default = a message for each, custom = a component of its own for each,
    skip-empty = no view for the empty or not-found state (a warning), skip-all = no view for any state (a warning); the typed states never change;
    --layers domain,service,hook,component,page,controller writes the whole screen (a wizard adds workflow: --layers
    domain,service,workflow,hook,component,page,controller);
    --source picks where the service reads its data (#621): local = a typed in-memory store with seed rows (a second domain file), so the
    screen works with no backend; endpoint = fetch /api/<plural>, which must exist (the default when --source is not given); openapi =
    the path of the matching operation in openapi.yaml|yml|json at the root or in api/, refused when there is none)
  construct refactor move <name> --feature <feature> --from <layer> --to <layer> [--format json] [--dir <path>]
  construct refactor rename <name> <newName> --feature <feature> --layer <layer> [--format json] [--dir <path>]
  construct refactor extract-expression <file> [--range <start:end>] [--name <Name>] [--dry-run] [--dir <path>]
    (hoists a PAGE-008/COMPONENT-005/EXPR-004-flagged inline conditional/loop out of <file> into a
    named defineExpression(...) unit under that feature's expressions/ folder, and any hand-authored
    markup it rendered into a companion defineComponent(...) unit — rewrites the call site to match)
  construct refactor wrap <Name> --feature <feature> --provider <hook> [--dry-run] [--format json] [--dir <path>]
    (wraps a component or page with one provider of the project, a hook built with defineProvider in features/*/hooks/*Provider*: adds the
    import of the provider's root component and puts <Name /> inside it, in the controller of the feature that renders it, a minimal edit;
    without --provider it lists the providers found; --dry-run prints the diff and writes nothing; idempotent; refuses, with the reason, an
    element no controller renders (a route entry may import only controllers), one rendered in several places, or a provider that cannot be
    used; deterministic, no LLM)
  construct summarize <unit-ref> [--kind <k>] [--detail brief|standard|full] [--include a,b] [--format json|markdown] [--dir <path>]
  construct summarize --list [--kind <k>] | --usage   (structured, LLM-free summaries of any feature/file/hook/route/rule/package)
  construct research summarize [--feature <name>] [--format json|md|compact|prose] [--since <ref>] [--dir <path>]
  construct research workflow <feature> [<file>] [--format prose|md|json|scenarios] [--dir <path>]
  construct research doctor [--dir <path>]
  construct research impact <unit-ref>... [--files a,b] [--since <ref>] [--ticket <text>] [--ticket-file <path>] [--depth N] [--max-files N] [--format json|markdown] [--dir <path>]
  construct research impact --usage   (deterministic blast radius: which features/layers/files a change touches, and why)
  construct research spec <file> [--generate [--feature <name>]] [--format json|text] [--dir <path>]
    (checks a machine-spec.v1 file -- an English requirement broken down into states, events, transitions and typed
    functions -- and refuses it with a SPEC-* code, the path and the reason: unreachable state, unknown state/event,
    untyped function, sentence neither covered nor out of scope; see docs/machine-spec.md; exit 1 on any failure)
    (--generate: on an accepted spec, writes the workflow (with its typed state union and named guard stubs) and
    one defineService(...) stub per function, never overwriting an existing file; --feature is used only when the
    spec has no "feature" field, and it is a usage error (exit 2) to have neither)
  construct review <base> <head> [--plan <file>] [--features a,b] [--no-merge-base] [--format json|markdown] [--dir <path>]
  construct review --usage   (read-only PR health between two git refs: scope, unexplained changes, rule regressions, public surface, flow diff; findings split mechanical vs conversation)
  construct test run <feature> [--name <file> --area generated|yours] [--base-url <url>] [--format json|text] [--dir <path>]
    (runs the feature's Playwright tests against the project's own running app (default http://localhost:3000, this machine
    only) and says per failure whether the test harness or the app is at fault; read-only, no LLM; exit 1 on any failure)
  construct test proof <feature> [--name <file>] [--format json|text] [--dir <path>]
    (runs the render proof of a shaped screen, written by 'construct create proof': no browser, no server, needs esbuild in the
    project (it comes with tsx and vite); says per failure whether the app or the harness is at fault and whether the chain is
    complete; read-only, no LLM; exit 1 on any failure)
  construct test types [--feature <feature>] [--format json|text] [--dir <path>]
    (type-checks the project with its own TypeScript (tsc --noEmit over its tsconfig) and prints a classified result: a pass, or the errors
    grouped by file (the first ten with line, code and message), each a missing import, an unknown name or a type mismatch; --feature reports
    only that feature's files; exit 0 for a pass, 1 when there are errors, 2 when it could not run (no TypeScript, no tsconfig); read-only, no LLM)
  construct test build [--format json|text] [--dir <path>]
    (runs the project's build script through a bounded process (a timeout, an output cap) and prints a classified result: a pass, a compile
    error with file and line, a missing build script, a timeout, or another failure with the end of its output; read-only, no LLM; exit 0/1/2 as above)
  construct template list|show <name>|instantiate <name> [--param key=value]... [--params-json <json>] --templates <dir>
  construct template ...   (named, reusable, parameterised plans: instantiate prints a concrete plan.v1; curated templates load from --templates <dir> or CONSTRUCT_TEMPLATES_DIR, none are bundled)
  construct import <name> --feature <feature> --layers <l1,l2,...> --from <path> [--llm <provider> | --format json] [--dir <path>]
  construct import --plan <path> [--llm <provider> | --format json] [--dir <path>]
  construct import --route <path>  (standalone interactive wizard, run directly — not inside repl)

'construct import' scaffolds the requested layers and drops a TODO(import)
comment in each pointing at the source file, then by default stops there —
reading that file and writing the real ported logic is left to you (or
whichever LLM you choose) as an explicit next step. '--plan <path>' is the
whole-feature form: given a plan ({ feature, units: [{ name, layers, from },
...] }) produced by whichever LLM analyzed the old feature and approved by
you, it runs the same step once per unit, in one command.

Pass --llm <provider> (currently: claude, ollama) to have import do the
writing for you instead: it calls that provider once per generated file —
never once for the whole batch — with that file's layer constraints and the
old source, and writes the result directly. Review LLM-written output
before trusting it.

'construct create'/'construct generate' accept the same --llm <provider>
flag: when given, that provider writes a real implementation into each
generated file in place of the plain template stub — one call per file,
that file's layer constraints included, same as import's fill above. Which
layers/files get created is still always decided deterministically; --llm
only changes what ends up inside the file(s) that were already going to be
created. Omit --llm and every generated file is the exact same plain
template stub as before. Locating files, scaffolding, and deciding feature
shape never involve an LLM either way.

'construct import --route <path>' is the guided, whole-feature form. <path>
is a real router route — a URL like /v2/home, or the folder that owns its
page.tsx — and seeds the first one; it then asks for as many more as the
old feature actually spans (e.g. /v2/home and /v2/home/details), traces
each one's real import graph (page -> Client -> hooks/components, stopping
at known external boundaries) rather than reading a hand-picked directory,
auto-creates the destination feature if it doesn't exist yet (never touches
it if it does), analyzes everything with ONE combined "claude" call, shows
you the plan, and on approval builds it, then immediately runs validate and
tells you exactly what's left — a TODO(import) count to fill in, or a
reminder to review LLM-written output. A URL-style route needs to know
where your app/ directory is; it asks once and reuses it for every further
route this session. It manages its own input, so run it directly from your
shell — not typed inside 'construct repl', which is already reading input.

Each of the above has a flat equivalent (unchanged, still supported):

Commands:
  construct init [dir] [--framework nextjs|react-spa] [--no-scaffold]
    (also writes a runnable project shell — package.json, tsconfig, bundler config,
    .gitignore — never overwriting existing files; --no-scaffold skips that part)
  construct feature create <name> [--dir <path>]
  construct generate <layer> <name> --feature <feature> [--llm <provider>] [--dir <path>]
  construct generate page <name> --feature <feature> --from <path> [--dir <path>]
    (ingests an externally-authored JSX file — e.g. a Subframe export — as a
    pristine, presentation-only page + an explicit <Name>PageProps.ts interface,
    instead of scaffolding the usual stub template; 'construct create page ... --from
    <path>' is the equivalent under the create/refactor/research/import grouping)
  construct generate workflow <name> --feature <feature> --from <path-to-json> [--state-union] [--dir <path>]
    (compiles a JSON state-graph descriptor into a real XState v5 machine file
    instead of the usual stub template; 'construct create workflow ... --from <path>'
    is the equivalent under the create/refactor/research/import grouping.
    --state-union also writes <Name>WorkflowState.ts beside it: a <Name>State
    discriminated union, one { status } member per state, plus match<Name>State and
    assertNever<Name>State, which stop compiling when a state is left unhandled)
  construct generate controller <name> --feature <feature> --bind [--envelope <path>] [--dir <path>]
    (auto-wires an already-generated hook into an already-generated pristine page's
    Props interface via exact + fuzzy AST signature matching, instead of the usual
    same-named-page-only stub template; 'construct create controller ... --bind' is
    the equivalent under the create/refactor/research/import grouping)
  construct generate layer <name> --feature <feature> --layers <l1,l2,...> [--llm <provider>] [--dir <path>]
  construct generate tests <feature> [--dry-run] [--prune] [--dir <path>]
    (one LOCKED Playwright spec per workflow scenario into features/<feature>/tests/generated/;
    needs frozen: + nonLayer: globs for tests in architecture.yml; deterministic, no LLM)
  construct create proof <Name> --feature <feature> [--shape list|detail|form|dashboard|wizard] [--entity <Entity>] [--fields id:string,...] [--source local|endpoint|openapi] [--steps a,b,c] [--states default|custom|skip-empty|skip-all] [--kind render|playwright] [--route </path>] [--dir <path>]
    (the locked proof of a shaped screen in features/<feature>/tests/generated/: the states of the shape with sample props (list: loading,
    empty, items, error; detail: loading, not found, ready, error; form: fields with labels, a message per invalid field, submitting,
    submitted, error), the controller's first state, the service with a stubbed fetch; --kind playwright writes the route flow only when the project already has a
    Playwright config; declares the frozen: and nonLayer: test regions in architecture.yml once; deterministic, no LLM)
  construct create route <Name> --feature <feature> [--route </path>] [--dir <path>]
    (points the project's route entry at the controller of a generated screen: Next.js creates app/<route>/page.tsx, react-spa adds
    the import and a <Route> to src/App.tsx and drops the dangling controller import 'construct init' leaves; the route defaults to the
    kebab-case of the name; refuses a route something else owns; idempotent; deterministic, no LLM)
  construct create env <NAME> --scope server|public [--value <placeholder>] [--comment <line>] [--dir <path>]
    (adds one variable to .env.example with a comment and a placeholder, never a real value, creating the file when absent: the name is
    [A-Z][A-Z0-9_]{0,63}; scope public adds the framework's public prefix (NEXT_PUBLIC_, or VITE_ for react-spa); a --value is refused when
    the name looks like a secret; a server variable read in a 'use client' file is a CLIENT-001 violation; idempotent; deterministic, no LLM)
  construct create dependency <package> --version <range> [--dir <path>]
    (adds one line to the dependencies of package.json, for example @line/construct-core, which the generated typed units import;
    never runs a package manager; idempotent; deterministic, no LLM)
  construct generate tests --unit <feature> [--dry-run] [--prune] [--dir <path>]
    (one LOCKED every-path unit test per workflow machine, <machine>--every-path.test.ts in the
    same directory: @xstate/graph walks every reachable state and user-event transition under
    node's test runner, no browser; run with npx tsx --test <file>)
  construct sync [--dir <path>]
  construct validate [--format json] [--dir <path>]
  construct summarize [--feature <name>] [--format json|md|compact|prose] [--since <ref>] [--dir <path>]
  construct doctor [--format json] [--dir <path>]
  construct pipeline run [--dir <path>]   (reads a Context Envelope as JSON on stdin, writes one to stdout)
  construct traces list [--chooser <id>] [--limit <n>] [--json] [--dir <path>]
  construct traces stats [--chooser <id>] [--json] [--dir <path>]
  construct traces replay (--provider <name> [--plugin <file.mjs>] | --model <name> [--all]) [--chooser <id>] [--min-traces <n>] [--baseline <name>] [--json] [--dir <path>]
  construct traces export --out <dir> [--since <date>] [--chooser <id>] [--yes] [--json] [--dir <path>]
    (the choices made in a chain are recorded locally as decision-trace.v1, never inside your project: 'list' shows them, 'stats'
    counts them and how often a suggestion was taken, 'replay' scores a decision provider (rules, off, a plugin) on what people
    chose against the rules baseline: beats, ties or loses, promotable only on >= 30 traces; read-only, no model, no network;
    switch recording off with 'traces: off' in architecture.yml; see docs/DECISION-TRACES.md; 'export' previews, and with --yes
    writes, a dataset bundle to train the decision model on ANOTHER machine: nothing trains here, see docs/TRAIN-ELSEWHERE.md)
  construct model list [--json] [--dir <path>]
  construct model import <dir> [--yes] [--min-traces <n>] [--json] [--dir <path>]
  construct model remove|enable|disable <name> [--json] [--dir <path>]
    (a model trained elsewhere comes back as plain data: 'import' refuses anything else (scripts, pickles, links, paths, wrong
    checksums, a dataset this project never exported), replays the held-out traces against the rules baseline and, with --yes,
    registers it DISABLED in the state directory; architecture.yml is never edited; 'enable' is your explicit act)
  construct decide --summary <file|-> [--provider <name>] [--format json] [--dir <path>]
  construct decide --requirement "<sentence>" [--provider <name>] [--format json] [--dir <path>]
    (the decision model as a tool: a chooser or open-question summary as JSON in, one suggestion out {option, reason, runnerUp};
    --requirement prints the suggestion for each open question and offer of a sentence. Read-only, suggests and never applies.
    The default provider is 'rules', no model; 'decision: { provider, plugin }' in architecture.yml names a plugin, which falls
    back to rules when it fails or is slow; see docs/DECISION-PROVIDERS.md)

--dir <path> targets a Construct project nested in a subdirectory (e.g. one
created with 'construct init <path>' inside a larger, unrelated project)
without requiring you to cd into it first.

Generation/refactor order is enforced for real by IMPORT-001, not left as a
convention: a layer whose template references a sibling layer's file (e.g. a
controller importing its page) fails immediately if that file doesn't exist
yet — so 'construct generate layer' always builds requested layers in
dependency order regardless of how you list them, and a refactor move/rename
that leaves a naming mismatch in its new layer is reported right away.

Externally-authored UI (a design tool's output): list its globs under 'frozen:'
in architecture.yml (relative to the project root; may reach outside it). Every
create/generate/import/refactor/pipeline write into a matching path is refused,
and PAGE-007 / COMPONENT-004 / CONTROLLER-002 (warnings by default) flag pages,
components and controllers that re-author markup already in a frozen source
instead of a controller importing it and forwarding props. See the README.

'construct refactor' never rewrites a file's own content or exported
identifier — only its location/name and every other file's import of it.
Whether the result is valid in its new layer (naming, purity, etc.) is
construct validate's job, reported immediately after the move.`;
