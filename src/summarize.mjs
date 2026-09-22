// Summarization output for humans and AI agents (Epic 3.3), built on src/parser.mjs.
// Pure functions only — no CLI argument parsing here. Wiring these into
// `construct summarize` is left to whoever owns src/cli.mjs.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { summarizeFeature, extractExports } from './parser.mjs';
import { loadConfig } from './config.mjs';
import { describeImplementation } from './prose.mjs';
import { docsPathFor } from './docsPackages.mjs';

function featureRootOf(root) {
  return loadConfig(root).features.root;
}

/** "View docs: developers/api/<pkg>/" for a feature, when `root` is a checkout of Construct's own repository
 * and this feature's directory falls under one of its documented packages (docs/API-DOCS.md) — null for an
 * ordinary target project, every time, which is the common case and the safe default. */
function docsLineFor(root, featureName) {
  const p = docsPathFor(root, path.join(root, featureRootOf(root), featureName));
  return p ? `View docs: ${p}` : null;
}

function listFeatureNames(root, only) {
  const dir = path.join(root, featureRootOf(root));
  if (!fs.existsSync(dir)) return [];
  const names = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
  return only ? names.filter((n) => n === only) : names;
}

function getFeatureSummaries(root, only) {
  return listFeatureNames(root, only).map((name) => summarizeFeature(root, name));
}

function renderMarkdown(summaries, root) {
  const lines = ['# Construct Project Summary', ''];
  for (const f of summaries) {
    lines.push(`## Feature: ${f.feature}`, '');
    lines.push('### Public API', '');
    lines.push(f.publicApi.length ? f.publicApi.map((n) => `- \`${n}\``).join('\n') : '_none_', '');
    lines.push('### Layers', '');
    const layerEntries = Object.entries(f.layers);
    lines.push(
      layerEntries.length
        ? layerEntries.map(([layer, files]) => `- ${layer}: ${files.length} file${files.length === 1 ? '' : 's'}`).join('\n')
        : '_no classified files_',
      ''
    );
    lines.push(`### Total LOC: ${f.loc}`, '');
    const docsLine = docsLineFor(root, f.feature);
    if (docsLine) lines.push(`### API reference`, '', docsLine, '');
  }
  return lines.join('\n');
}

/**
 * 'json' -> JSON.stringify of the per-feature Summary roll-ups from Epic 3.1.
 * 'md' -> a human Markdown doc, one section per feature.
 *
 * @returns {string} JSON text (`json`) or a Markdown document (`md`).
 * @param {string} root
 * @param {{feature?: string, format?: 'json'|'md'}} [opts]
 */
export function summarizeProject(root, { feature, format = 'json' } = {}) {
  const summaries = getFeatureSummaries(root, feature);
  if (format === 'md') return renderMarkdown(summaries, root);
  return JSON.stringify(summaries);
}

function cleanJsdoc(block) {
  const text = block
    .replace(/^\/\*\*/, '')
    .replace(/\*\/$/, '')
    .split('\n')
    .map((l) => l.replace(/^\s*\*\s?/, ''))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > 140 ? text.slice(0, 137) + '...' : text;
}

function compactParagraph(f, root) {
  const layerEntries = Object.entries(f.layers);
  const layerCounts = layerEntries.map(([layer, files]) => `${files.length} ${layer}${files.length === 1 ? '' : 's'}`).join(', ');
  const jsdocs = layerEntries
    .flatMap(([, files]) => files)
    .map((s) => s.jsdoc)
    .filter(Boolean)
    .map(cleanJsdoc);
  const publicApiStr = f.publicApi.length ? f.publicApi.join(', ') : 'none';
  const notes = jsdocs.length ? ` Notes: ${jsdocs.slice(0, 3).join(' ')}` : '';
  const docsLine = docsLineFor(root, f.feature);
  return `Feature "${f.feature}" — ${f.loc} LOC across ${layerCounts || 'no classified files'}. Public API: ${publicApiStr}.${notes}${docsLine ? ` ${docsLine}` : ''}`;
}

/**
 * Token-budget-conscious plain-text summary for pasting into an AI agent's context
 * instead of raw file reads: one short paragraph per feature, no filler.
 *
 * @returns {string} One short paragraph per feature, or `No features found.`
 * @param {string} root
 * @param {{feature?: string}} [opts]
 */
export function summarizeCompact(root, { feature } = {}) {
  const summaries = getFeatureSummaries(root, feature);
  if (!summaries.length) return 'No features found.';
  return summaries.map((f) => compactParagraph(f, root)).join('\n\n');
}

// ---------------------------------------------------------------------------
// Prose generation — deterministic, template-based English descriptions.
// No LLM, no external call: every sentence is built from facts the parser
// already extracted (layer, export name, import specifiers) plus JSDoc when
// present. Comments are a bonus, never a requirement — every function gets a
// readable sentence purely from its name and where it lives, which is also
// why naming and layer placement matter (an unnamed/misplaced function loses
// the only signal this generator has to work with).
// ---------------------------------------------------------------------------

