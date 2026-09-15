import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createFeature, generateLayer } from './generators.mjs';
import { write, ensureDir } from './fs.mjs';
import { loadConfig, findProjectRoot, DEFAULT_RULES } from './config.mjs';
import { formatReport, exitCodeForViolations, ConstructError, EXIT_CODES } from './diagnostics.mjs';
import { aggregateValidation } from './registry.mjs';
import { validateArchitecture } from './architecture-enforcer.mjs';
import { validateSeparationOfConcerns } from './soc-enforcer.mjs';
import { validateReadability } from './readability-enforcer.mjs';
import { syncPublicApi, checkPublicApiDrift } from './api-composer.mjs';
import { summarizeProject, summarizeCompact, summarizeProse, summarizeSince } from './summarize.mjs';

// Resolve the project root freshly per command: walks up from cwd to find an
// existing architecture.yml (monorepo support), falling back to cwd itself
// (e.g. for `construct init`, or a project that hasn't been synced yet).
function getRoot() {
  return findProjectRoot(process.cwd()) ?? process.cwd();
}

// The Construct package's own install directory (not the target project's
// cwd) — enforcer modules live alongside this file, not in the user's repo.
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Files that mark a module as "available" for construct doctor. These are
// existence checks only (never imports), so they report accurately even
// before the owning module has landed in the working tree.
const ENFORCER_MODULES = [
  { name: 'architecture-enforcer', file: 'src/architecture-enforcer.mjs' },
  { name: 'soc-enforcer', file: 'src/soc-enforcer.mjs' },
  { name: 'api-composer', file: 'src/api-composer.mjs' },
  { name: 'readability-enforcer', file: 'src/readability-enforcer.mjs' },
  { name: 'summarize', file: 'src/summarize.mjs' },
];

export async function init(args) {
  const dir = path.resolve(args[0] || '.');
  ensureDir(dir);
  const arch = `version: 1\npreset: strict-nextjs\n\nproject:\n  framework: nextjs\n  language: typescript\n\nfeatures:\n  root: features\n\nrules:\n${Object.entries(DEFAULT_RULES).map(([k, v]) => `  ${k}: ${v.severity}`).join('\n')}\n\nexceptions: []\n`;
  write(path.join(dir, 'architecture.yml'), arch);
  write(path.join(dir, 'AGENTS.md'), `# Construct\n\nRead architecture.yml before changing code.\n\nDefault flow: Route → Controller → Workflow → Service → API; Controller → Page → Component.\n\nPages: no business logic, workflows, services, API calls, or fetch.\nComponents: presentation/local UI state only.\nFeatures: isolated; cross-feature access goes through index.ts.\nDomain: pure by default. Services: external effects.\n\nRun \`construct validate\` before finishing changes.\n`);
  createFeature(dir, 'core');
  ensureDir(path.join(dir, 'app'));
  write(path.join(dir, 'app', 'page.tsx'), `import { CoreController } from '../features/core/controllers/CoreController';\n\nexport default function Page() {\n  return <CoreController />;\n}\n`);
  console.log(`Initialized Construct in ${dir}`);
}

export async function feature(args) {
  if (args[0] !== 'create' || !args[1]) {
    throw new ConstructError('Usage: construct feature create <name>', { exitCode: EXIT_CODES.USAGE_ERROR });
  }
  const root = getRoot();
  const p = createFeature(root, args[1]);
  console.log(`Created feature ${args[1]} at ${path.relative(root, p)}`);
}

export async function generate(args) {
  const layer = args[0], name = args[1], fi = args.indexOf('--feature');
  if (!layer || !name || fi < 0 || !args[fi + 1]) {
    throw new ConstructError('Usage: construct generate <layer> <name> --feature <feature>', { exitCode: EXIT_CODES.USAGE_ERROR });
  }
  const root = getRoot();
  console.log(`Created ${path.relative(root, generateLayer(root, layer, name, args[fi + 1]))}`);
}

function featureNames(root, config) {
  const dir = path.join(root, config.features.root || 'features');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
}

export async function sync(_args) {
  const root = getRoot();
  const c = loadConfig(root);
  write(path.join(root, '.dependency-cruiser.cjs'), `module.exports={forbidden:[{name:'page-to-workflow',from:{path:'features/.*/pages'},to:{path:'features/.*/workflows'},severity:'error'},{name:'page-to-service',from:{path:'features/.*/pages'},to:{path:'features/.*/services'},severity:'error'},{name:'component-to-app-logic',from:{path:'features/.*/components'},to:{path:'features/.*/(controllers|workflows|services|domain)'},severity:'error'}]};\n`);
  let apiSynced = 0;
  for (const name of featureNames(root, c)) {
    const { changed } = syncPublicApi(root, name);
    if (changed) apiSynced++;
  }
  console.log(`Synced ${Object.keys(c.rules).length} Construct rules, ${apiSynced} feature public API(s) updated.`);
}

const DEFAULT_ENFORCERS = [
  { name: 'architecture', validate: validateArchitecture },
  { name: 'separation-of-concerns', validate: validateSeparationOfConcerns },
  { name: 'readability', validate: validateReadability },
  { name: 'public-api-drift', validate: checkPublicApiDrift },
];

export async function validate(args) {
  const root = getRoot();
  const { violations, ok } = aggregateValidation(root, DEFAULT_ENFORCERS);
  const fi = args.indexOf('--format');
  const format = fi >= 0 && args[fi + 1] === 'json' ? 'json' : 'text';
  console.log(formatReport(violations, { format }));
  if (!ok) process.exitCode = exitCodeForViolations(violations);
}

export async function summarize(args) {
  const root = getRoot();
  const fi = args.indexOf('--feature');
  const feature = fi >= 0 ? args[fi + 1] : undefined;
  const ff = args.indexOf('--format');
  const format = ff >= 0 ? args[ff + 1] : 'json';
  const si = args.indexOf('--since');
  const output = si >= 0
    ? summarizeSince(root, args[si + 1], { format })
    : format === 'compact'
      ? summarizeCompact(root, { feature })
      : format === 'prose'
        ? summarizeProse(root, { feature })
        : summarizeProject(root, { feature, format });
  console.log(output);
}

export async function doctor(_args) {
  console.log('Construct doctor');
  const root = getRoot();
  for (const c of ['node', 'npm']) {
    const r = spawnSync(c, ['--version'], { encoding: 'utf8' });
    console.log(`${c}: ${r.status === 0 ? r.stdout.trim() : 'missing'}`);
  }
  console.log(`architecture.yml: ${fs.existsSync(path.join(root, 'architecture.yml')) ? 'present' : 'missing'}`);
  console.log('Enforcer modules:');
  for (const { name, file } of ENFORCER_MODULES) {
    const available = fs.existsSync(path.join(packageRoot, file));
    console.log(`  ${name}: ${available ? 'available' : 'not yet available'}`);
  }
}
