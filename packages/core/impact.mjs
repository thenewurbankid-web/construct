// Public entry point for the "impact" capability (`@line/construct-core/impact`).
// The implementation lives in packages/engine/impact.mjs (blast-radius analysis
// over the import/layer graph); this file only re-exports it so the package's
// public surface is enumerable from packages/core/package.json's exports map
// without reaching into a sibling workspace package directly.
export { analyzeImpact, proposeSeedsFromText, impactFromChangedFiles, impactFromTicketText, impactApiManifest, renderImpactMarkdown } from '../engine/impact.mjs';
