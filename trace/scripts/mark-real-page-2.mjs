// TR-23 follow-up (LIN-194): regenerate the marked copy of a real Subframe page for one of the two
// remaining real-render examples (portfolio-figma-2-real, portfolio-redesigned-real). Same mechanism
// as scripts/mark-real-page.mjs, generalized to take the source page and destination example as args.
// Reads the untouched real page (subframe-app/src/pages/*.tsx), applies every *strong* suggestMarkers()
// suggestion via applyMarkers() (deterministic, no model), and writes the result to the example's own
// page.tsx (self-contained, like every other example; the original subframe-app page is never modified).
// Run from the trace/ dir: node scripts/mark-real-page-2.mjs <source.tsx> <example-dir>
import fs from "node:fs";
import { suggestMarkers, applyMarkers, extractParts } from "../src/import/index.mjs";

const [, , sourceRel, exampleDir] = process.argv;
if (!sourceRel || !exampleDir) {
  console.error("usage: node scripts/mark-real-page-2.mjs <subframe-app/src/pages/Source.tsx> <examples/dest-real>");
  process.exit(1);
}

const src = fs.readFileSync(sourceRel, "utf8");
const suggestions = suggestMarkers(src);
const strong = suggestions.filter((s) => s.strength === "strong");
const marked = applyMarkers(src, strong.map((s) => s.id));
fs.writeFileSync(`${exampleDir}/page.tsx`, marked);
const parts = extractParts(marked);
console.log("source:", sourceRel, "-> ", exampleDir);
console.log("suggestions:", suggestions.length, "strong:", strong.length);
console.log("values:", parts.values.length, "lists:", parts.lists.length, "actions:", parts.actions.length);
console.log("value names:", parts.values.map((v) => v.name));
console.log("lists:", parts.lists.map((l) => ({ name: l.name, fields: l.fields, rows: l.rows.length })));
console.log("actions:", parts.actions.map((a) => a.name));
