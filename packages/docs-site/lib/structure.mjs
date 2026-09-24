// The documentation site's table of contents: which pages exist, their titles, and where their content comes from.
// `file` pages read a markdown file from the repository (authored under site/content, or reused docs).
// `generate` pages derive their markdown from the code itself so they cannot drift.
// `list` pages (the examples index, the how-to index) render a card list of other pages instead of prose.
//
// The user guide is grouped by the product family, not by surface: Line is the whole package, Construct is
// the framework (its Core API is one of its surfaces), and the Cockpit and the command line are the two ways
// to drive it. Example pages stay one-surface-per-page and carry `example: 'CLI' | 'Cockpit' | 'Core'`.
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const C = (name) => `site/content/${name}`;

/** Reused repository docs are wrapped in a one-line include so the same machinery handles them all. */
const E = (name) => C(`user/examples/${name}.md`);

export const EXAMPLE_SURFACES = ['CLI', 'Cockpit', 'Core'];

export const EXAMPLES_INDEX = {
  path: 'user-guide/examples/',
  title: 'Examples',
  navTitle: 'All examples',
  description: 'Each one: the problem, the exact command or screen, the exact result. CLI, Cockpit and core are kept apart.',
  file: C('user/examples-index.md'),
  list: 'examples',
};

export const HOW_TO_INDEX = {
  path: 'user-guide/how-to/',
  title: 'How-to guides',
  navTitle: 'All how-to guides',
  description: 'Task-based guides for everyday work.',
  file: C('user/how-to-index.md'),
  list: 'how-to',
};

export const USER_GROUPS = [
  {
    group: 'Start',
    pages: [
      { path: 'user-guide/getting-started/', title: 'Getting started', description: 'Try it in 60 seconds, then see what just happened.', file: C('user/getting-started.md') },
      { path: 'user-guide/line/', title: 'What Line is', description: 'The whole package: the framework, the app you work in, the terminal — and which parts are open source.', file: C('user/line.md') },
      { path: 'user-guide/concepts/', title: 'The five ideas', description: 'Tools, features, parts, rules and records, one sentence each.', file: C('user/concepts.md') },
      EXAMPLES_INDEX,
    ],
  },
  {
    group: 'Construct',
    pages: [
      { path: 'user-guide/construct/', title: 'What Construct is', description: 'The framework: your rules, the blocks that follow them, and the API underneath.', file: C('user/construct.md') },
      HOW_TO_INDEX,
      { path: 'user-guide/how-to/create/', title: 'Create features and files', description: 'Scaffold in the right place, in the right order.', file: C('user/create.md'), howTo: true },
      { path: 'user-guide/how-to/tune-rules/', title: 'Validate and tune the rules', description: 'Severity, options and time-boxed exceptions in architecture.yml.', file: C('user/tune-rules.md'), howTo: true },
      { path: 'user-guide/how-to/refactor/', title: 'Move and rename safely', description: 'Relocate a file and fix every import mechanically.', file: C('user/refactor.md'), howTo: true },
      { path: 'user-guide/how-to/import/', title: 'Import an existing app', description: 'Bring existing pages across, one file, one route or one plan at a time.', file: C('user/import.md'), howTo: true },
      { path: 'user-guide/how-to/explain-workflows/', title: 'Explain workflows in English', description: 'Turn state machines into readable steps and test scenarios.', file: C('user/explain-workflows.md'), howTo: true },
      { path: 'user-guide/how-to/frozen-ui/', title: 'Wrap design-tool output', description: 'Use Subframe or Figma-to-code output without forking it.', file: C('user/frozen-ui.md'), howTo: true },
      { path: 'user-guide/how-to/use-an-llm/', title: 'Using an AI model, optionally', description: 'When a model is involved, how to choose one, and how output is checked.', file: C('user/use-an-llm.md'), howTo: true },
      { path: 'user-guide/how-to/llm-instructions/', title: 'Let an AI model use Construct', description: 'One copy-paste prompt that lets any model drive the CLI: orient, build with the blocks, validate in a loop.', file: C('user/llm-instructions.md'), howTo: true },
      { path: 'user-guide/examples/core-plans-and-impact/', title: 'Plans and impact as an API', description: 'Validate a plan and work out what a change touches, from JavaScript.', file: E('core-plans-and-impact'), example: 'Core' },
      { path: 'user-guide/examples/core-review-tests-commits/', title: 'Review, tests and commit messages as an API', description: 'The functions the CLI and the Cockpit both call.', file: E('core-review-tests-commits'), example: 'Core' },
    ],
  },
  {
    group: 'Cockpit',
    pages: [
      { path: 'user-guide/cockpit/', title: 'Using the Cockpit', description: 'The browser app: what each screen does and how to start it.', file: C('user/cockpit.md') },
      { path: 'user-guide/examples/cockpit-plan-and-run/', title: 'Plan, run in a branch, approve per file', description: 'From a described change to a reviewed plan to changes you approve one file at a time.', file: E('cockpit-plan-and-run'), example: 'Cockpit' },
      { path: 'user-guide/examples/cockpit-review/', title: 'Review a branch by what it means', description: 'Five deterministic indicators, mechanical fixes apart from decisions.', file: E('cockpit-review'), example: 'Cockpit' },
      { path: 'user-guide/examples/cockpit-tests/', title: 'Tests: coverage, clone, step editor', description: 'Locked generated tests, cloning, and editing a test as steps.', file: E('cockpit-tests'), example: 'Cockpit' },
      { path: 'user-guide/examples/cockpit-sign-in-and-commits/', title: 'Sign-in allowlist and commit on save', description: 'GitHub login for named accounts only; every save becomes a commit.', file: E('cockpit-sign-in-and-commits'), example: 'Cockpit' },
    ],
  },
  {
    group: 'Videos',
    pages: [
      { path: 'user-guide/videos/ticket-to-story/', title: 'Build a feature, start to finish', description: 'A three-minute video: one example, a wishlist for a small shop, from a plain request to a running app.', file: C('user/videos/ticket-to-story.md') },
      { path: 'user-guide/videos/01a-meet-the-page/', title: 'Episode 1, part 1: meet the page', description: 'A two-minute video: a professional-looking shop page that does not work yet, and how the Cockpit shows the missing link today.', file: C('user/videos/01a-meet-the-page.md') },
    ],
  },
  {
    group: 'CLI',
    pages: [
      { path: 'user-guide/cli/', title: 'Using the command line', description: 'One command per job, the same answer every time, and a record of what ran.', file: C('user/cli.md') },
      { path: 'user-guide/examples/cli-scaffold-and-validate/', title: 'Scaffold, then catch a rule break', description: 'A fetch() in a page: the exact commands and the exact output.', file: E('cli-scaffold-and-validate'), example: 'CLI' },
      { path: 'user-guide/examples/cli-impact-and-review/', title: 'What a change touches, and branch review', description: 'What a change reaches, and what a branch means, without a model.', file: E('cli-impact-and-review'), example: 'CLI' },
      { path: 'user-guide/examples/cli-flows-and-tests/', title: 'Every route through a flow, tested', description: 'Explain a state machine and generate one locked test per route.', file: E('cli-flows-and-tests'), example: 'CLI' },
    ],
  },
];

