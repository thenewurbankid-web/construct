// Prints one JSON line describing what the import block produces, so a test can run it once per parser mode
// (CONSTRUCT_ROOT set / unset / bad) in a child process and compare. Not a test itself.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { extractParts, suggestMarkers, applyMarkers } from "../index.mjs";
import { ENGINE } from "../construct-ast.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const h = (v) => crypto.createHash("sha256").update(typeof v === "string" ? v : JSON.stringify(v)).digest("hex").slice(0, 16);
const out = { engine: ENGINE, examples: {}, fixtures: {} };
const exDir = path.join(here, "..", "..", "..", "examples");
for (const d of fs.readdirSync(exDir).sort()) {
  const f = path.join(exDir, d, "page.jsx");
  if (fs.existsSync(f)) out.examples[d] = h(extractParts(fs.readFileSync(f, "utf8")));
}
for (const f of fs.readdirSync(here).filter((x) => x.endsWith(".tsx")).sort()) {
  const src = fs.readFileSync(path.join(here, f), "utf8");
  const s = suggestMarkers(src);
  out.fixtures[f] = {
    extract: h(extractParts(src)),
    suggestions: h(s),
    applyAll: h(applyMarkers(src, s.map((x) => x.id))),
    applyStrong: h(applyMarkers(src, s.filter((x) => x.strength === "strong").map((x) => x.id))),
    extractMarked: h(extractParts(applyMarkers(src, s.filter((x) => x.strength === "strong").map((x) => x.id)))),
  };
}
console.log(JSON.stringify(out));
