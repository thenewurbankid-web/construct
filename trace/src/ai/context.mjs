// The little bit of context a small model needs: numbered facts from the story, UI notes, API docs and the
// design itself (column headers, button labels). Retrieval is plain word overlap — no embeddings, no model.
import fs from "node:fs";
import path from "node:path";
import _traverse from "@babel/traverse";
import { parsePage, attr, textOf, walk } from "../extract.mjs";

const traverse = _traverse.default ?? _traverse;

const STOP = new Set("the a an of is are and or to in on for with as by it its this that be from at shows show shown each every all".split(" "));
export const words = (s) =>
  [...new Set((String(s).replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((w) => w.length > 1 && !STOP.has(w)))];

const read = (f) => { try { return fs.readFileSync(f, "utf8"); } catch { return ""; } };
const tag = (el) => el.openingElement.name.name;
const kids = (el) => el.children.filter((c) => c.type === "JSXElement");

// Column headers and button labels straight from the design: "Requested by" sits over the requestedBy cells.
export function designFacts(source) {
  const out = [];
  let ast;
  try { ast = parsePage(source); } catch { return out; }
  let root = null;
  traverse(ast, { JSXElement(p) { root = p.node; p.stop(); } });
  if (!root) return out;
  walk(root, (el) => {
    if (tag(el) === "table") {
      const ths = [];
      let cells = [];
      walk(el, (n) => {
        if (tag(n) === "th") ths.push(textOf(n));
        if (attr(n, "data-list") && !cells.length) { const row = kids(n)[0]; cells = row ? kids(row).map((c) => attr(c, "data-dyn")) : []; }
      });
      cells.forEach((dyn, i) => { if (typeof dyn === "string" && ths[i]) out.push(`The column headed "${ths[i]}" shows ${dyn}.`); });
    }
    const verb = attr(el, "data-action");
    if (tag(el) === "button" && typeof verb === "string" && textOf(el)) out.push(`The button labelled "${textOf(el)}" is the ${verb} action.`);
  });
  return out;
}

export function loadFacts({ dir, spec, source }) {
  const facts = [];
  for (const f of ["story.md", "ui.md"]) {
    for (const line of read(path.join(dir, f)).split("\n")) {
      const t = line.replace(/^\s*[-*\d.)]+\s*/, "").trim();
      if (!t || t.startsWith("#")) continue;
      for (const s of t.split(/(?<=[.!?])\s+/)) if (s.trim().length > 3) facts.push(s.trim());
    }
  }
  for (const [k, v] of Object.entries(spec.docs?.fields ?? {})) facts.push(`Field "${k}": ${v}`);
  for (const [k, v] of Object.entries(spec.docs?.endpoints ?? {})) facts.push(`${k}: ${v}`);
  facts.push(...designFacts(source));
  return facts.map((t) => (t.length > 200 ? t.slice(0, 199) + "…" : t));
}

export function retrieve(facts, queryWords, k = 4) {
  const q = new Set(queryWords);
  return facts
    .map((text, i) => ({ text, i, score: words(text).filter((w) => q.has(w)).length }))
    .filter((f) => f.score > 0)
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .slice(0, k)
    .map((f) => f.text);
}