/** Every user-guide page, in reading order. */
export const userPages = () => USER_GROUPS.flatMap((g) => g.pages);

/** Example pages of one surface, in reading order. */
export const examplePages = (surface) => userPages().filter((p) => p.example === surface);

/** The card lists rendered by the `list` pages. */
export function listGroups(kind) {
  if (kind === 'examples') return EXAMPLE_SURFACES.map((s) => ({ group: s, items: examplePages(s) }));
  if (kind === 'how-to') return [{ group: 'Guides', items: userPages().filter((p) => p.howTo) }];
  throw new Error(`unknown list page "${kind}"`);
}

export const DEV_GROUPS = [
  {
    group: 'Overview',
    pages: [
      { path: 'developers/architecture/', title: 'Architecture', description: 'Layers, rules, policy and how validation works.', file: C('developers/architecture.md') },
      { path: 'developers/repository-layout/', title: 'Repository layout', description: 'Where everything lives and how the pieces relate.', file: C('developers/repository-layout.md') },
      { path: 'developers/execution-model/', title: 'Execution model', description: 'Every command: deterministic code, model call or human gate.', file: 'docs/execution-model.md', source: 'docs/execution-model.md' },
    ],
  },
  {
    group: 'Internals',
    pages: [
      { path: 'developers/context-envelope/', title: 'Context Envelope and pipeline', description: 'Chain generator steps with machine-readable state.', file: C('developers/context-envelope.md') },
      { path: 'developers/ast/', title: 'The AST package', description: 'Parse, walk, extract and generate TypeScript and JSX.', file: 'packages/ast/README.md', source: 'packages/ast/README.md' },
      { path: 'developers/workflows/', title: 'Workflow narrator', description: 'State machines to plain English, scenarios and health checks.', file: 'docs/workflow-narrator.md', source: 'docs/workflow-narrator.md' },
      { path: 'developers/machine-spec/', title: 'Machine spec', description: 'An English requirement, checked: states, events, transitions and typed functions, each traced to its sentence.', file: 'docs/machine-spec.md', source: 'docs/machine-spec.md' },
      { path: 'developers/building-blocks/', title: 'Building blocks', description: 'The inventory of reusable deterministic modules.', file: 'docs/capabilities.md', source: 'docs/capabilities.md' },
    ],
  },
  {
    group: 'Reference',
    pages: [
      { path: 'developers/cli-reference/', title: 'CLI reference', description: 'Every command and flag, generated from the CLI itself.', generate: 'cli', source: 'packages/core/usage.mjs' },
      { path: 'developers/rules-reference/', title: 'Rule reference', description: 'Every rule id and its default severity, generated from the config.', generate: 'rules', source: 'packages/core/config.mjs' },
    ],
  },
  {
    group: 'Contribute',
    pages: [
      { path: 'developers/extending/', title: 'Extending Construct', description: 'Add a rule, a layer template, an LLM provider or a command.', file: C('developers/extending.md') },
      { path: 'developers/testing/', title: 'Testing', description: 'Run the core, backend, browser and site tests.', file: C('developers/testing.md') },
      { path: 'developers/contributing/', title: 'Contributing', description: 'Set up, what makes a good change, and how to send one.', file: C('developers/contributing.md') },
    ],
  },
];