const LAYER_FOLDER_TO_NAME = {
  controllers: 'controller',
  workflows: 'workflow',
  hooks: 'hook',
  domain: 'domain module',
  services: 'service',
  pages: 'page',
  components: 'component',
};

/** Turn an import specifier into a short, human-readable phrase: a sibling
 * layer file ("the Login domain module") or an external package ("the
 * \"react\" package"). Purely string-based — no module resolution. */
function describeImport(specifier) {
  const m = specifier.match(/\/(controllers|workflows|hooks|domain|services|pages|components)\/([^/]+)$/);
  if (m) {
    const base = m[2].replace(/\.(tsx?|jsx?)$/, '');
    return `the ${base} ${LAYER_FOLDER_TO_NAME[m[1]]}`;
  }
  return `the "${specifier}" package`;
}

function joinEnglishList(items) {
  if (items.length <= 1) return items[0] || '';
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}

// One structural template per layer, describing what a function there is
// FOR — never what it literally does line-by-line, since that's exactly the
// kind of detail regex-based parsing can't reliably read out of arbitrary code.
const LAYER_TEMPLATES = {
  domain: (name, deps) =>
    `\`${name}\` is a pure domain function: no network, storage, or DOM access, so it can be reasoned about and tested in isolation${deps ? `, built on ${deps}` : ''}.`,
  service: (name, deps) =>
    `\`${name}\` is a service function, meaning it owns an external effect (network or browser storage) on behalf of the feature${deps ? `, relying on ${deps}` : ''}.`,
  workflow: (name, deps) =>
    `\`${name}\` defines the feature's application flow as a state machine, coordinating its steps with no React or UI code of its own${deps ? `, using ${deps}` : ''}.`,
  hook: (name, deps) =>
    `\`${name}\` is a React hook exposing this feature's behavior to components${deps ? `, built on ${deps}` : ''}.`,
  controller: (name, deps) =>
    `\`${name}\` is the controller that composes this feature's page with its hook/workflow for the route to render${deps ? `, drawing on ${deps}` : ''}.`,
  page: (name, deps) =>
    `\`${name}\` renders presentation for this feature from props alone, with no business logic of its own${deps ? `, composing ${deps}` : ''}.`,
  component: (name, deps) =>
    `\`${name}\` is a presentation-only component: it renders purely from the props it receives${deps ? `, alongside ${deps}` : ''}.`,
};

/** Scan `source` starting at `startIndex` (the start of an `export ...`
 * statement, as returned by extractExports) and return the exact source
 * text of that whole declaration — the real implementation, not a
 * description of it. `function`/`class` declarations end at their matching
 * closing brace (no trailing semicolon required); everything else
 * (`const`/`let`/`var`/`export default <expr>`/`export * from ...`) ends at
 * its first top-level `;`. Tracks string/template-literal and comment
 * content so semicolons or braces inside them are never mistaken for
 * statement structure. Best-effort text scanning, not a real parser — see
 * src/parser.mjs's module comment for the same tradeoff applied elsewhere. */
