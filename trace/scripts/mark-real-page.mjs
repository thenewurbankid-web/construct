// TR-23: regenerate the marked copy of the real Subframe page used by examples/portfolio-figma-1-real.
// Reads the untouched real page (subframe-app/src/pages/*.tsx), applies every *strong* suggestMarkers()
// suggestion via applyMarkers() (deterministic, no model), and writes the result to the example's own
// page.tsx (self-contained, like every other example; the original subframe-app page is never modified).
// Run from the trace/ dir.
import fs from "node:fs";
import { suggestMarkers, applyMarkers, extractParts } from "../src/import/index.mjs";

const src = fs.readFileSync("subframe-app/src/pages/PortfolioHealthFigmaRebuild.tsx", "utf8");
const suggestions = suggestMarkers(src);
const strong = suggestions.filter((s) => s.strength === "strong");
const marked = applyMarkers(src, strong.map((s) => s.id));
fs.writeFileSync("examples/portfolio-figma-1-real/page.tsx", marked);
const parts = extractParts(marked);
console.log("suggestions:", suggestions.length, "strong:", strong.length);
console.log("values:", parts.values.length, "lists:", parts.lists.length, "actions:", parts.actions.length);
console.log("value names:", parts.values.map((v) => v.name));
console.log("lists:", parts.lists.map((l) => ({ name: l.name, fields: l.fields, rows: l.rows.length })));
console.log("actions:", parts.actions.map((a) => a.name));
