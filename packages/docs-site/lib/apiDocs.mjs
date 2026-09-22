// API reference generator: TypeDoc (Apache-2.0) + typedoc-plugin-markdown (MIT) over our real sources, one
// TypeDoc run per package, markdown out. Nothing here is committed: build.mjs runs it at site build time and
// renders the markdown into the site, so `/<X.Y>/` and `/next/` each carry the API of the ref they were built from.
// Choice and rejected alternatives: docs/API-DOCS.md. Deterministic; no LLM.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describeSource } from '../../src/engine/describeDocgen.mjs';
import { stripTicketRefs } from './markdown.mjs';

/** Same grouping the Trinity Modules tab uses. `dirs` are repo-relative; `recursive` walks subfolders. */
export const API_PACKAGES = [
  { id: 'core', title: 'Core engine', description: 'The deterministic CLI blocks: config, generators, validator, planner, LLM providers.', dirs: [{ dir: 'packages/core', recursive: false }], exts: ['.mjs'], tsconfig: 'tsconfig.json' },
  { id: 'engine', title: 'Engine', description: 'Pipeline, Context Envelope, processes, impact analysis, workflow narrator, test generator.', dirs: [{ dir: 'packages/engine', recursive: true }], exts: ['.mjs'], tsconfig: 'tsconfig.json' },
  { id: 'ast', title: 'AST', description: 'Parse, walk, extract and edit TypeScript and JSX.', dirs: [{ dir: 'packages/ast', recursive: false }], exts: ['.mjs'], tsconfig: 'tsconfig.json' },
  { id: 'cockpit-server', title: 'Cockpit server', description: 'The Express backend of the Cockpit: routes, jobs, auth, workspace containment.', dirs: [{ dir: 'ui/server/src', recursive: true }], exts: ['.mjs'], tsconfig: 'tsconfig.json' },
  { id: 'cockpit-client-shared', title: 'Cockpit client (shared)', description: 'Shared components and helpers of the Cockpit UI.', dirs: [{ dir: 'ui/client/components', recursive: true }, { dir: 'ui/client/lib', recursive: true }], exts: ['.ts', '.tsx', '.jsx'], tsconfig: 'ui/client/tsconfig.json' },
  { id: 'cockpit-client-features', title: 'Cockpit client (features)', description: 'One folder per Cockpit feature: domain, services, workflows, hooks, components, pages.', dirs: [{ dir: 'ui/client/features', recursive: true }], exts: ['.ts', '.tsx'], tsconfig: 'ui/client/tsconfig.json', groupDepth: 4 },
  { id: 'tools', title: 'Tools', description: 'Project-board sync and the GitHub comment bridge.', dirs: [{ dir: 'packages/tools', recursive: true }], exts: ['.mjs'], tsconfig: 'tsconfig.json' },
  { id: 'docs-site', title: 'Docs site', description: 'The static documentation site generator (this site).', dirs: [{ dir: 'packages/docs-site/lib', recursive: true }, { dir: 'site', recursive: false }], exts: ['.mjs'], tsconfig: 'tsconfig.json' },
];

const isTestOrNoise = (name) => /\.(test|spec|stories)\.[cm]?[jt]sx?$/.test(name) || name.endsWith('.d.ts');
const hasExport = (file) => /^\s*export\s/m.test(fs.readFileSync(file, 'utf8'));

