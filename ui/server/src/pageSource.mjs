// Pages Editor source view: the full text of one page file plus live
// diagnostics for it. Read-only. Path scoping is exactly the editor's own
// guard (resolvePageFile: strictly inside features/<feature>/pages/); the
// diagnostics themselves come from the core (src/engine/diagnostics.mjs).
import fs from 'node:fs';
import { collectDiagnostics } from '../../../packages/engine/diagnostics.mjs';
import { resolvePageFile, hashOf } from './pagesEditor.mjs';

export function readPageSource(root, feature, file) {
  const { absPath, relPath } = resolvePageFile(root, feature, file);
  const source = fs.readFileSync(absPath, 'utf8');
  return { source, contentHash: hashOf(source), diagnostics: collectDiagnostics(root, relPath, source) };
}
