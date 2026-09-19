// Interactive front-end over the exact same functions bin/construct.mjs
// dispatches to for a one-shot invocation — no new command logic lives
// here, only line-reading, tokenizing, help text, and a `cd`/`pwd`
// convenience so a session doesn't need --dir on every line. (`import
// --route`'s wizard is a deliberately standalone command, not part of this
// file — it manages its own input, so it isn't safe to nest inside this
// loop's own stdin consumption; see cli.mjs's `runImportRouteWizard`.)
import path from 'node:path';
import { init, feature, generate, sync, validate, summarize, doctor, create, refactor, research, importCommand } from './cli.mjs';
import { findProjectRoot } from './config.mjs';
import { ConstructError } from './diagnostics.mjs';
import { makeLineSource } from './line-source.mjs';

const COMMANDS = {
  init, feature, generate, g: generate, sync, validate, summarize, doctor, create, refactor, research, import: importCommand,
};

export const HELP_TOPICS = {
  create: `create — scaffold a feature, a layer, or a whole vertical slice (deciding what to create is always deterministic; filling one is opt-in)

  create feature <name> [--dir <path>]
      Scaffold a new feature: all 7 layer folders + types.ts + index.ts.
      Example: create feature cpo-v2

  create layer <name> --feature <feature> --layers <l1,l2,...> [--llm <provider>] [--dir <path>]
      Scaffold one logical unit across several layers in a single command,
      always generated in dependency order (domain -> service -> workflow ->
      hook -> component -> page -> controller) regardless of the order you
      list --layers in.
      Example: create layer CpoAccess --feature cpo-v2 --layers domain,hook

  create <layer> <name> --feature <feature> [--llm <provider>] [--dir <path>]
      Scaffold a single file in one layer. <layer> is one of: domain,
      service, workflow, hook, component, page, controller.
      Example: create domain CpoAccess --feature cpo-v2

  Every create command only ever writes a short, self-contained stub by
  default — filling in the real logic is a separate, deliberate step (by
  you, or by an LLM you choose). Pass --llm <provider> (same providers as
  "import", currently: claude, ollama) to have that provider write a real
  implementation into each generated file instead — one call per file,
  scoped strictly to that one file's own body. Which layers/files get
  created is always decided deterministically either way; --llm only
  changes what ends up inside them. "create feature" has nothing fillable
  (just types.ts/index.ts boilerplate), so --llm has no effect there.
      Example: create domain CpoAccess --feature cpo-v2 --llm claude`,

  refactor: `refactor — mechanical, LLM-free moves/renames within the architecture

  refactor move <name> --feature <feature> --from <layer> --to <layer> [--dir <path>]
      Relocate a file from one layer to another, keeping its base name.
      Rewrites every other file's import of it, AND the moved file's own
      same-layer relative imports (layer folders are siblings, so those
      would otherwise point at the wrong directory after the move).
      Example: refactor move CpoAccess --feature cpo-v2 --from domain --to service

  refactor rename <name> <newName> --feature <feature> --layer <layer> [--dir <path>]
      Rename a file within the same layer. Same import-rewriting as move.
      Example: refactor rename Foo Bar --feature cpo-v2 --layer domain

  Neither command touches a file's own content or its exported identifier —
  only its location/name and every other file's import path. Whether the
  result is valid in its new home (naming convention, purity, etc.) is
  reported immediately afterward via "validate", not decided here. There's
  no persistent log: the one line each command prints IS the record.`,

  research: `research — read-only: summarize a feature, explain its workflows in English, compute a change's impact, or check environment/tooling

  research summarize [--feature <name>] [--format json|md|compact|prose] [--since <ref>] [--dir <path>]
      English or JSON/Markdown summary of a feature's structure and exports.
      Example: research summarize --feature cpo-v2 --format prose

  research workflow <feature> [<file>] [--format prose|md|json|scenarios] [--dir <path>]
      Explains the state machines in features/<feature>/workflows/ in plain
      English: what each state does, every scenario from start to end
      (happy path first), and health findings (unreachable states, dead
      ends, missing fallbacks). Derived from the source every time — no LLM.
      Formats: prose (default), md, json, scenarios (Given/When/Then only).
      Example: research workflow checkout CheckoutWorkflow.ts --format scenarios

  research impact <unit-ref>... [--files a,b] [--since <ref>] [--ticket <text>]
                  [--ticket-file <path>] [--depth N] [--max-files N]
                  [--format json|markdown] [--dir <path>]
      The blast radius of a change: which features and layers it touches,
      why each file is implicated, which files are shared across features,
      and what your rules already say about them. Deterministic and LLM-free.
      Seeds are unit refs (feature:login, a file path, /login, rule:PAGE-003),
      changed files (--files, --since <ref>) or a ticket in English (--ticket).
      Every entry is marked "derived" (computed from the graph) or "inferred"
      (reached only from a seed guessed from ticket text). Depth defaults to
      2 importer hops; what lies past it is counted, not dropped.
      Example: research impact feature:login --depth 3 --format markdown

  research doctor [--dir <path>]
      Environment sanity check: node/npm versions, architecture.yml presence,
      which enforcer modules are available.`,

  import: `import — the tool-only half of migrating an existing, non-Construct file

  import <name> --feature <feature> --layers <l1,l2,...> --from <path> [--dir <path>]
      Scaffolds --layers exactly like "create layer" (same dependency-order
      guarantee), then prepends a "TODO(import): port ... from <path>"
      comment to each generated file. Never reads <path>'s content — only
      confirms it exists.
      Example: import CpoAccess --feature cpo-v2 --layers domain,hook --from ../src/old/CpoGate.tsx

  import --plan <path> [--dir <path>]
      The whole-feature form: runs the same scaffold-and-breadcrumb step once
      per unit listed in a plan file, in one command. The plan itself —
      which old files map to which logical units/layers — is judgment, not
      something construct can produce; have whichever LLM you're using
      analyze the old feature and propose the plan, review/approve it
      yourself, then execute it here. Plan shape:
        { "feature": "cpo-v2", "units": [
            { "name": "CpoAccess", "layers": ["domain","hook"], "from": "../old/CpoGate.ts" },
            ...
        ] }

  Either form does everything a tool safely can (locate the source(s),
  scaffold structure, wire the breadcrumb(s)) on its own, and by default
  stops there: reading the old file(s) and writing the real ported logic is
  left for you or whichever LLM you choose, as an explicit next step.

  Add --llm <provider> to have import do that step for you instead: it calls
  the provider once per generated file (never once for the whole batch),
  each time with that file's own layer constraints and the old source, and
  writes the returned code directly, replacing the TODO breadcrumb. construct
  only ever calls an LLM when you pass this flag (here, or the same flag on
  "create"/"generate" — see "help create") — everything else (locating
  files, scaffolding, --plan's batching, deciding what to create) stays
  exactly as deterministic either way.
      Supported providers: claude (shells out to the "claude" CLI; must be
      installed and authenticated on your machine), ollama (calls a local
      Ollama server's HTTP API; model configurable, defaults to
      qwen2.5-coder:7b against http://localhost:11434)
      Example: import CpoAccess --feature cpo-v2 --layers domain,hook --from ../src/old/CpoGate.tsx --llm claude
      Example: import --plan plan.json --llm claude

  Always review LLM-written output (diff against the source) before
  trusting it — run "validate" right after either way.

  import --route <path>  [standalone command — run directly, not in repl]
      The guided, whole-feature form. <path> is a real router route — a URL
      like /v2/home, or the folder that owns its page.tsx — and seeds the
      first one; it then loops asking for as many more as the old feature
      actually spans (e.g. /v2/home and /v2/home/details — one combined
      analysis call covers all of them together, not one call each). Each
      route is traced through its real import graph (page -> Client ->
      hooks/components, stopping at known external boundaries) rather than
      reading a hand-picked directory; a URL-style route needs to know
      where your app/ directory is, asked once and reused for the rest of
      the session. It auto-creates the destination feature if it doesn't
      exist yet (never touches it if it already does), shows you the
      proposed plan, and only scaffolds anything once you approve it. After
      building, it immediately runs validate and tells you exactly what's
      left — a TODO(import) count to fill in, or a reminder to review
      LLM-written output. It manages its own input, so run
      "construct import --route <path>" directly from your shell — not
      typed inside this REPL, which is already reading its own input.
      Example: construct import --route /v2/home
      Example: construct import --route ../src/old-feature/routes/home`,

  init: `init [dir]
      Bootstrap a brand-new Construct project at <dir> (default: cwd):
      architecture.yml, AGENTS.md, a starter "core" feature, and app/page.tsx.
      Works inside a subdirectory of a larger, unrelated project — nothing
      required at that project's own root.
      Example: init construct`,

  feature: `feature create <name> [--dir <path>]
      The flat form of "create feature". Scaffolds all 7 layer folders plus
      types.ts/index.ts for a new feature.`,

  generate: `generate <layer> <name> --feature <feature> [--llm <provider>] [--dir <path>]
  generate layer <name> --feature <feature> --layers <l1,l2,...> [--llm <provider>] [--dir <path>]
      The flat form of "create <layer>" / "create layer" — see "help create".`,

  sync: `sync [--dir <path>]
      Regenerate .dependency-cruiser.cjs and each feature's index.ts public
      API from its actual exports (controllers + hooks, by default).`,

  validate: `validate [--format json] [--dir <path>]
      Run every enforcer (architecture boundaries, separation of concerns,
      readability, public-API drift) and report violations.`,

  summarize: `summarize [--feature <name>] [--format json|md|compact|prose] [--since <ref>] [--dir <path>]
      The flat form of "research summarize". --since <ref> scopes the report
      to only the features touched since that git ref.`,

  doctor: `doctor [--dir <path>]
      The flat form of "research doctor".`,

  dir: `--dir <path>
      Every command accepts --dir to target a Construct project nested in a
      subdirectory without cd-ing into it first. In the REPL you'll usually
      want "cd <path>" once instead, and drop --dir from every line after.`,

  'import-001': `IMPORT-001 — why build order is enforced, not a convention
      Any relative import that doesn't resolve to a file on disk is a
      validation error, checked by both "validate" and at generate-time. A
      controller's template already imports its same-named page, so a
      controller is refused up front unless its page is either in the same
      --layers list or already on disk — nothing is written, and the message
      names the missing layer rather than reporting a dangling import after
      the fact. This is also why "create layer" always generates requested
      layers in dependency order, regardless of how you list --layers.`,
};

