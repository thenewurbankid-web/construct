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

// story.md may carry a "## Goal" section (a user-story sentence) and an "## Acceptance criteria" section (a
// bullet list). Both are optional. `consumed` marks the line indices these sections ate, so loadFacts doesn't
// also emit them into the general fact pool.
//
// A story.md with NEITHER heading falls back: its title (the first "#"-level heading line, or "" if there is
// none) becomes the goal, and every top-level bullet in the document becomes a criterion, in document order.
// This only fires when both headings are absent — a file using either heading keeps the explicit behavior above
// untouched. It is what any hand-written story.md without headings looks like.
const BULLET = /^(-|\*|\d+\.)\s*/;

function parseStorySections(text) {
  const lines = text.split("\n");
  const goalLines = [];
  const criteria = [];
  const consumed = new Set();
  let mode = null; // "goal" | "criteria" | null
  let sawHeading = false;
  lines.forEach((line, i) => {
    const t = line.trim();
    const isHeading = /^#+/.test(t);
    if (/^#+\s*goal\b/i.test(t)) { mode = "goal"; sawHeading = true; consumed.add(i); return; }
    if (/^#+\s*acceptance criteria/i.test(t)) { mode = "criteria"; sawHeading = true; consumed.add(i); return; }
    if (isHeading) { mode = null; return; }
    if (!t) return;
    if (mode === "goal") { goalLines.push(t); consumed.add(i); }
    else if (mode === "criteria" && BULLET.test(t)) { criteria.push(t.replace(BULLET, "").trim()); consumed.add(i); }
  });
  if (sawHeading) return { goal: goalLines.join(" ").trim(), criteria, consumed };

  let title = "";
  const fallbackCriteria = [];
  lines.forEach((line, i) => {
    const t = line.trim();
    if (!title && /^#+\s*/.test(t) && t.replace(/^#+\s*/, "")) { title = t.replace(/^#+\s*/, "").trim(); consumed.add(i); return; }
    if (BULLET.test(t)) { fallbackCriteria.push(t.replace(BULLET, "").trim()); consumed.add(i); }
  });
  return { goal: title, criteria: fallbackCriteria, consumed };
}

export function loadStory(dir) {
  const { goal, criteria } = parseStorySections(read(path.join(dir, "story.md")));
  return { goal, criteria };
}

// The explicit-heading shape `loadStory` reads back: "## Goal" then "## Acceptance criteria", either section
// omitted when empty. Written by `saveStory` (LIN-106), the UI's Story panel's save path.
export function formatStory({ goal, criteria } = {}) {
  const g = (goal ?? "").trim();
  const c = (criteria ?? []).map((s) => String(s).trim()).filter(Boolean);
  let out = "";
  if (g) out += `## Goal\n\n${g}\n\n`;
  if (c.length) out += `## Acceptance criteria\n\n${c.map((s) => `- ${s}`).join("\n")}\n`;
  return out;
}

export function saveStory(dir, story) {
  fs.writeFileSync(path.join(dir, "story.md"), formatStory(story));
}

export function loadFacts({ dir, spec, source }) {
  const facts = [];
  for (const f of ["story.md", "ui.md"]) {
    const text = read(path.join(dir, f));
    const consumed = f === "story.md" ? parseStorySections(text).consumed : new Set();
    text.split("\n").forEach((line, i) => {
      if (consumed.has(i)) return;
      const t = line.replace(/^\s*[-*\d.)]+\s*/, "").trim();
      if (!t || t.startsWith("#")) return;
      for (const s of t.split(/(?<=[.!?])\s+/)) if (s.trim().length > 3) facts.push(s.trim());
    });
  }
  for (const [k, v] of Object.entries(spec.docs?.fields ?? {})) facts.push(`Field "${k}": ${v}`);
  for (const [k, v] of Object.entries(spec.docs?.endpoints ?? {})) facts.push(`${k}: ${v}`);
  facts.push(...designFacts(source));
  return facts.map((t) => (t.length > 200 ? t.slice(0, 199) + "…" : t));
}

// LIN-109 [TR-14]: which acceptance criterion (if any) is about a given part, so a decision or a question's
// context can point at the specific sentence the person wrote to check it against — the same plain word-overlap
// as retrieve(), applied to one field: the earliest criterion sharing a word with `part` wins.
export function matchCriterion(part, story) {
  const partWords = new Set(words(part));
  const criteria = story?.criteria ?? [];
  for (let i = 0; i < criteria.length; i++) {
    if (words(criteria[i]).some((w) => partWords.has(w))) return { id: `criterion-${i}`, text: criteria[i] };
  }
  return null;
}

// Plain word-overlap count, unchanged from before this ticket. An IDF-weighted score (as primary rank, and
// even used only as a tiebreak) was tried and measured against the 1.5B model on the real eval corpus: every
// variant reranked away facts that plain overlap was correctly preferring, regressing coverage/accuracy below
// baseline (64/132 answered, 66% correct). Reverted to keep the "at least equal to baseline" bar; left as a
// follow-up idea rather than shipped.
export function retrieve(facts, queryWords, k = 4) {
  const q = new Set(queryWords);
  return facts
    .map((text, i) => ({ text, i, score: words(text).filter((w) => q.has(w)).length }))
    .filter((f) => f.score > 0)
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .slice(0, k)
    .map((f) => f.text);
}
