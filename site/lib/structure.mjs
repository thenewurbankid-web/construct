// The documentation site's table of contents: which pages exist, their titles, and where their content comes from.
// `file` pages read a markdown file from the repository (authored under site/content, or reused docs).
// `generate` pages derive their markdown from the code itself so they cannot drift.
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const C = (name) => `site/content/${name}`;

/** Reused repository docs are wrapped in a one-line include so the same machinery handles them all. */
const E = (name) => C(`user/examples/${name}.md`);

export const USER_GROUPS = [
  {
    group: 'Start',
    pages: [
      { path: 'user-guide/getting-started/', title: 'Getting started', description: 'Try it in 60 seconds, then see what just happened.', file: C('user/getting-started.md') },
      { path: 'user-guide/concepts/', title: 'The five ideas', description: 'Tools, features, parts, rules and records, one sentence each.', file: C('user/concepts.md') },
      { path: 'user-guide/cockpit/', title: 'Using the Cockpit', description: 'The browser screen: what each part does and how to start it.', file: C('user/cockpit.md') },
    ],
  },
  {
    group: 'Examples: CLI',
    pages: [
      { path: 'user-guide/examples/cli-scaffold-and-validate/', title: 'Scaffold, then catch a rule break', description: 'A fetch() in a page: the exact commands and the exact output.', file: E('cli-scaffold-and-validate') },
      { path: 'user-guide/examples/cli-impact-and-review/', title: 'What a change touches, and branch review', description: 'What a change reaches, and what a branch means, without a model.', file: E('cli-impact-and-review') },
      { path: 'user-guide/examples/cli-flows-and-tests/', title: 'Every route through a flow, tested', description: 'Explain a state machine and generate one locked test per route.', file: E('cli-flows-and-tests') },
    ],
  },
  {
    group: 'Examples: Cockpit',
    pages: [
      { path: 'user-guide/examples/cockpit-plan-and-run/', title: 'Plan, run in a branch, approve per file', description: 'From a described change to a reviewed plan to changes you approve one file at a time.', file: E('cockpit-plan-and-run') },
      { path: 'user-guide/examples/cockpit-review/', title: 'Review a branch by what it means', description: 'Five deterministic indicators, mechanical fixes apart from decisions.', file: E('cockpit-review') },
      { path: 'user-guide/examples/cockpit-tests/', title: 'Tests: coverage, clone, step editor', description: 'Locked generated tests, cloning, and editing a test as steps.', file: E('cockpit-tests') },
      { path: 'user-guide/examples/cockpit-sign-in-and-commits/', title: 'Sign-in allowlist and commit on save', description: 'GitHub login for named accounts only; every save becomes a commit.', file: E('cockpit-sign-in-and-commits') },
    ],
  },
  {
    group: 'Examples: Core',
    pages: [
      { path: 'user-guide/examples/core-plans-and-impact/', title: 'Plans and impact as an API', description: 'Validate a plan and work out what a change touches, from JavaScript.', file: E('core-plans-and-impact') },
      { path: 'user-guide/examples/core-review-tests-commits/', title: 'Review, tests and commit messages as an API', description: 'The functions the CLI and the Cockpit both call.', file: E('core-review-tests-commits') },
    ],
  },
  {
    group: 'How-to',
    index: { path: 'user-guide/how-to/', title: 'How-to guides', description: 'Task-based guides for everyday work.', file: C('user/how-to-index.md') },
    pages: [
      { path: 'user-guide/how-to/create/', title: 'Create features and files', description: 'Scaffold in the right place, in the right order.', file: C('user/create.md') },
      { path: 'user-guide/how-to/tune-rules/', title: 'Validate and tune the rules', description: 'Severity, options and time-boxed exceptions in architecture.yml.', file: C('user/tune-rules.md') },
      { path: 'user-guide/how-to/refactor/', title: 'Move and rename safely', description: 'Relocate a file and fix every import mechanically.', file: C('user/refactor.md') },
      { path: 'user-guide/how-to/import/', title: 'Import an existing app', description: 'Bring existing pages across, one file, one route or one plan at a time.', file: C('user/import.md') },
      { path: 'user-guide/how-to/explain-workflows/', title: 'Explain workflows in English', description: 'Turn state machines into readable steps and test scenarios.', file: C('user/explain-workflows.md') },
      { path: 'user-guide/how-to/frozen-ui/', title: 'Wrap design-tool output', description: 'Use Subframe or Figma-to-code output without forking it.', file: C('user/frozen-ui.md') },
      { path: 'user-guide/how-to/use-an-llm/', title: 'Using an AI model, optionally', description: 'When a model is involved, how to choose one, and how output is checked.', file: C('user/use-an-llm.md') },
    ],
  },
];

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
      { path: 'developers/ast/', title: 'The AST package', description: 'Parse, walk, extract and generate TypeScript and JSX.', file: 'src/ast/README.md', source: 'src/ast/README.md' },
      { path: 'developers/workflows/', title: 'Workflow narrator', description: 'State machines to plain English, scenarios and health checks.', file: 'docs/workflow-narrator.md', source: 'docs/workflow-narrator.md' },
      { path: 'developers/building-blocks/', title: 'Building blocks', description: 'The inventory of reusable deterministic modules.', file: 'docs/capabilities.md', source: 'docs/capabilities.md' },
    ],
  },
  {
    group: 'Reference',
    pages: [
      { path: 'developers/cli-reference/', title: 'CLI reference', description: 'Every command and flag, generated from the CLI itself.', generate: 'cli', source: 'src/usage.mjs' },
      { path: 'developers/rules-reference/', title: 'Rule reference', description: 'Every rule id and its default severity, generated from the config.', generate: 'rules', source: 'src/config.mjs' },
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

export const USER_INDEX = { path: 'user-guide/', title: 'User Guide', description: 'Everything you need to use Construct from the command line or the Cockpit.', file: C('user/index.md') };
export const DEV_INDEX = { path: 'developers/', title: 'Developer Docs', description: 'Architecture, references and extension points for people building on or contributing to Construct.', file: C('developers/index.md') };
export const EXAMPLES_INDEX = { path: 'user-guide/examples/', title: 'Examples', description: 'Each one: the problem, the exact command or screen, the exact result. CLI, Cockpit and core are kept apart.', file: C('user/examples-index.md') };

/** Markdown for the pages derived from code. Imports the real modules, so they are exact by construction. */
export async function generatedMarkdown(kind, repoRoot) {
  if (kind === 'cli') {
    const { USAGE } = await import(pathToFileURL(path.join(repoRoot, 'src/usage.mjs')));
    const { EXIT_CODES } = await import(pathToFileURL(path.join(repoRoot, 'src/diagnostics.mjs')));
    return [
      'This page is generated from the CLI\'s own usage text (`src/usage.mjs`), which is exactly what `construct` prints with no arguments, so it always matches the installed version.',
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
    const { DEFAULT_RULES } = await import(pathToFileURL(path.join(repoRoot, 'src/config.mjs')));
    const rows = Object.entries(DEFAULT_RULES).map(([id, r]) => `| \`${id}\` | ${r.severity ? '`' + r.severity + '`' : (r.numeric ? 'number' : '')} | ${String(r.name).replace(/\|/g, '\\|')} |`);
    return [
      'This table is generated from `DEFAULT_RULES` in `src/config.mjs`, the same map `construct validate` reads, so it is always current. Override any severity in `architecture.yml`:',
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