export const TOPIC_ORDER = ['create', 'refactor', 'research', 'import', 'init', 'feature', 'generate', 'sync', 'validate', 'summarize', 'doctor', 'dir', 'import-001'];

/** The REPL's top-level "help" output, as a string. Pulled out from
 * printTopLevelHelp() (which just logs this) so other callers — e.g. the
 * UI's Help page, via a small read-only backend endpoint — can reuse the
 * exact same text the REPL itself prints, instead of a hand-copied
 * duplicate that can drift from it. */
export function getTopLevelHelpText() {
  return `Construct REPL — type a command without the leading "construct".

  help              this list
  help <topic>      detailed help for one topic, e.g. "help refactor"
  cd <path>         change the working directory (affects every command after, instead of --dir)
  pwd               show the current working directory
  exit / quit       leave the REPL

Capabilities:
  create   ...   scaffold a feature, a layer, or a whole vertical slice
  refactor ...   mechanical, LLM-free moves/renames within the architecture
  research ...   read-only: summarize a feature, explain its workflows, compute a change's impact, or check environment/tooling
  import   ...   scaffold layers for an existing, non-Construct file + a breadcrumb to it

Note: "construct import --route <path>" (the interactive, whole-feature
wizard) is a standalone command — run it directly from your shell, not from
inside this REPL. See "help import" for why.

Flat commands (unchanged): init, feature, generate, sync, validate, summarize, doctor

Topics: ${TOPIC_ORDER.join(', ')}`;
}

