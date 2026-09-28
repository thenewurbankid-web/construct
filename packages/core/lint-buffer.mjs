// #550 -- lintBuffer: rule diagnostics for one unsaved editor buffer.
//
// `construct validate` (architecture-enforcer.mjs's validateArchitecture) always reads
// every file it checks off disk. An editor wants diagnostics for a buffer the user is
// still typing in, before it's saved -- so lintBuffer takes `source` as an argument
// instead of reading `file` off disk, and runs only the rules that need nothing but
// that one file's content (see BUFFER-SCOPE POLICY below). It reuses validateArchitecture's
// own per-file building blocks (detectLayerViolations, layerViolationOptsFor,
// checkUnclassified, checkDanglingImports, pushViolation, all exported by
// architecture-enforcer.mjs) rather than reimplementing rule logic, so a diagnostic
// lintBuffer reports for a saved file's unchanged content is never worded or classified
// differently than the one `construct validate` reports for the same file -- this is
// what lint-buffer.test.mjs's parity test checks, over the same fixtures
// architecture-enforcer.test.mjs validates against.
//
// BUFFER-SCOPE POLICY (what lintBuffer runs, and what it deliberately doesn't):
//
//   Buffer-scope (lintBuffer runs these, live, on every call):
//     - architecture module's layer-violation rules (detectLayerViolations): everything
//       from layer-boundary imports (SOC-001) to per-layer purity/complexity rules
//       (DOMAIN-002, COMPONENT-006, WORKFLOW-004, STATE-001, ...). All are pure
//       functions of one file's source plus its classified layer.
//     - SOC-001 "unclassified file" (checkUnclassified) and IMPORT-001 "dangling
//       relative import" (checkDanglingImports): both need only the single file's
//       path and source (import targets are resolved with fs.existsSync against
//       disk, exactly like validateArchitecture, but never read a target's content).
//
//   Full-pass-on-save only (lintBuffer does not run these; only `construct validate`
//   and the engine's shadow-root commit path, packages/engine/transactionalWriter.mjs,
//   do):
//     - separation-of-concerns (soc-enforcer.mjs): feature-skeleton, cross-file
//       duplicate-detection and ownership checks read every file in a feature, not
//       just the one being edited -- meaningless to run against a single buffer.
//     - readability (readability-enforcer.mjs): walks every file in a feature to
//       check feature-level JSDoc coverage alongside per-file naming/length checks.
//     - public-api-drift (api-composer.mjs) and CLIENT-001 (client-boundary.mjs):
//       both trace the whole project's import graph.
//     - frozen-index rules (frozen-detector.mjs): compare against every frozen
//       source, and generic custom-layer edge checks (checkGenericEdges): both are
//       cheap to build once per run but not worth rebuilding on every keystroke.
//
// DEBOUNCE / TRIGGER POLICY (editor-side, `ui/server`'s endpoint):
//   - lintBuffer is cheap (single-file AST parse, no project walk) and safe to call
//     on every keystroke, but the endpoint debounces calls per file (~300ms after the
//     last edit) so a fast typist doesn't re-parse on every keystroke.
//   - A full pass (`construct validate`, or the engine's transactional shadow-root
//     commit) runs on save, not on every buffer change: it's the only path that
//     catches full-pass-only rules (above), and it's too expensive to debounce down
//     to editor-typing latency.
import path from 'node:path';
import { loadConfig } from './config.mjs';
import { loadLayerGraph } from './architecture-graph.mjs';
import { validateExceptionsShape } from './exceptions.mjs';
import { rel } from './fs.mjs';
import { matchFrozen } from './frozen.mjs';
import { isNonLayerPath } from './nonLayer.mjs';
import {
  FILE_EXTENSIONS,
  classifyFile,
  detectLayerViolations,
  layerViolationOptsFor,
  checkUnclassified,
  checkDanglingImports,
  pushViolation,
} from './architecture-enforcer.mjs';

/**
 * Buffer-scope rule diagnostics for one unsaved file, `diagnostics.makeViolation`-shaped
 * (maps 1:1 to an LSP `Diagnostic`). See this file's header comment for exactly which
 * rules run here vs. only on a full `construct validate` pass.
 *
 * @param {string} root - project root.
 * @param {string} file - path to the file being edited, absolute or root-relative.
 * @param {string} source - the buffer's current (possibly unsaved) content.
 * @returns {{violations: object[]}}
 */
export function lintBuffer(root, file, source) {
  const config = loadConfig(root);
  const graph = loadLayerGraph(root); // throws ConstructError on a malformed custom graph
  validateExceptionsShape(config); // throws ConstructError on a malformed exception

  const abs = path.isAbsolute(file) ? file : path.join(root, file);
  const r = rel(root, abs);
  const out = [];

  if (!FILE_EXTENSIONS.has(path.extname(abs))) return { violations: out };

  const frozenGlobs = config.frozen || [];
  const nonLayerGlobs = config.nonLayer || [];
  // Mirrors validateArchitecture: a frozen or declared non-layer file has no
  // buffer-scope rules applied to it either.
  if (frozenGlobs.length && matchFrozen(root, abs, frozenGlobs)) return { violations: out };
  if (nonLayerGlobs.length && isNonLayerPath(root, abs, nonLayerGlobs)) return { violations: out };

  const layer = classifyFile(r, graph);
  if (!layer) {
    checkUnclassified(config, graph, r, out);
    return { violations: out };
  }

  const layerOpts = layerViolationOptsFor(config, layer);
  for (const desc of detectLayerViolations(layer, source, layerOpts)) {
    pushViolation(config, out, { ...desc, file: r });
  }
  checkDanglingImports(config, abs, source, r, out);

  return { violations: out };
}