/** Repo-relative, sorted source files of a package that export something. */
export function collectEntryPoints(pkg, repoRoot) {
  const out = [];
  const walk = (dir, recursive, skip) => {
    const abs = path.join(repoRoot, dir);
    if (!fs.existsSync(abs)) return;
    for (const e of fs.readdirSync(abs, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const rel = path.posix.join(dir, e.name);
      if (e.isDirectory()) {
        if (recursive && e.name !== 'node_modules' && !e.name.startsWith('.') && e.name !== '__tests__' && !(skip || []).includes(e.name)) walk(rel, recursive, skip);
      } else if (pkg.exts.includes(path.extname(e.name)) && !isTestOrNoise(e.name) && hasExport(path.join(repoRoot, rel))) out.push(rel);
    }
  };
  for (const d of pkg.dirs) walk(d.dir, d.recursive, d.skip);
  return out;
}

/** First sentence of the leading `//` or block comment of a source file, as a fallback module summary. */
export function headerSummary(source) {
  const lines = source.replace(/^#!.*\n/, '').split('\n');
  const text = [];
  let block = false;
  for (const raw of lines) {
    const l = raw.trim();
    if (!text.length && !block && l === '') continue;
    if (block) {
      if (l.includes('*/')) break;
      text.push(l.replace(/^\*\s?/, ''));
    } else if (l.startsWith('/*')) {
      block = !l.includes('*/');
      text.push(l.replace(/^\/\*+\s?/, '').replace(/\*\/.*$/, ''));
      if (!block) break;
    } else if (l.startsWith('//')) text.push(l.replace(/^\/\/+\s?/, ''));
    else break;
  }
  const para = [];
  for (const t of text) {
    if (!t.trim()) {
      if (para.length) break;
      continue;
    }
    para.push(t.trim());
  }
  // Many header comments in this codebase open with their own ticket ref ("#292 — REST surface for...",
  // "#289 / #332 — ...", "#312/#313 -- ..."), which stripTicketRefs (below) does not catch — its own patterns all
  // need a space, parenthesis or "issue/ticket/PR" before the "#", none of which a *leading* ref has.
  const noLeadingRef = para.join(' ').replace(/^@module\b\s*/, '').replace(/^#\d+(?:\s*[/,]\s*#\d+)*[.:]?\s*[-–—]{0,2}\s*/, '');
  const joined = stripTicketRefs(noLeadingRef).replace(/\s+/g, ' ').trim();
  const m = /^(.*?[.!?])(\s|$)/.exec(joined);
  const first = (m ? m[1] : joined).trim();
  return first.length > 220 ? first.slice(0, 217).trimEnd() + '...' : first;
}

/** Folder a module is listed under on its package page (its directory, or the first `groupDepth` segments of it). */
export const groupOf = (pkg, name) => {
  const dir = name.split('/').slice(0, -1);
  return (pkg.groupDepth ? dir.slice(0, pkg.groupDepth) : dir).join('/') || '.';
};

/** The exports of a rendered TypeDoc module page: `### name()` headings and their kind (the `## Kind` above). */
export function exportsOf(md) {
  const list = [];
  let kind = '';
  for (const line of md.split('\n')) {
    const k = /^## (.+)$/.exec(line);
    if (k) kind = k[1];
    const e = /^### (.+?)(\(\))?$/.exec(line);
    if (e && kind) list.push({ name: e[1].replace(/\\/g, ''), kind });
  }
  return list;
}

const REACT_SOURCE = /\.(tsx|jsx)$/;

/** One module's react-docgen prop table(s) as a markdown fragment, or '' when the source has no component (a
 * hook, a helper). `name` labels the sub-heading only when the file exports more than one component. */
function propsTableMarkdown(components) {
  const table = (props) => {
    if (!props.length) return '_No documented props._';
    const rows = props.map((p) => `| \`${p.name}\` | \`${p.type}\` | ${p.required ? 'Yes' : 'No'} | ${p.default != null ? `\`${p.default}\`` : '—'} | ${(p.description || '').replace(/\|/g, '\\|')} |`);
    return ['| Prop | Type | Required | Default | Description |', '|---|---|---|---|---|', ...rows].join('\n');
  };
  return components.map((c) => `#### Props${components.length > 1 ? `: ${c.name}` : ''}\n\n${table(c.props)}`).join('\n\n');
}

// TypeDoc renders a destructured props parameter as an opaque `__namedParameters` type with no description; for a
// module with exactly one function export we replace that block with a real prop table from react-docgen (the
// same block `describeComponent`/componentsApi.mjs uses for the Cockpit's own Components screen), read straight
// from the source text (no project code is ever evaluated). A module with more than one export, or no discovered
// component (a hook file), is left as TypeDoc rendered it.
const PARAMETERS_BLOCK = /\n#### Parameters\n\n[\s\S]*?(?=\n#### |\n$|$)/;

/** Replace (or append) a `.tsx`/`.jsx` module's TypeDoc markdown with a real react-docgen prop table. */
export function withPropsTable(md, sourceAbs, sourceRel, exportCount) {
  if (!sourceRel || !REACT_SOURCE.test(sourceRel) || exportCount !== 1) return md;
  let described;
  try {
    described = describeSource(fs.readFileSync(sourceAbs, 'utf8'), path.basename(sourceRel));
  } catch {
    return md;
  }
  if (!described.ok || !described.components.length) return md;
  const section = propsTableMarkdown(described.components);
  return PARAMETERS_BLOCK.test(md) ? md.replace(PARAMETERS_BLOCK, `\n${section}`) : `${md}\n\n${section}`;
}

/**
 * Run TypeDoc for each package into `outDir/<id>/` (markdown, one file per source module).
 * Returns [{ pkg, modules: [{ name, slug, file, md, source, summary, exports }], warnings }].
 */
export function generateApiMarkdown({ repoRoot, repoUrl, outDir, packages = API_PACKAGES, version, log = () => {} }) {
  const typedoc = path.join(repoRoot, 'node_modules', 'typedoc', 'bin', 'typedoc');
  if (!fs.existsSync(typedoc)) throw new Error('typedoc is not installed: run `npm ci` at the repo root');
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-apidocs-'));
  const results = [];
  try {
    for (const pkg of packages) {
      const entries = collectEntryPoints(pkg, repoRoot);
      if (!entries.length) continue;
      const out = path.join(outDir, pkg.id);
      fs.rmSync(out, { recursive: true, force: true });
      // A per-package tsconfig that extends the real one but lists exactly these files, so packages outside the
      // root tsconfig's `include` (server, client, tools, site) are still part of the program.
      const tsconfig = path.join(work, `${pkg.id}.tsconfig.json`);
      fs.writeFileSync(tsconfig, JSON.stringify({ extends: path.join(repoRoot, pkg.tsconfig), compilerOptions: { allowJs: true, noEmit: true, incremental: false }, files: entries.map((e) => path.join(repoRoot, e)), include: [], exclude: [] }));
      const options = {
        entryPoints: entries.map((e) => path.join(repoRoot, e)),
        tsconfig,
        plugin: ['typedoc-plugin-markdown'],
        out,
        readme: 'none',
        outputFileStrategy: 'modules',
        hidePageHeader: true,
        hideBreadcrumbs: true,
        excludeExternals: true,
        skipErrorChecking: true,
        disableGit: true,
        basePath: repoRoot,
        sourceLinkTemplate: `${repoUrl}/blob/main/{path}#L{line}`,
        name: pkg.title,
        logLevel: 'Error',
        validation: { notExported: false, invalidLink: false, notDocumented: false },
      };
      const optFile = path.join(work, `${pkg.id}.json`);
      fs.writeFileSync(optFile, JSON.stringify(options));
      const t0 = Date.now();
      const r = spawnSync(process.execPath, ['--max-old-space-size=2048', typedoc, '--options', optFile], { cwd: repoRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
      if (r.status !== 0) throw new Error(`typedoc failed for ${pkg.id}: ${(r.stderr || r.stdout || r.error || '').toString().slice(0, 2000)}`);
      log(`  api ${pkg.id}: ${entries.length} modules in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
      const modules = [];
      const walk = (dir) => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
          const p = path.join(dir, e.name);
          if (e.isDirectory()) walk(p);
          else if (e.name.endsWith('.md') && e.name !== 'README.md') {
            const rel = path.relative(out, p).split(path.sep).join('/');
            const name = rel.replace(/\.md$/, '');
            let md = fs.readFileSync(p, 'utf8');
            const source = entries.find((s) => s.replace(/\.[cm]?[jt]sx?$/, '') === name) || '';
            const summary = source ? headerSummary(fs.readFileSync(path.join(repoRoot, source), 'utf8')) : '';
            const exports = exportsOf(md);
            if (source) md = withPropsTable(md, path.join(repoRoot, source), source, exports.length);
            modules.push({ name, slug: name, group: groupOf(pkg, name), file: rel, md, source, summary, exports });
          }
        }
      };
      walk(out);
      results.push({ pkg, modules, entries: entries.length });
    }
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
  return results;
}