export const USER_INDEX = { path: 'user-guide/', title: 'User Guide', description: 'The whole family in one place: the framework, the app you work in, and the command line.', file: C('user/index.md') };
export const DEV_INDEX = { path: 'developers/', title: 'Developer Docs', description: 'Architecture, references and extension points for people building on or contributing to Construct.', file: C('developers/index.md') };

/** Markdown for the pages derived from code. Imports the real modules, so they are exact by construction. */
export async function generatedMarkdown(kind, repoRoot) {
  if (kind === 'cli') {
    const { USAGE } = await import(pathToFileURL(path.join(repoRoot, 'packages/core/usage.mjs')));
    const { EXIT_CODES } = await import(pathToFileURL(path.join(repoRoot, 'packages/core/diagnostics.mjs')));
    return [
      'This page is generated from the CLI\'s own usage text (`packages/core/usage.mjs`), which is exactly what `construct` prints with no arguments, so it always matches the installed version.',
      '',
      '## Usage text',
      '',
      '```text',
      USAGE.trim(),
      '```',
      '',
      '## Commands at a glance',
      '',
      '{{include README.md#Commands level=3 nohead}}',
      '',
      '## Exit codes',
      '',
      '| Code | Meaning |',
      '|---|---|',
      `| ${EXIT_CODES.OK} | Success (warnings do not fail a run) |`,
      `| ${EXIT_CODES.VIOLATIONS} | One or more error-level violations |`,
      `| ${EXIT_CODES.USAGE_ERROR} | Usage error: unknown command, missing or invalid arguments |`,
      `| ${EXIT_CODES.INTERNAL_ERROR} | Internal error, including a model reply that was rejected or a provider call that failed |`,
      '',
      '## Output conventions',
      '',
      'Every `create`, `refactor`, `research` and `import` action ends with one attribution line, `[tool: ...] [llm: ...]`, that states what was done and how many model calls were made. `validate --format json` and `research summarize --format json` print pure JSON that can be piped. `pipeline run` takes a Context Envelope on standard input; see [Context Envelope and pipeline](@developers/context-envelope/).',
    ].join('\n');
  }
  if (kind === 'rules') {
    const { DEFAULT_RULES } = await import(pathToFileURL(path.join(repoRoot, 'packages/core/config.mjs')));
    const rows = Object.entries(DEFAULT_RULES).map(([id, r]) => `| \`${id}\` | ${r.severity ? '`' + r.severity + '`' : (r.numeric ? 'number' : '')} | ${String(r.name).replace(/\|/g, '\\|').replace(/</g, '&lt;').replace(/>/g, '&gt;')} |`);
    return [
      'This table is generated from `DEFAULT_RULES` in `packages/core/config.mjs`, the same map `construct validate` reads, so it is always current. Override any severity in `architecture.yml`:',
      '',
      '```yaml',
      'rules:',
      '  PAGE-004: warning',
      '  PURE-001: off',
      '```',
      '',
      'Severity is `error` (validation fails), `warning` (reported only) or `off`. Entries marked `number` are threshold overrides rather than rules. A rule can also take an object with extra options, for example `PAGE-007: { severity: error, similarity: 0.9 }`.',
      '',
      '## All rules',
      '',
      '| Rule | Default | What it enforces |',
      '|---|---|---|',
      ...rows,
      '',
      'To add a rule, see [Extending Construct](@developers/extending/).',
    ].join('\n');
  }
  throw new Error(`unknown generated page "${kind}"`);
}
