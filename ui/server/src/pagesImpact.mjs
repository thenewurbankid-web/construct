// Inspector "Impact" section (#379, design 8.2): "if I change this file, which other features are
// reached" — the same deterministic blast-radius block componentUsedBy (#380) already seeds with one
// file (packages/engine/impact.mjs), scoped here to a page file via resolvePageFile's own containment
// guard. Never fails the request — impact is a bonus, like componentUsedBy.
import { analyzeImpact } from '../../../packages/engine/impact.mjs';
import { resolvePageFile } from '../../../packages/engine/pagesEditor.mjs';

export function pageImpact(root, feature, file) {
  const { relPath } = resolvePageFile(root, feature, file);
  const report = analyzeImpact(root, { files: [relPath], depth: Infinity });
  const features = report.ok
    ? [...new Set(report.files.filter((f) => f.direction === 'up' && f.feature && f.feature !== feature).map((f) => f.feature))].sort()
    : [];
  return { ok: true, path: relPath, features };
}