function printTopLevelHelp() {
  console.log(getTopLevelHelpText());
}

function tokenize(line) {
  const matches = line.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [];
  return matches.map((t) => t.replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1'));
}

/** Context-aware "what would you plausibly run next" hints, printed after a
 * command succeeds. Static/rule-based on the command+args just run — no
 * project inspection, so it's always cheap and never wrong about what ran,
 * only ever a suggestion about what's reasonable next. */
function suggestNext(cmd, args) {
  const sub = args[0];
  const fi = args.indexOf('--feature');
  const featureFlag = fi >= 0 ? ` --feature ${args[fi + 1]}` : ' --feature <feature>';

  if (cmd === 'init') {
    return args[0] ? [`cd ${args[0]}`, 'create feature <name>'] : ['create feature <name>'];
  }
  if ((cmd === 'create' && sub === 'feature') || (cmd === 'feature' && sub === 'create')) {
    const feat = args[1] ? ` --feature ${args[1]}` : featureFlag;
    return [
      `create layer <Name>${feat} --layers domain,hook`,
      `import <Name>${feat} --layers domain,hook --from <path-to-old-file>`,
    ];
  }
  if (cmd === 'create' || cmd === 'generate') {
    return [`validate${featureFlag}`];
  }
  if (cmd === 'import') {
    const fromI = args.indexOf('--from');
    const from = fromI >= 0 ? args[fromI + 1] : '<source file>';
    return [`Open ${from} and fill in each TODO(import) marker`, `validate${featureFlag}`];
  }
  if (cmd === 'refactor') {
    return [`validate${featureFlag}`];
  }
  if (cmd === 'validate') {
    return ['sync', 'research summarize --format prose'];
  }
  if (cmd === 'sync') {
    return ['research summarize --format prose'];
  }
  return [];
}

function printBanner() {
  const root = findProjectRoot(process.cwd());
  console.log('Construct REPL. Type "help" to get started, "exit" to leave.');
  console.log(root ? `Project: ${root}` : `${process.cwd()} — not inside a Construct project yet (try "init").`);
}


export async function startRepl({ input = process.stdin, output = process.stdout } = {}) {
  const lineSource = makeLineSource(input);

  printBanner();
  while (true) {
    output.write('construct> ');
    const { done, value: line } = await lineSource.next();
    if (done) break;

    const trimmed = line.trim();
    if (!trimmed) continue;
    const [cmd, ...args] = tokenize(trimmed);

    try {
      if (cmd === 'exit' || cmd === 'quit' || cmd === '.exit') break;
      if (cmd === 'help' || cmd === '?') {
        if (!args[0]) printTopLevelHelp();
        else if (HELP_TOPICS[args[0]]) console.log(HELP_TOPICS[args[0]]);
        else console.log(`No help topic "${args[0]}". Topics: ${TOPIC_ORDER.join(', ')}`);
      } else if (cmd === 'cd') {
        if (!args[0]) console.log('Usage: cd <path>');
        else {
          process.chdir(path.resolve(args[0]));
          console.log(process.cwd());
        }
      } else if (cmd === 'pwd') {
        console.log(process.cwd());
      } else if (cmd === 'import' && args[0] === '--route') {
        console.log('Run "construct import --route <path>" directly from your shell, not from inside this REPL — see "help import".');
      } else if (COMMANDS[cmd]) {
        await COMMANDS[cmd](args);
        const next = suggestNext(cmd, args);
        if (next.length) console.log(`Next:\n${next.map((n) => `  ${n}`).join('\n')}`);
      } else {
        console.log(`Unknown command "${cmd}". Type "help" for a list.`);
      }
    } catch (e) {
      console.error(`Construct error: ${e.message}`);
      if (!(e instanceof ConstructError)) console.error(e.stack);
    } finally {
      process.exitCode = undefined;
    }
  }

  console.log('Goodbye.');
}
