// Summarization output for humans and AI agents (Epic 3.3), built on src/parser.mjs.
// Pure functions only — no CLI argument parsing here. Wiring these into
// `construct summarize` is left to whoever owns src/cli.mjs.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { summarizeFeature, projectSettings } from './parser.mjs';

function featureRootOf(root) {
  return projectSettings(root).featureRoot;
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

function renderMarkdown(summaries) {
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
  }
  return lines.join('\n');
}

/** 'json' -> JSON.stringify of the per-feature Summary roll-ups from Epic 3.1.
 * 'md' -> a human Markdown doc, one section per feature.
 * @param {string} root
 * @param {{feature?: string, format?: 'json'|'md'}} [opts]
 */
export function summarizeProject(root, { feature, format = 'json' } = {}) {
  const summaries = getFeatureSummaries(root, feature);
  if (format === 'md') return renderMarkdown(summaries);
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

function compactParagraph(f) {
  const layerEntries = Object.entries(f.layers);
  const layerCounts = layerEntries.map(([layer, files]) => `${files.length} ${layer}${files.length === 1 ? '' : 's'}`).join(', ');
  const jsdocs = layerEntries
    .flatMap(([, files]) => files)
    .map((s) => s.jsdoc)
    .filter(Boolean)
    .map(cleanJsdoc);
  const publicApiStr = f.publicApi.length ? f.publicApi.join(', ') : 'none';
  const notes = jsdocs.length ? ` Notes: ${jsdocs.slice(0, 3).join(' ')}` : '';
  return `Feature "${f.feature}" — ${f.loc} LOC across ${layerCounts || 'no classified files'}. Public API: ${publicApiStr}.${notes}`;
}

/** Token-budget-conscious plain-text summary for pasting into an AI agent's context
 * instead of raw file reads: one short paragraph per feature, no filler.
 * @param {string} root
 * @param {{feature?: string}} [opts]
 */
export function summarizeCompact(root, { feature } = {}) {
  const summaries = getFeatureSummaries(root, feature);
  if (!summaries.length) return 'No features found.';
  return summaries.map(compactParagraph).join('\n\n');
}

/** Best-effort diff-aware summary: `git diff --name-only <sinceRef>` to find changed files,
 * mapped to their feature, then only those features are summarized (via summarizeProject/
 * summarizeCompact — rendering is never reimplemented here). Reports gracefully, rather than
 * throwing, when `root` is not a git repo or `sinceRef` does not exist.
 * @param {string} root
 * @param {string} sinceRef
 * @param {{format?: 'json'|'md'|'compact'}} [opts]
 */
export function summarizeSince(root, sinceRef, { format = 'compact' } = {}) {
  let changed;
  try {
    const out = execFileSync('git', ['diff', '--name-only', sinceRef], { cwd: root, encoding: 'utf8' });
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

  const renderer = format === 'md' || format === 'json' ? summarizeProject : summarizeCompact;
  const renderFormat = format === 'md' ? 'md' : format === 'json' ? 'json' : undefined;
  return [...changedFeatures].map((f) => renderer(root, { feature: f, ...(renderFormat ? { format: renderFormat } : {}) })).join('\n\n');
}
