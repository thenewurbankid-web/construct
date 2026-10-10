// Trace's "import a real page" block: read a real (Subframe) TSX/JSX page, suggest where the three markers
// belong, write the accepted ones, and extract the dynamic parts. One entry point; deterministic, no model, no network.
// Built on Construct's AST package (see construct-ast.mjs and docs/CONSTRUCT-REUSE.md).
export { parsePage, attrOf } from "./parse.mjs";
export { extractParts, textOf, kids } from "./extract-parts.mjs";
export { suggestMarkers, RE_TOKEN } from "./suggest-markers.mjs";
export { applyMarkers } from "./apply-markers.mjs";