export function extractDeclarationSource(source, startIndex) {
  const isBraceTerminated = /^(export\s+)?(default\s+)?(async\s+)?(function\b|class\b)/.test(source.slice(startIndex));
  let depth = 0;
  let inString = null;
  let i = startIndex;
  for (; i < source.length; i++) {
    const ch = source[i];
    if (inString) {
      if (ch === '\\') { i++; continue; }
      if (ch === inString) inString = null;
      continue;
    }
    if (ch === '/' && source[i + 1] === '/') {
      const nl = source.indexOf('\n', i);
      i = nl === -1 ? source.length : nl;
      continue;
    }
    if (ch === '/' && source[i + 1] === '*') {
      const end = source.indexOf('*/', i + 2);
      i = end === -1 ? source.length - 1 : end + 1;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { inString = ch; continue; }
    if (ch === '{' || ch === '(' || ch === '[') { depth++; continue; }
    if (ch === '}' || ch === ')' || ch === ']') {
      depth--;
      if (isBraceTerminated && ch === '}' && depth === 0) { i++; break; }
      continue;
    }
    if (ch === ';' && !isBraceTerminated && depth <= 0) { i++; break; }
  }
  return source.slice(startIndex, Math.min(i, source.length)).trimEnd();
}

/** The literal implementation source for one export of a file — read fresh
 * from disk (Summary objects don't retain full source text), located by
 * re-running extractExports and matching on name. Returns null if the file
 * is gone or the export can no longer be found (best-effort, never throws). */
function getImplementationSource(root, filePath, name) {
  const abs = path.isAbsolute(filePath) ? filePath : path.join(root, filePath);
  let source;
  try {
    source = fs.readFileSync(abs, 'utf8');
  } catch {
    return null;
  }
  const entry = extractExports(source).find((e) => e.name === name);
  return entry ? extractDeclarationSource(source, entry.index) : null;
}

/** One readable sentence for a single exported name. Uses the file's JSDoc
 * verbatim when it unambiguously belongs to this export (the file has
 * exactly one export); otherwise falls back to the layer template built
 * from the export's name and its sibling-layer/package dependencies. */
export function describeExport(summary, name) {
  if (summary.jsdoc && summary.exports.length === 1) {
    return `\`${name}\` — ${cleanJsdoc(summary.jsdoc)}`;
  }
  const template = LAYER_TEMPLATES[summary.layer];
  if (!template) return `\`${name}\` is exported from the feature's public API (${summary.path}).`;
  const deps = joinEnglishList(summary.imports.map(describeImport));
  return template(name, deps);
}

const LAYER_ORDER = ['domain', 'service', 'workflow', 'hook', 'component', 'page', 'controller'];

/**
 * Deterministic, template-based English paragraph(s): one sentence per
 * exported function plus an opening/closing sentence for the feature as a
 * whole. No LLM call — every sentence is derived from parsed structure
 * (layer, name, imports), with JSDoc used verbatim only when it maps
 * unambiguously to a single export.
 *
 * @returns {string} English paragraph(s) per feature, or `No features found.`
 * @param {string} root
 * @param {{feature?: string}} [opts]
 */
export function summarizeProse(root, { feature } = {}) {
  const summaries = getFeatureSummaries(root, feature);
  if (!summaries.length) return 'No features found.';

  return summaries
    .map((f) => {
      const layerEntries = LAYER_ORDER.map((layer) => [layer, f.layers[layer] || []]).filter(([, files]) => files.length);
      const opening = `The "${f.feature}" feature is ${f.loc} lines of code across ${layerEntries.length} layer${layerEntries.length === 1 ? '' : 's'}.`;

      const sections = layerEntries.map(([layer, files]) => {
        const heading = layer[0].toUpperCase() + layer.slice(1);
        const bullets = [];
        for (const s of files) {
          for (const name of s.exports) {
            const code = getImplementationSource(root, s.path, name);
            const prose = code ? describeImplementation(code) : '(implementation not found)';
            bullets.push(`  - \`${name}\` (${s.path}): ${prose}`);
          }
        }
        return `${heading}:\n${bullets.join('\n')}`;
      });

      const closing = f.publicApi.length
        ? `Outside the feature, only ${joinEnglishList(f.publicApi.map((p) => `\`${p}\``))} ${f.publicApi.length === 1 ? 'is' : 'are'} reachable, via its index.ts.`
        : `This feature exposes nothing through its index.ts yet.`;

      const docsLine = docsLineFor(root, f.feature);
      return [opening, ...sections, closing, ...(docsLine ? [docsLine] : [])].join('\n\n');
    })
    .join('\n\n' + '='.repeat(60) + '\n\n');
}

/**
 * Best-effort diff-aware summary: `git diff --name-only <sinceRef>` to find changed files,
 * mapped to their feature, then only those features are summarized (via summarizeProject/
 * summarizeCompact — rendering is never reimplemented here). Reports gracefully, rather than
 * throwing, when `root` is not a git repo or `sinceRef` does not exist.
 *
 * @returns {string} The summary of features changed since `sinceRef`, or a plain message when git or the ref is unavailable.
 * @param {string} root
 * @param {string} sinceRef
 * @param {{format?: 'json'|'md'|'compact'|'prose'}} [opts]
 */
export function summarizeSince(root, sinceRef, { format = 'compact' } = {}) {
  let changed;
  try {
    // #413: bounded; execFileSync throws ETIMEDOUT, which the catch below reports like any other failure.
    const out = execFileSync('git', ['diff', '--name-only', sinceRef], { cwd: root, encoding: 'utf8', timeout: 10 * 60 * 1000, killSignal: 'SIGKILL' });
    changed = out.split('\n').map((l) => l.trim()).filter(Boolean);
  } catch (err) {
    const reason = String(err.message || err).split('\n')[0];
    return `Could not compute a diff against "${sinceRef}": ${reason}. Is ${root} a git repository, and does that ref exist?`;
  }

  const featureRoot = featureRootOf(root);
  const changedFeatures = new Set();
  const escapedRoot = featureRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const featureFilePattern = new RegExp(`^${escapedRoot}/([^/]+)/`);
  for (const file of changed) {
    const m = file.match(featureFilePattern);
    if (m) changedFeatures.add(m[1]);
  }

  if (!changedFeatures.size) return `No changed features found since ${sinceRef}.`;

  const renderer = format === 'md' || format === 'json' ? summarizeProject : format === 'prose' ? summarizeProse : summarizeCompact;
  const renderFormat = format === 'md' ? 'md' : format === 'json' ? 'json' : undefined;
  return [...changedFeatures].map((f) => renderer(root, { feature: f, ...(renderFormat ? { format: renderFormat } : {}) })).join('\n\n');
}
